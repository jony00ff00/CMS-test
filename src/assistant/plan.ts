// What an assistant (a language model) may do to the graph, and how its answer becomes a new graph.
// Pure TS (no React, no DOM, no network): the model's answer is checked against the node registry, the snippet
// library and the project's files, and every change is applied to a copy of the graph, so nothing changes until the
// person applies the plan (one undo step).
import {
  connect as connectEdge, edgeError, latestVersion, validateSnippet,
  type Graph, type GraphNode, type NodeRegistry, type PortDef, type Snippet, type SnippetLibrary, type StoredFile,
} from '../engine';

/** One change the assistant asks for. Node references are existing ids, existing names, or the `id` of an `add`. */
export type PlanOperation =
  | { op: 'add'; id: string; type: string; name?: string; config?: Record<string, unknown> }
  | { op: 'connect'; from: string; fromPort?: string; to: string; toPort?: string }
  | { op: 'disconnect'; from: string; to: string; fromPort?: string; toPort?: string }
  | { op: 'configure'; node: string; config: Record<string, unknown> }
  | { op: 'rename'; node: string; name: string }
  | { op: 'remove'; node: string };

export interface AssistantPlan {
  /** What the assistant says to the person (an answer, or what the operations do). */
  reply: string;
  operations: PlanOperation[];
}

export interface PlanStep {
  /** The change in plain words ("Add Selector “Headings” (selector-3)"). */
  text: string;
  /** Why it cannot be done (the step is skipped). */
  error?: string;
  /** Things done differently from what was asked (e.g. an unknown setting left out). */
  warnings?: string[];
}

export interface PlannedGraph {
  graph: Graph;
  steps: PlanStep[];
  /** The new nodes' ids, in the order they were added. */
  added: string[];
  /** Every step's error, for sending back to the model. */
  errors: string[];
}

export interface PlanContext {
  registry: NodeRegistry;
  library: SnippetLibrary;
  files: Record<string, StoredFile>;
}

const OPS = ['add', 'connect', 'disconnect', 'configure', 'rename', 'remove'];
const SPACING = { x: 280, y: 150 };

/**
 * Reads the model's answer: JSON (possibly inside a ```json fence or after some text) with `reply` and
 * `operations`. Returns a plain reason when it is not usable.
 */
export function parsePlan(text: string): AssistantPlan | { error: string } {
  const json = findJson(text);
  if (json === undefined) {
    // A model that ignored the format and just talked: show what it said, change nothing.
    return text.trim() ? { reply: text.trim(), operations: [] } : { error: 'The answer was empty' };
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { error: `The answer is not valid JSON: ${(e as Error).message}` };
  }
  if (Array.isArray(data)) data = { reply: '', operations: data };
  if (!isRecord(data)) return { error: 'The answer must be a JSON object with "reply" and "operations"' };
  const reply = typeof data.reply === 'string' ? data.reply : typeof data.message === 'string' ? data.message : '';
  const raw = data.operations ?? data.ops ?? [];
  if (!Array.isArray(raw)) return { error: '"operations" must be a list' };
  const operations: PlanOperation[] = [];
  for (const [i, o] of raw.entries()) {
    const op = readOperation(o);
    if (typeof op === 'string') return { error: `Operation ${i + 1}: ${op}` };
    operations.push(op);
  }
  return { reply, operations };
}

function readOperation(o: unknown): PlanOperation | string {
  if (!isRecord(o)) return 'must be an object';
  const op = String(o.op ?? o.action ?? '');
  if (!OPS.includes(op)) return `unknown "op" ${JSON.stringify(o.op ?? o.action)} (use ${OPS.join(', ')})`;
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
  const need = (...keys: string[]) => keys.find((k) => !str(k));
  const config = isRecord(o.config) ? o.config : undefined;
  switch (op) {
    case 'add': {
      const missing = need('id', 'type');
      if (missing) return `"add" needs "${missing}"`;
      return { op, id: str('id')!, type: str('type')!, ...(str('name') && { name: str('name') }), ...(config && { config }) };
    }
    case 'connect':
    case 'disconnect': {
      const missing = need('from', 'to');
      if (missing) return `"${op}" needs "${missing}"`;
      return { op, from: str('from')!, to: str('to')!, ...(str('fromPort') && { fromPort: str('fromPort') }), ...(str('toPort') && { toPort: str('toPort') }) };
    }
    case 'configure':
      if (!str('node')) return '"configure" needs "node"';
      if (!config) return '"configure" needs "config" (an object)';
      return { op, node: str('node')!, config };
    case 'rename':
      if (!str('node') || typeof o.name !== 'string') return '"rename" needs "node" and "name"';
      return { op, node: str('node')!, name: o.name };
    default:
      if (!str('node')) return '"remove" needs "node"';
      return { op: 'remove', node: str('node')! };
  }
}

