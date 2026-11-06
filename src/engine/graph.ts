// The node graph: node definitions, typed ports, validation, ordering and cached evaluation.
import { hashBytes, hashValue } from './hash';
import { planMerges } from './merge';
import type { SourceFile } from './source';

/** What travels along an edge. Edges only connect ports of the same type. */
/** `result`: an Output's finished document, which a Connector turns back into a `document`. */
export type PortType = 'document' | 'selection' | 'html' | 'result';

export interface PortDef {
  name: string;
  type: PortType;
  label: string;
  /**
   * Inputs only: accepts any number of connections. The node then gets an array of values, in the order the
   * connections appear in `graph.edges` (see `moveEdge`).
   */
  multiple?: boolean;
}

/** A file the user added to the project. Source nodes refer to it by id. */
export interface StoredFile extends SourceFile {
  id: string;
  /** Content hash, so cached results change when the file does. */
  hash: string;
}

export interface EvalContext {
  files: Record<string, StoredFile>;
}

export interface NodeOutput {
  outputs: Record<string, unknown>;
  warnings?: string[];
  /** Small facts for the UI, e.g. { matches: 3 }. */
  info?: Record<string, string | number | boolean>;
  /** Set when the node cannot run yet because something is missing (e.g. no file chosen). Not an error. */
  waiting?: string;
}

export interface NodeDefinition<Config = unknown> {
  type: string;
  label: string;
  description: string;
  inputs: PortDef[];
  outputs: PortDef[];
  defaultConfig(): Config;
  /** Extra things the result depends on besides config and inputs (e.g. the content hash of a file). */
  dependencies?(config: Config, ctx: EvalContext): unknown;
  /**
   * For nodes with a `multiple` input: when this returns true, several inputs that come from the same document
   * are combined by applying each input's changes in turn (see merge.ts), and the node gets one document.
   */
  mergesInputs?(config: Config): boolean;
  /** Must not change its inputs or config. Inputs are keyed by input port name. */
  evaluate(inputs: Record<string, unknown>, config: Config, ctx: EvalContext): Promise<NodeOutput>;
}

export type NodeRegistry = Record<string, NodeDefinition<any>>;

export interface GraphNode {
  id: string;
  type: string;
  /** A name the user gave the node. Only for display: it never changes results. */
  name?: string;
  config: unknown;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------------------------
// Validation

export type EdgeCandidate = Omit<GraphEdge, 'id'> & { id?: string };

/** Why an edge cannot be added, or undefined when it can. */
export function edgeError(graph: Graph, edge: EdgeCandidate, registry: NodeRegistry): string | undefined {
  const source = graph.nodes.find((n) => n.id === edge.source);
  const target = graph.nodes.find((n) => n.id === edge.target);
  if (!source || !target) return 'Both ends of a connection must be nodes in the graph';
  if (source.id === target.id) return 'A node cannot connect to itself';
  const sourceDef = registry[source.type];
  const targetDef = registry[target.type];
  if (!sourceDef || !targetDef) return `Unknown node type "${!sourceDef ? source.type : target.type}"`;
  const out = sourceDef.outputs.find((p) => p.name === edge.sourcePort);
  const inp = targetDef.inputs.find((p) => p.name === edge.targetPort);
  if (!out) return `${sourceDef.label} has no output "${edge.sourcePort}"`;
  if (!inp) return `${targetDef.label} has no input "${edge.targetPort}"`;
  if (out.type !== inp.type) return `Cannot connect a ${out.type} output to a ${inp.type} input`;
  const others = graph.edges.filter((e) => e.id !== edge.id && e.target === edge.target && e.targetPort === edge.targetPort);
  if (!inp.multiple && others.length) return `${targetDef.label} input "${inp.label}" is already connected`;
  if (others.some((e) => e.source === edge.source && e.sourcePort === edge.sourcePort)) return 'These two are already connected';
  if (reaches(graph, edge.target, edge.source)) return 'This connection would create a loop';
  return undefined;
}

/** Is `to` reachable from `from` by following edges? */
function reaches(graph: Graph, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

let edgeCounter = 0;

/** Add an edge, returning a new graph, or an error message. Never changes `graph`. */
export function connect(graph: Graph, edge: EdgeCandidate, registry: NodeRegistry): { graph: Graph } | { error: string } {
  const error = edgeError(graph, edge, registry);
  if (error) return { error };
  const id = edge.id ?? `e${Date.now().toString(36)}-${(edgeCounter++).toString(36)}`;
  return { graph: { ...graph, edges: [...graph.edges, { ...edge, id }] } };
}

export interface GraphIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
}

/** Everything wrong with a graph (for graphs loaded from a file, which may have been edited by hand). */
export function validateGraph(graph: Graph, registry: NodeRegistry): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) issues.push({ nodeId: n.id, message: `Duplicate node id "${n.id}"` });
    ids.add(n.id);
    if (!registry[n.type]) issues.push({ nodeId: n.id, message: `Unknown node type "${n.type}"` });
  }
  graph.edges.forEach((e, i) => {
    const before = { ...graph, edges: graph.edges.slice(0, i) };
    const error = edgeError(before, e, registry);
    if (error) issues.push({ edgeId: e.id, message: error });
  });
  return issues;
}

