// Page variants: one graph, several Outputs that differ in a few settings.
//
// An Output can name a variant ("static", "interactive"). Any node can hold settings for a variant
// (`GraphNode.variants[name]`: the config keys that differ). Before evaluating, `planVariants` copies, for each
// variant, the nodes that have settings for it and every node between them and an Output of that variant; each copy
// runs with its settings merged in, and the Output reads from the copies. Nodes with no settings for the variant (and
// nothing changed before them) are not copied: both pages share their results.
import type { Graph, GraphEdge, GraphNode } from './graph';
import { hashValue } from './hash';

/** Separates the parts of a variant copy's id: `variant~<name>~<node id>`. */
const SEP = '~';
const PREFIX = `variant${SEP}`;

/** Settings for one variant: the config keys that differ from the node's own. `null` means "not set" (removed). */
export type VariantSettings = Record<string, unknown>;

/** Variant names: letters, digits, spaces, "-" and "_"; at most 40 characters. Anything else is dropped. */
export function cleanVariantName(name: string): string {
  return name.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** The variant an Output makes ("" for none). */
export function outputVariant(node: GraphNode): string {
  if (node.type !== 'output') return '';
  const v = (node.config as { variant?: unknown } | undefined)?.variant;
  return typeof v === 'string' ? cleanVariantName(v) : '';
}

/** Every variant some Output in the graph makes, in node order. */
export function variantNames(graph: Graph): string[] {
  return [...new Set(graph.nodes.map(outputVariant).filter(Boolean))];
}

/** The variants this node can have settings for: those of the Outputs after it (or itself, for an Output). */
export function variantsFor(graph: Graph, nodeId: string): string[] {
  const after = downstreamOf(graph, nodeId);
  after.add(nodeId);
  return variantNames({ ...graph, nodes: graph.nodes.filter((n) => after.has(n.id) && n.type === 'output') });
}

/** A node's settings for a variant: its own config with that variant's differences merged in. */
export function variantConfig<C>(node: GraphNode, variant: string | undefined): C {
  const settings = variant ? node.variants?.[variant] : undefined;
  if (!settings || !isObject(node.config)) return node.config as C;
  const merged: Record<string, unknown> = { ...node.config };
  for (const [k, v] of Object.entries(settings)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  return merged as C;
}

/**
 * The settings to store for a variant so that the node's config for it becomes `next`: the keys that differ from
 * the node's own config (removed keys as `null`). Undefined when nothing differs.
 */
export function variantDifference(base: unknown, next: unknown): VariantSettings | undefined {
  if (!isObject(base) || !isObject(next)) return undefined;
  const out: VariantSettings = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const a = base[k];
    const b = next[k];
    if (b === undefined) {
      if (a !== undefined) out[k] = null;
    } else if (a === undefined || hashValue(a) !== hashValue(b)) out[k] = b;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A node with its settings for `variant` replaced (undefined clears them). */
export function withVariantSettings(node: GraphNode, variant: string, settings: VariantSettings | undefined): GraphNode {
  const variants = { ...node.variants };
  if (settings) variants[variant] = settings;
  else delete variants[variant];
  const { variants: _old, ...rest } = node;
  return Object.keys(variants).length ? { ...rest, variants } : rest;
}

export interface VariantPlan {
  graph: Graph;
  /** Copy id → { variant, the node it copies }. */
  copies: Map<string, { variant: string; nodeId: string }>;
}

export const variantCopyId = (variant: string, nodeId: string) => `${PREFIX}${variant}${SEP}${nodeId}`;

export function planVariants(graph: Graph): VariantPlan {
  const copies = new Map<string, { variant: string; nodeId: string }>();
  const outputs = graph.nodes.filter((n) => outputVariant(n));
  if (!outputs.length || !graph.nodes.some((n) => n.variants && Object.keys(n.variants).length)) return { graph, copies };

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) parents.set(e.target, [...(parents.get(e.target) ?? []), e]);
  let nodes = graph.nodes;
  let edges = graph.edges;
  const addedEdges = new Set<string>();

  for (const output of outputs) {
    const v = outputVariant(output);
    // Nodes before this Output that must be copied: those with settings for v, and everything after them.
    const changed = new Map<string, boolean>();
    const isChanged = (id: string, seen = new Set<string>()): boolean => {
      if (changed.has(id)) return changed.get(id)!;
      if (seen.has(id)) return false;
      seen.add(id);
      const node = byId.get(id);
      const own = !!node?.variants?.[v] && Object.keys(node.variants[v]).length > 0;
      const result = own || (parents.get(id) ?? []).some((e) => isChanged(e.source, seen));
      changed.set(id, result);
      return result;
    };
    const incoming = parents.get(output.id) ?? [];
    if (!incoming.some((e) => isChanged(e.source))) continue;

    const copyNode = (id: string) => {
      const cid = variantCopyId(v, id);
      if (copies.has(cid)) return;
      const node = byId.get(id)!;
      const { variants: _v, ...rest } = node;
      nodes = [...nodes, { ...rest, id: cid, config: variantConfig(node, v) }];
      copies.set(cid, { variant: v, nodeId: id });
      for (const e of parents.get(id) ?? []) {
        if (isChanged(e.source)) copyNode(e.source);
        const eid = `${PREFIX}${v}${SEP}${e.id}`;
        if (addedEdges.has(eid)) continue;
        addedEdges.add(eid);
        edges = [...edges, { ...e, id: eid, source: isChanged(e.source) ? variantCopyId(v, e.source) : e.source, target: cid }];
      }
    };
    for (const e of incoming) if (isChanged(e.source)) copyNode(e.source);
    // The Output reads from the copies (same edge ids and order, so several inputs keep their order).
    edges = edges.map((e) => (e.target === output.id && isChanged(e.source) ? { ...e, source: variantCopyId(v, e.source) } : e));
  }
  return { graph: { ...graph, nodes, edges }, copies };
}

function downstreamOf(graph: Graph, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) if (e.source === cur && !out.has(e.target)) (out.add(e.target), stack.push(e.target));
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