/** The JSON in a model's answer: a fenced block, or the outermost {...} / [...]. */
function findJson(text: string): string | undefined {
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  if (fence && /^[[{]/.test(fence[1].trim())) return fence[1].trim();
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  return end > start ? text.slice(start, end + 1) : undefined;
}

/** Applies the plan to a copy of the graph. Steps that cannot be done are skipped, with a reason. */
export function planGraph(start: Graph, plan: AssistantPlan, ctx: PlanContext): PlannedGraph {
  let graph: Graph = { ...start, nodes: [...start.nodes], edges: [...start.edges] };
  const steps: PlanStep[] = [];
  const added: string[] = [];
  const refs = new Map<string, string>();
  const label = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? `${ctx.registry[n.type]?.label ?? n.type}${n.name ? ` “${n.name}”` : ''} (${n.id})` : id;
  };
  const resolve = (ref: string): string | undefined => {
    if (refs.has(ref)) return refs.get(ref);
    if (graph.nodes.some((n) => n.id === ref)) return ref;
    const named = graph.nodes.filter((n) => n.name?.trim().toLowerCase() === ref.toLowerCase());
    return named.length === 1 ? named[0].id : undefined;
  };
  const unknown = (ref: string) => `There is no node “${ref}”`;
  const setNode = (node: GraphNode) => {
    graph = { ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)) };
  };

  for (const op of plan.operations) {
    const step: PlanStep = { text: '' };
    steps.push(step);
    const warnings: string[] = [];
    switch (op.op) {
      case 'add': {
        const def = ctx.registry[op.type];
        step.text = `Add ${def?.label ?? op.type}${op.name ? ` “${op.name}”` : ''}`;
        if (!def) {
          step.error = `Unknown node type “${op.type}” (use ${Object.keys(ctx.registry).join(', ')})`;
          break;
        }
        if (refs.has(op.id)) {
          step.error = `The id “${op.id}” is used by another new node`;
          break;
        }
        const id = nextId(graph, op.type);
        const base: GraphNode = { id, type: op.type, config: def.defaultConfig(), ...(op.name?.trim() && { name: op.name.trim() }) };
        const config = op.config ? configured(base, op.config, ctx, warnings) : base.config;
        graph = { ...graph, nodes: [...graph.nodes, { ...base, config }] };
        refs.set(op.id, id);
        added.push(id);
        step.text += ` (${id})`;
        break;
      }
      case 'connect': {
        const source = resolve(op.from);
        const target = resolve(op.to);
        step.text = `Connect ${source ? label(source) : op.from} → ${target ? label(target) : op.to}`;
        if (!source || !target) {
          step.error = unknown(!source ? op.from : op.to);
          break;
        }
        const ports = choosePorts(graph, source, target, op, ctx.registry);
        if ('error' in ports) {
          step.error = ports.error;
          break;
        }
        step.text = `Connect ${label(source)} ${ports.sourcePort} → ${label(target)} ${ports.targetPort}`;
        const r = connectEdge(graph, { source, target, ...ports }, ctx.registry);
        if ('error' in r) {
          step.error = r.error;
          break;
        }
        graph = r.graph;
        // As in the editor: content connected to an Insert node means "content from another node".
        const t = graph.nodes.find((n) => n.id === target)!;
        const content = (t.config as { content?: { kind?: string } }).content;
        if (t.type === 'object' && ports.targetPort === 'content' && content?.kind !== 'selection') {
          setNode({ ...t, config: { ...(t.config as object), content: { kind: 'selection' } } });
        }
        break;
      }
      case 'disconnect': {
        const source = resolve(op.from);
        const target = resolve(op.to);
        step.text = `Disconnect ${source ? label(source) : op.from} → ${target ? label(target) : op.to}`;
        if (!source || !target) {
          step.error = unknown(!source ? op.from : op.to);
          break;
        }
        const gone = graph.edges.filter((e) => e.source === source && e.target === target && (!op.fromPort || e.sourcePort === op.fromPort) && (!op.toPort || e.targetPort === op.toPort));
        if (!gone.length) {
          step.error = 'They are not connected';
          break;
        }
        graph = { ...graph, edges: graph.edges.filter((e) => !gone.includes(e)) };
        break;
      }
      case 'configure': {
        const id = resolve(op.node);
        step.text = `Change the settings of ${id ? label(id) : op.node}`;
        if (!id) {
          step.error = unknown(op.node);
          break;
        }
        const node = graph.nodes.find((n) => n.id === id)!;
        setNode({ ...node, config: configured(node, op.config, ctx, warnings) });
        break;
      }
      case 'rename': {
        const id = resolve(op.node);
        step.text = `Rename ${id ? label(id) : op.node} to “${op.name.trim()}”`;
        if (!id) {
          step.error = unknown(op.node);
          break;
        }
        const node = graph.nodes.find((n) => n.id === id)!;
        setNode({ ...node, name: op.name.trim() || undefined });
        break;
      }
      case 'remove': {
        const id = resolve(op.node);
        step.text = `Remove ${id ? label(id) : op.node}`;
        if (!id) {
          step.error = unknown(op.node);
          break;
        }
        graph = {
          ...graph,
          nodes: graph.nodes.filter((n) => n.id !== id),
          edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
          ...(graph.groups && { groups: graph.groups.map((g) => ({ ...g, nodeIds: g.nodeIds.filter((x) => x !== id) })).filter((g) => g.nodeIds.length) }),
        };
        const at = added.indexOf(id);
        if (at >= 0) added.splice(at, 1);
        break;
      }
    }
    if (warnings.length) step.warnings = warnings;
  }
  graph = placeNew(graph, start, added);
  return { graph, steps, added, errors: steps.filter((s) => s.error).map((s) => `${s.text}: ${s.error}`) };
}