/** Node ids so that every node comes after the nodes it depends on. Throws on a loop. */
export function topologicalSort(graph: Graph): string[] {
  const incoming = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (incoming.has(e.target) && incoming.has(e.source)) incoming.set(e.target, incoming.get(e.target)! + 1);
  // Keep the order of graph.nodes among nodes that are ready at the same time, so results are stable.
  const ready = graph.nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of graph.edges) {
      if (e.source !== id || !incoming.has(e.target)) continue;
      const left = incoming.get(e.target)! - 1;
      incoming.set(e.target, left);
      if (left === 0) ready.push(e.target);
    }
  }
  if (order.length !== graph.nodes.length) {
    const stuck = graph.nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    throw new Error(`The graph has a loop through ${stuck.join(', ')}`);
  }
  return order;
}

/** Move a connection earlier (-1) or later (+1) among the connections into the same input. Never changes `graph`. */
export function moveEdge(graph: Graph, edgeId: string, delta: -1 | 1): Graph {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return graph;
  const siblings = graph.edges.filter((e) => e.target === edge.target && e.targetPort === edge.targetPort);
  const i = siblings.indexOf(edge);
  const other = siblings[i + delta];
  if (!other) return graph;
  const edges = [...graph.edges];
  const a = edges.indexOf(edge);
  const b = edges.indexOf(other);
  [edges[a], edges[b]] = [edges[b], edges[a]];
  return { ...graph, edges };
}

