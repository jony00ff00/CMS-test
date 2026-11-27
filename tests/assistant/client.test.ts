import { describe, expect, it, vi } from 'vitest';
import { askAssistant, chat, connectionHelp, listModels } from '../../src/assistant/client';
import { nodeRegistry, type Graph } from '../../src/engine';
import { createEditorStore } from '../../src/store/editor-store';
import { seedLibrary } from '../../src/snippets/seed';

const settings = { baseUrl: 'http://localhost:11434/v1/', model: 'test-model' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = (content: string) => json({ choices: [{ message: { content } }] });
const ctx = (graph: Graph = { nodes: [], edges: [] }) => ({ registry: nodeRegistry, graph, files: {}, library: seedLibrary() });

describe('the local model client', () => {
  it('lists models from OpenAI-style and Ollama-style answers', async () => {
    const fetch = vi.fn(async () => json({ data: [{ id: 'b' }, { id: 'a' }] }));
    expect(await listModels(settings, { fetch })).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.anything());
    expect(await listModels(settings, { fetch: async () => json({ models: [{ name: 'llama3' }] }) })).toEqual(['llama3']);
  });

  it('asks for JSON, and again without that option when the server refuses it; sends the key; drops thinking', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      bodies.push(body);
      return body.response_format ? json({ error: 'response_format not supported' }, 400) : answer('<think>hmm</think>{"reply":"ok"}');
    });
    const text = await chat({ ...settings, apiKey: 'k' }, [{ role: 'user', content: 'hi' }], { fetch });
    expect(text).toBe('{"reply":"ok"}');
    expect(bodies.map((b) => Boolean(b.response_format))).toEqual([true, false]);
    expect(bodies[0]).toMatchObject({ model: 'test-model', stream: false, messages: [{ role: 'user', content: 'hi' }] });
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('explains failures', async () => {
    await expect(chat({ ...settings, model: '' }, [])).rejects.toThrow(/Choose a model/);
    await expect(chat(settings, [], { fetch: async () => new Response('no such model', { status: 404, statusText: 'Not Found' }) })).rejects.toThrow('The server answered 404 Not Found: no such model');
    expect(connectionHelp(settings, new TypeError('Failed to fetch'))).toMatch(/Could not reach .*OLLAMA_ORIGINS/);
    expect(connectionHelp(settings, Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('Stopped');
  });

  it('sends the steps that could not be done back to the model, and keeps only the final answer in the history', async () => {
    const answers = [
      '{"reply":"Here","operations":[{"op":"add","id":"o","type":"outptu"}]}',
      '{"reply":"Fixed","operations":[{"op":"add","id":"o","type":"output"}]}',
    ];
    const sent: { role: string; content: string }[][] = [];
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)).messages);
      return answer(answers[sent.length - 1]);
    });
    const turn = await askAssistant(settings, 'Add an output', [], ctx(), { fetch });
    expect(turn.attempts).toBe(2);
    expect(turn.plan.reply).toBe('Fixed');
    expect(turn.planned.errors).toEqual([]);
    expect(sent[1].at(-1)!.content).toMatch(/Unknown node type “outptu”/);
    expect(sent[0][0].role).toBe('system');
    expect(turn.history).toEqual([{ role: 'user', content: 'Add an output' }, { role: 'assistant', content: answers[1] }]);
  });

  it('gives up after its tries and returns the last plan with its errors', async () => {
    const fetch = async () => answer('{"operations":[{"op":"remove","node":"ghost"}]}');
    const turn = await askAssistant(settings, 'Remove the ghost', [], ctx(), { fetch, tries: 2 });
    expect(turn.attempts).toBe(2);
    expect(turn.planned.errors).toEqual(['Remove ghost: There is no node “ghost”']);
  });
});

describe('applying a plan in the editor', () => {
  it('is one undo step and selects the last new node', async () => {
    const store = createEditorStore({ storage: null, evaluateDelay: 0 });
    store.getState().addNode('output');
    const fetch = async () =>
      answer('{"reply":"ok","operations":[{"op":"add","id":"s","type":"documentSource"},{"op":"connect","from":"s","to":"output-1"}]}');
    const turn = await askAssistant(settings, 'Feed the output', [], { ...ctx(store.getState().graph) }, { fetch });
    const before = store.getState().graph;
    store.getState().applyGraph(turn.planned.graph, turn.planned.added.at(-1));
    expect(store.getState().graph.edges).toHaveLength(1);
    expect(store.getState().selectedId).toBe('documentSource-2');
    store.getState().undo();
    expect(store.getState().graph).toEqual(before);
  });
});