/** The ports for a connection: the ones asked for, or the only (or best) pair that fits. */
function choosePorts(
  graph: Graph, source: string, target: string, op: { fromPort?: string; toPort?: string }, registry: NodeRegistry,
): { sourcePort: string; targetPort: string } | { error: string } {
  const s = graph.nodes.find((n) => n.id === source)!;
  const t = graph.nodes.find((n) => n.id === target)!;
  const outs = registry[s.type].outputs.filter((p) => !op.fromPort || p.name === op.fromPort);
  const ins = registry[t.type].inputs.filter((p) => !op.toPort || p.name === op.toPort);
  if (!outs.length) return { error: `${registry[s.type].label} has no output “${op.fromPort}” (it has ${names(registry[s.type].outputs)})` };
  if (!ins.length) return { error: `${registry[t.type].label} has no input “${op.toPort}” (it has ${names(registry[t.type].inputs)})` };
  const pairs: { sourcePort: string; targetPort: string; score: number }[] = [];
  let firstError: string | undefined;
  for (const [oi, o] of outs.entries()) {
    for (const [ii, i] of ins.entries()) {
      const error = edgeError(graph, { source, target, sourcePort: o.name, targetPort: i.name }, registry);
      if (error) {
        firstError ??= error;
        continue;
      }
      // Same port type first, then the ports in the order the node lists them (main output, first free input).
      pairs.push({ sourcePort: o.name, targetPort: i.name, score: (o.type === i.type ? 0 : 100) + oi * 10 + ii });
    }
  }
  if (!pairs.length) return { error: firstError ?? 'These cannot be connected' };
  pairs.sort((a, b) => a.score - b.score);
  return { sourcePort: pairs[0].sourcePort, targetPort: pairs[0].targetPort };
}

const names = (ports: PortDef[]) => (ports.length ? ports.map((p) => `“${p.name}”`).join(', ') : 'none');