/** Ids of the nodes that depend on `nodeId`, directly or not. */
export function downstreamOf(graph: Graph, nodeId: string): string[] {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.source === id && !out.has(e.target)) {
        out.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------
// Evaluation

/**
 * ok: ran (or came from the cache). waiting: needs something first (a file, a connection).
 * error: failed. blocked: a node it depends on failed.
 */
export type NodeStatus = 'ok' | 'waiting' | 'error' | 'blocked';

export interface NodeResult {
  status: NodeStatus;
  outputs: Record<string, unknown>;
  warnings: string[];
  info: Record<string, string | number | boolean>;
  /** Why the node is waiting, blocked or failed. */
  message?: string;
  /** Hash of the node's type, config, dependencies and input keys. */
  key: string;
  cached: boolean;
  /** Milliseconds spent evaluating (0 when cached). */
  duration: number;
}

export interface GraphResult {
  results: Record<string, NodeResult>;
  /** Nodes that actually ran this time (not cached), in the order they finished. */
  ran: string[];
}

export interface EvaluatorOptions {
  /** How many node results to keep. Default 200. */
  cacheSize?: number;
}

export class GraphEvaluator {
  private readonly cache = new Map<string, NodeResult>();
  private readonly cacheSize: number;

  constructor(
    private readonly registry: NodeRegistry,
    options: EvaluatorOptions = {},
  ) {
    this.cacheSize = options.cacheSize ?? 200;
  }

  clearCache() {
    this.cache.clear();
  }

  get cachedCount() {
    return this.cache.size;
  }

  /**
   * Evaluate every node. A node's key combines its own settings with the keys of the nodes feeding it,
   * so a change re-runs that node and the nodes after it, and nothing else.
   * Independent branches run at the same time.
   */
  async evaluate(userGraph: Graph, ctx: EvalContext): Promise<GraphResult> {
    // Inputs that are combined run through hidden copies of their nodes (see merge.ts).
    const plan = planMerges(userGraph, this.registry);
    const graph = plan.graph;
    const order = topologicalSort(graph);
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const pending = new Map<string, Promise<NodeResult>>();
    const results: Record<string, NodeResult> = {};
    const ran: string[] = [];

    for (const id of order) {
      const node = nodes.get(id)!;
      const incoming = graph.edges.filter((e) => e.target === id && nodes.has(e.source));
      pending.set(
        id,
        Promise.all(incoming.map((e) => pending.get(e.source)!)).then(async (upstream) => {
          const result = await this.run(node, incoming, upstream, ctx, ran);
          results[id] = result;
          return result;
        }),
      );
    }
    await Promise.all(pending.values());
    for (const id of plan.hidden) delete results[id];
    for (const [id, count] of Object.entries(plan.merged)) {
      const r = results[id];
      if (r) results[id] = { ...r, info: { ...r.info, combined: count } };
    }
    return { results, ran: ran.filter((id) => !plan.hidden.has(id)) };
  }

  private async run(node: GraphNode, incoming: GraphEdge[], upstream: NodeResult[], ctx: EvalContext, ran: string[]): Promise<NodeResult> {
    const def = this.registry[node.type];
    const base = { outputs: {}, warnings: [], info: {}, cached: false, duration: 0 };
    if (!def) return { ...base, status: 'error', message: `Unknown node type "${node.type}"`, key: '' };

    let dependencies: unknown;
    try {
      dependencies = def.dependencies?.(node.config as never, ctx);
    } catch (err) {
      return { ...base, status: 'error', message: (err as Error).message, key: '' };
    }
    // In edge order: for inputs that take several connections, the order matters.
    const inputKeys = incoming.map((e, i) => `${e.targetPort}<-${upstream[i].key}:${e.sourcePort}`);
    const key = hashValue({ type: node.type, config: node.config, dependencies, inputs: inputKeys });

    const failed = upstream.find((r) => r.status === 'error' || r.status === 'blocked');
    if (failed) return { ...base, status: 'blocked', message: 'A node before this one has a problem', key };
    const waiting = upstream.find((r) => r.status === 'waiting');
    if (waiting) return { ...base, status: 'waiting', message: 'Waiting for the nodes before this one', key };

    const inputs: Record<string, unknown> = {};
    incoming.forEach((e, i) => {
      const value = upstream[i].outputs[e.sourcePort];
      if (def.inputs.find((p) => p.name === e.targetPort)?.multiple) {
        inputs[e.targetPort] = [...((inputs[e.targetPort] as unknown[] | undefined) ?? []), value];
      } else inputs[e.targetPort] = value;
    });
    const missing = def.inputs.filter((p) => !(p.name in inputs));
    if (missing.length) {
      return { ...base, status: 'waiting', message: `Connect the ${missing.map((p) => p.label).join(' and ')} input`, key };
    }

    const hit = this.cache.get(key);
    if (hit) {
      // Refresh its place in the cache (least recently used goes first).
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { ...hit, cached: true, duration: 0 };
    }

    const started = performance.now();
    let result: NodeResult;
    try {
      const out = await def.evaluate(inputs, node.config, ctx);
      result = {
        status: out.waiting ? 'waiting' : 'ok',
        outputs: out.waiting ? {} : out.outputs,
        warnings: out.warnings ?? [],
        info: out.info ?? {},
        message: out.waiting,
        key,
        cached: false,
        duration: performance.now() - started,
      };
    } catch (err) {
      result = { ...base, status: 'error', message: (err as Error).message, key, duration: performance.now() - started };
    }
    ran.push(node.id);
    // Waiting and failed results are cheap to recompute and may depend on things outside the key.
    if (result.status === 'ok') this.remember(key, result);
    return result;
  }

  private remember(key: string, result: NodeResult) {
    this.cache.set(key, result);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
  }
}

/** Add a file to a project's file store, with its content hash. */
export function storeFile(name: string, data: SourceFile['data'], id?: string): StoredFile {
  const hash =
    typeof data === 'string' ? hashValue(data) : hashBytes(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  return { id: id ?? `file-${hash}`, name, data, hash };
}
