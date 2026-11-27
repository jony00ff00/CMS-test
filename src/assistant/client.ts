// Talks to a language model on the person's own computer (or any server) through the OpenAI-compatible chat API
// that Ollama, LM Studio, llama.cpp's server, vLLM and Jan all offer. Nothing is sent anywhere else.
import type { Graph, NodeRegistry, SnippetLibrary, StoredFile } from '../engine';
import { parsePlan, planGraph, type AssistantPlan, type PlannedGraph } from './plan';
import { repairMessage, systemPrompt, type ChatMessage } from './prompt';

export interface AssistantSettings {
  /** The API's base address, e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio). */
  baseUrl: string;
  model: string;
  /** Only for servers that ask for one. */
  apiKey?: string;
}

export const DEFAULT_SETTINGS: AssistantSettings = { baseUrl: 'http://localhost:11434/v1', model: '' };

/** Known local servers, for the settings' quick choices. */
export const LOCAL_SERVERS = [
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
];

type Fetch = typeof fetch;

const endpoint = (s: AssistantSettings, path: string) => `${s.baseUrl.trim().replace(/\/+$/, '')}${path}`;
const headers = (s: AssistantSettings) => ({ 'Content-Type': 'application/json', ...(s.apiKey?.trim() && { Authorization: `Bearer ${s.apiKey.trim()}` }) });

/** Why a request failed, in words the person can act on. */
export function connectionHelp(s: AssistantSettings, error: unknown): string {
  if ((error as Error)?.name === 'AbortError') return 'Stopped';
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError || /fetch|network/i.test(message)) {
    return `Could not reach ${s.baseUrl}. Check that the server is running, and that it allows requests from this page (Ollama: set OLLAMA_ORIGINS to include ${pageOrigin()}; LM Studio: turn on CORS in the server settings).`;
  }
  return message;
}

const pageOrigin = () => (typeof location === 'undefined' ? 'this page’s address' : location.origin);

/** The models the server has (OpenAI-style GET /models). */
export async function listModels(s: AssistantSettings, opts: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<string[]> {
  const res = await (opts.fetch ?? fetch)(endpoint(s, '/models'), { headers: headers(s), signal: opts.signal });
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText} for its list of models`);
  const data = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; model?: string }[] };
  const ids = data.data?.map((m) => m.id) ?? data.models?.map((m) => m.name ?? m.model ?? '') ?? [];
  return ids.filter(Boolean).sort();
}

/** One chat completion. Asks for JSON; servers that do not take that option are asked again without it. */
export async function chat(s: AssistantSettings, messages: ChatMessage[], opts: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<string> {
  if (!s.model.trim()) throw new Error('Choose a model in the assistant\'s settings');
  const send = (json: boolean) =>
    (opts.fetch ?? fetch)(endpoint(s, '/chat/completions'), {
      method: 'POST',
      headers: headers(s),
      signal: opts.signal,
      body: JSON.stringify({ model: s.model.trim(), messages, temperature: 0.2, stream: false, ...(json && { response_format: { type: 'json_object' } }) }),
    });
  let res = await send(true);
  if (res.status === 400 || res.status === 422) res = await send(false);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`The server answered ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The server\'s answer had no message in it');
  // Reasoning models put their thinking first.
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export interface AssistantContext {
  registry: NodeRegistry;
  graph: Graph;
  files: Record<string, StoredFile>;
  library: SnippetLibrary;
  selectedId?: string;
}

export interface AssistantTurn {
  /** The request and the answers, to send again with the next request (so "now add …" works). */
  history: ChatMessage[];
  plan: AssistantPlan;
  planned: PlannedGraph;
  /** How many answers it took (more than one when the first had steps that could not be done). */
  attempts: number;
}

/**
 * Sends the request with the project as it is now; when the answer has steps that cannot be done, sends the
 * reasons back once or twice so the model can correct them. The graph itself is not changed here.
 */
export async function askAssistant(
  settings: AssistantSettings, request: string, history: ChatMessage[], ctx: AssistantContext,
  opts: { fetch?: Fetch; signal?: AbortSignal; tries?: number } = {},
): Promise<AssistantTurn> {
  const system: ChatMessage = { role: 'system', content: systemPrompt(ctx.registry, ctx.graph, ctx.files, ctx.library, ctx.selectedId) };
  // Earlier turns without their system message (the project may have changed since: the new one describes it).
  const turn: ChatMessage[] = [...history.slice(-8), { role: 'user', content: request }];
  const tries = opts.tries ?? 3;
  let last: { plan: AssistantPlan; planned: PlannedGraph; answer: string } | undefined;
  // What the next request sees: the requests and the last answer to each, not the corrections in between.
  const done = (l: NonNullable<typeof last>, attempts: number): AssistantTurn => ({
    history: [...history, { role: 'user', content: request }, { role: 'assistant', content: l.answer }],
    plan: l.plan,
    planned: l.planned,
    attempts,
  });
  let lastError = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    const answer = await chat(settings, [system, ...turn], opts);
    turn.push({ role: 'assistant', content: answer });
    const plan = parsePlan(answer);
    if ('error' in plan) {
      lastError = plan.error;
      turn.push({ role: 'user', content: repairMessage([plan.error]) });
      continue;
    }
    const planned = planGraph(ctx.graph, plan, ctx);
    last = { plan, planned, answer };
    if (!planned.errors.length) return done(last, attempt);
    if (attempt < tries) turn.push({ role: 'user', content: repairMessage(planned.errors) });
  }
  if (last) return done(last, tries);
  throw new Error(`The model's answer could not be read: ${lastError}`);
}