/** A node's settings with the model's changes: a shallow merge, with the shortcuts the prompt describes. */
function configured(node: GraphNode, change: Record<string, unknown>, ctx: PlanContext, warnings: string[]): unknown {
  const current = { ...(node.config as Record<string, unknown>) };
  const next: Record<string, unknown> = { ...change };
  const findFile = (ref: unknown) => {
    if (typeof ref !== 'string') return undefined;
    const files = Object.values(ctx.files);
    return files.find((f) => f.id === ref) ?? files.find((f) => f.name.toLowerCase() === ref.toLowerCase());
  };

  if (node.type === 'selector' || node.type === 'extractor') {
    // Another mode: its own fields only (the old mode's would be left over).
    if (typeof next.mode === 'string' && next.mode !== current.mode) {
      for (const k of Object.keys(current)) if (!['place', 'join', 'expect', 'keepContext'].includes(k)) delete current[k];
    }
    if (next.mode === 'manual' || next.mode === 'point') {
      warnings.push(`Mode “${next.mode}” is picked by hand in the preview: select the node and pick it there`);
      if (next.mode === 'manual') next.anchors = [];
    }
  }
  if (node.type === 'documentSource' && ('file' in next || 'fileId' in next)) {
    const ref = next.file ?? next.fileId;
    delete next.file;
    const file = findFile(ref);
    if (file) next.fileId = file.id;
    else {
      delete next.fileId;
      warnings.push(`There is no file “${String(ref)}” in the project: choose it in the node's settings`);
    }
  }
  if (node.type === 'object' && isRecord(next.content)) {
    const content = { ...next.content };
    if ('file' in content || 'fileId' in content) {
      const file = findFile(content.file ?? content.fileId);
      delete content.file;
      if (file) content.fileId = file.id;
      else {
        delete content.fileId;
        warnings.push('The image or video file is not in the project: choose it in the node\'s settings');
      }
    }
    next.content = content;
  }
  if (node.type === 'snippet') {
    if ('library' in next) {
      const id = String(next.library);
      delete next.library;
      const found = ctx.library[id] ? id : Object.keys(ctx.library).find((k) => latestVersion(ctx.library, k)?.name.toLowerCase() === id.toLowerCase());
      const snippet = found ? latestVersion(ctx.library, found) : undefined;
      if (snippet && found) {
        current.snippet = structuredClone(snippet);
        current.ref = { id: found, version: snippet.version };
        delete current.custom;
        delete current.params;
      } else warnings.push(`There is no snippet “${id}” in the library`);
    }
    if ('template' in next || 'mode' in next) {
      const own: Snippet = {
        kind: 'snippet',
        id: `assistant-${node.id}`,
        name: typeof next.snippetName === 'string' ? next.snippetName : node.name ?? 'Snippet',
        version: 1,
        mode: (['wrap', 'prepend', 'append', 'replace', 'attributes'].includes(String(next.mode)) ? next.mode : 'wrap') as Snippet['mode'],
        template: typeof next.template === 'string' ? next.template : '{{content}}',
        params: [],
        ...(next.inside === true && { inside: true }),
      };
      delete next.template;
      delete next.mode;
      delete next.inside;
      delete next.snippetName;
      const problems = validateSnippet(own);
      if (problems.length) warnings.push(`The snippet's own template: ${problems.join('; ')}`);
      else {
        current.snippet = own;
        delete current.ref;
        delete current.custom;
        delete current.params;
      }
    }
    if (isRecord(next.custom)) {
      delete current.ref;
      delete current.params;
      next.custom = { className: String(next.custom.className ?? `custom-${node.id}`), wrap: ['none', 'div', 'span'].includes(String(next.custom.wrap)) ? next.custom.wrap : 'none' };
    }
  }
  for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
  const merged = { ...current, ...next };
  for (const [k, v] of Object.entries(change)) if (v === null) delete merged[k];
  return merged;
}

/** Positions for new nodes: to the right of what feeds them, else in a new column on the right. */
function placeNew(graph: Graph, before: Graph, added: string[]): Graph {
  if (!added.length) return graph;
  const pos = new Map(graph.nodes.filter((n) => n.position).map((n) => [n.id, n.position!]));
  const rightmost = Math.max(0, ...before.nodes.map((n) => n.position?.x ?? 0));
  const topmost = before.nodes.length ? Math.min(...before.nodes.map((n) => n.position?.y ?? 0)) : 120;
  const taken = (p: { x: number; y: number }) => [...pos.values()].some((q) => Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 100);
  let orphans = 0;
  // Sources first, so each node can sit to the right of the ones feeding it.
  const order = [...added].sort((a, b) => depth(graph, a, added) - depth(graph, b, added));
  for (const id of order) {
    const feeders = graph.edges.filter((e) => e.target === id && pos.has(e.source)).map((e) => pos.get(e.source)!);
    let p = feeders.length
      ? { x: Math.max(...feeders.map((f) => f.x)) + SPACING.x, y: Math.min(...feeders.map((f) => f.y)) }
      : { x: (before.nodes.length ? rightmost + SPACING.x : 40), y: topmost + orphans++ * SPACING.y };
    while (taken(p)) p = { x: p.x, y: p.y + SPACING.y };
    pos.set(id, p);
  }
  return { ...graph, nodes: graph.nodes.map((n) => (added.includes(n.id) ? { ...n, position: pos.get(n.id) } : n)) };
}

/** How many new nodes lie before this one (so they are placed first). */
function depth(graph: Graph, id: string, added: string[], seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const feeders = graph.edges.filter((e) => e.target === id && added.includes(e.source)).map((e) => e.source);
  return feeders.length ? 1 + Math.max(...feeders.map((f) => depth(graph, f, added, seen))) : 0;
}

/** The id the editor would give a new node of this type. */
function nextId(graph: Graph, type: string): string {
  const used = new Set(graph.nodes.map((n) => n.id));
  let i = graph.nodes.length + 1;
  while (used.has(`${type}-${i}`)) i++;
  return `${type}-${i}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
