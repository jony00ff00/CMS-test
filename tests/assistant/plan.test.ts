import { describe, expect, it } from 'vitest';
import { parsePlan, planGraph, type AssistantPlan } from '../../src/assistant/plan';
import { describeGraph, systemPrompt } from '../../src/assistant/prompt';
import { GraphEvaluator, nodeRegistry, storeFile, type Graph } from '../../src/engine';
import { seedLibrary } from '../../src/snippets/seed';

const files = { guide: storeFile('guide.html', '<h1>Guide</h1><h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>', 'guide') };
const ctx = { registry: nodeRegistry, library: seedLibrary(), files };
const empty: Graph = { nodes: [], edges: [] };
const plan = (operations: AssistantPlan['operations']): AssistantPlan => ({ reply: '', operations });

describe('parsePlan', () => {
  it('reads plain JSON, fenced JSON and JSON after some words', () => {
    const json = '{"reply":"Done","operations":[{"op":"add","id":"a","type":"output"}]}';
    for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `Here you go:\n${json}\nEnjoy`]) {
      expect(parsePlan(text)).toEqual({ reply: 'Done', operations: [{ op: 'add', id: 'a', type: 'output' }] });
    }
  });

  it('takes a bare list of operations, and plain words as a reply without changes', () => {
    expect(parsePlan('[{"op":"remove","node":"x"}]')).toEqual({ reply: '', operations: [{ op: 'remove', node: 'x' }] });
    expect(parsePlan('A Selector picks parts of a document.')).toEqual({ reply: 'A Selector picks parts of a document.', operations: [] });
  });

  it('says what is wrong', () => {
    expect(parsePlan('{"operations": [}')).toMatchObject({ error: expect.stringMatching(/not valid JSON/) });
    expect(parsePlan('{"operations":[{"op":"explode"}]}')).toEqual({ error: expect.stringMatching(/Operation 1: unknown "op" "explode"/) });
    expect(parsePlan('{"operations":[{"op":"connect","from":"a"}]}')).toEqual({ error: 'Operation 1: "connect" needs "to"' });
    expect(parsePlan('{"operations":[{"op":"configure","node":"a"}]}')).toMatchObject({ error: expect.stringMatching(/needs "config"/) });
  });
});

describe('planGraph', () => {
  it('builds a working flow from nothing: file by name, library snippet, ports chosen', async () => {
    const r = planGraph(empty, plan([
      { op: 'add', id: 'src', type: 'documentSource', name: 'Guide', config: { file: 'guide.html' } },
      { op: 'add', id: 'sel', type: 'selector', name: 'Sections', config: { mode: 'heading', text: 'One', level: 2 } },
      { op: 'add', id: 'snip', type: 'snippet', config: { library: 'callout', params: { variant: 'warning' } } },
      { op: 'add', id: 'out', type: 'output' },
      { op: 'connect', from: 'src', to: 'sel' },
      { op: 'connect', from: 'sel', to: 'snip' },
      { op: 'connect', from: 'snip', to: 'out' },
    ]), ctx);
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual(['documentSource-1', 'selector-2', 'snippet-3', 'output-4']);
    const [src, sel, snip] = r.graph.nodes;
    expect(src).toMatchObject({ name: 'Guide', config: { fileId: 'guide' } });
    // Another mode: the old mode's fields are gone.
    expect(sel.config).toEqual({ mode: 'heading', text: 'One', level: 2 });
    expect(snip.config).toMatchObject({ ref: { id: 'callout', version: 1 }, params: { variant: 'warning' }, snippet: { id: 'callout' } });
    // Selection, not Point, into the Snippet's "any" input.
    expect(r.graph.edges.map((e) => `${e.source}.${e.sourcePort}>${e.target}.${e.targetPort}`)).toEqual([
      'documentSource-1.document>selector-2.document', 'selector-2.selection>snippet-3.selection', 'snippet-3.document>output-4.document',
    ]);
    // Left to right, each to the right of what feeds it.
    const xs = r.graph.nodes.map((n) => n.position!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(4);

    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(r.graph, { files });
    expect(results['output-4'].status).toBe('ok');
    expect(results['output-4'].outputs.html).toContain('callout-warning');
  });

  it('changes, renames, disconnects and removes existing nodes by id or name; the start graph is untouched', () => {
    const start = planGraph(empty, plan([
      { op: 'add', id: 'a', type: 'documentSource', name: 'Text' },
      { op: 'add', id: 'b', type: 'selector' },
      { op: 'add', id: 'c', type: 'output' },
      { op: 'connect', from: 'a', to: 'b' },
      { op: 'connect', from: 'a', to: 'c' },
    ]), ctx).graph;
    const copy = structuredClone(start);
    const r = planGraph(start, plan([
      { op: 'configure', node: 'selector-2', config: { selector: 'p', expect: { min: 1 } } },
      { op: 'rename', node: 'text', name: 'Words' },
      { op: 'disconnect', from: 'Words', to: 'output-3' },
      { op: 'remove', node: 'selector-2' },
    ]), ctx);
    expect(r.errors).toEqual([]);
    expect(start).toEqual(copy);
    expect(r.graph.nodes.map((n) => n.id)).toEqual(['documentSource-1', 'output-3']);
    expect(r.graph.nodes[0].name).toBe('Words');
    expect(r.graph.edges).toEqual([]);
    expect(r.steps[0].text).toBe('Change the settings of Selector (selector-2)');
  });

  it('skips what cannot be done, with reasons the model can act on', () => {
    const r = planGraph(empty, plan([
      { op: 'add', id: 'x', type: 'magic' },
      { op: 'add', id: 'o', type: 'output' },
      { op: 'add', id: 's', type: 'selector' },
      { op: 'connect', from: 'o', fromPort: 'html', to: 's' },
      { op: 'connect', from: 's', to: 'nowhere' },
      { op: 'connect', from: 's', toPort: 'banana', to: 'o' },
    ]), ctx);
    expect(r.steps.map((s) => s.error)).toEqual([
      expect.stringMatching(/^Unknown node type “magic” \(use documentSource, selector/),
      undefined,
      undefined,
      'Cannot connect a html output to a document input',
      'There is no node “nowhere”',
      'Output has no input “banana” (it has “document”)',
    ]);
    expect(r.errors).toHaveLength(4);
    expect(r.added).toEqual(['output-1', 'selector-2']);
  });

  it('Insert: content connected means content from another node; a file by name; warnings for what is missing', () => {
    const pic = storeFile('pic.png', new Uint8Array([1, 2]), 'pic');
    const r = planGraph(empty, plan([
      { op: 'add', id: 'src', type: 'documentSource', config: { file: 'missing.docx' } },
      { op: 'add', id: 'sel', type: 'selector', config: { mode: 'css', selector: 'h1', place: 'after' } },
      { op: 'add', id: 'img', type: 'object', config: { content: { kind: 'image', file: 'pic.png', alt: 'A picture' } } },
      { op: 'add', id: 'copy', type: 'object' },
      { op: 'connect', from: 'src', to: 'sel' },
      { op: 'connect', from: 'sel', fromPort: 'point', to: 'img' },
      { op: 'connect', from: 'img', to: 'copy', toPort: 'content' },
    ]), { ...ctx, files: { ...files, pic } });
    expect(r.errors).toEqual([]);
    expect(r.steps[0].warnings?.[0]).toMatch(/no file “missing.docx”/);
    expect(r.graph.nodes[2].config).toEqual({ content: { kind: 'image', fileId: 'pic', alt: 'A picture' } });
    expect(r.graph.edges[1]).toMatchObject({ sourcePort: 'point', targetPort: 'where' });
    expect((r.graph.nodes[3].config as { content: unknown }).content).toEqual({ kind: 'selection' });
  });

  it('snippets of its own: a template, or classes with CSS', () => {
    const r = planGraph(empty, plan([
      { op: 'add', id: 'a', type: 'snippet', name: 'Card', config: { mode: 'wrap', template: '<div class="card">{{content}}</div>', css: '.card{padding:1rem}' } },
      { op: 'add', id: 'b', type: 'snippet', config: { custom: { className: 'note', wrap: 'div' }, css: '.note{color:red}' } },
      { op: 'add', id: 'c', type: 'snippet', config: { library: 'nope' } },
    ]), ctx);
    expect(r.graph.nodes[0].config).toMatchObject({ snippet: { id: 'assistant-snippet-1', name: 'Card', mode: 'wrap', template: '<div class="card">{{content}}</div>' }, css: '.card{padding:1rem}' });
    expect(r.graph.nodes[0].config).not.toHaveProperty('ref');
    expect(r.graph.nodes[1].config).toMatchObject({ custom: { className: 'note', wrap: 'div' }, css: '.note{color:red}' });
    expect(r.graph.nodes[1].config).not.toHaveProperty('ref');
    expect(r.steps[2].warnings).toEqual(['There is no snippet “nope” in the library']);
  });
});

describe('the prompt', () => {
  it('lists every node type with its ports, the library, the files and the project', () => {
    const g = planGraph(empty, plan([{ op: 'add', id: 'a', type: 'documentSource', name: 'Guide', config: { file: 'guide' } }]), ctx).graph;
    const text = systemPrompt(nodeRegistry, g, files, seedLibrary(), 'documentSource-1');
    for (const type of Object.keys(nodeRegistry)) expect(text).toContain(`### ${type} — `);
    expect(text).toContain('Inputs: where (any, optional), content (any, optional)');
    expect(text).toContain('- callout: Callout');
    expect(text).toContain('- guide.html');
    expect(text).toContain('- documentSource-1 [documentSource: Document Source] named “Guide” (selected): {"fileId":"guide"}');
  });

  it('shortens snippets and hand-picked selections', () => {
    const g: Graph = {
      nodes: [
        { id: 's', type: 'snippet', config: nodeRegistry.snippet.defaultConfig() },
        { id: 'm', type: 'selector', config: { mode: 'manual', anchors: [{ id: 'x' }, { id: 'y' }] } },
      ],
      edges: [{ id: 'e', source: 'm', sourcePort: 'selection', target: 's', targetPort: 'selection' }],
    };
    const text = describeGraph(g, nodeRegistry);
    expect(text).toContain('"snippet":"library callout"');
    expect(text).toContain('"anchors":"2 picked by hand"');
    expect(text).toContain('- m.selection → s.selection');
  });
});
