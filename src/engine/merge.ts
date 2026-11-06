// Combining several inputs into one document by applying each input's changes in turn.
//
// When an Output gets, say, a Snippet's result and an Insert's result that both started from the same source,
// putting them one after another would show the document twice. Instead, the evaluator runs a hidden copy of the
// graph in which the second input's nodes start from the first input's result (and so on), so all the changes
// end up in one document. Selectors and picked points are anchors, so they are found again in the changed text.
import type { Graph, GraphEdge, NodeRegistry } from './graph';

export interface MergePlan {
  /** The graph to run: the user's graph plus hidden copies of the chained nodes. */
  graph: Graph;
  /** Ids of the hidden copies (their results are not shown). */
  hidden: Set<string>;
  /** Merging node id → how many inputs were combined into one document. */
  merged: Record<string, number>;
}

/** Separates the parts of a hidden copy's id. Not a character node ids use. */
const SEP = '~';

export function planMerges(graph: Graph, registry: NodeRegistry): MergePlan {
  const hidden = new Set<string>();
  const merged: Record<string, number> = {};
  let nodes = graph.nodes;
  let edges = graph.edges;

  const parentsOf = new Map<string, string[]>();
  for (const e of graph.edges) parentsOf.set(e.target, [...(parentsOf.get(e.target) ?? []), e.source]);
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) for (const p of parentsOf.get(stack.pop()!) ?? []) if (!out.has(p)) (out.add(p), stack.push(p));
    return out;
  };
  const downstream = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of graph.edges) if (e.source === cur && !out.has(e.target)) (out.add(e.target), stack.push(e.target));
    }
    return out;
  };
  const order = new Map(topoIds(graph).map((id, i) => [id, i]));
  const portType = (nodeId: string, port: string) => {
    const n = graph.nodes.find((x) => x.id === nodeId);
    return n && registry[n.type]?.outputs.find((p) => p.name === port)?.type;
  };

  for (const target of graph.nodes) {
    const def = registry[target.type];
    const ports = def?.mergePorts?.(target.config as never);
    if (!ports?.length) continue;
    {
      const inputs = ports.flatMap((port) => graph.edges.filter((e) => e.target === target.id && e.targetPort === port));
      if (inputs.length < 2) continue;
      // Only documents can be merged (a selection or HTML has no changes to apply again).
      if (!inputs.every((e) => portType(e.source, e.sourcePort) === 'document')) continue;

      // The latest document all inputs come from.
      const sets = inputs.map((e) => ancestors(e.source));
      const common = [...sets[0]].filter((id) => sets.every((s) => s.has(id)));
      const base = common
        .filter((id) => graph.edges.some((e) => e.source === id && portType(id, e.sourcePort) === 'document'))
        .sort((a, b) => order.get(b)! - order.get(a)!)[0];
      if (!base) continue; // nothing shared: the documents are shown one after another
      const afterBase = downstream(base);

      let prev = { node: inputs[0].source, port: inputs[0].sourcePort };
      const added: GraphEdge[] = [];
      inputs.slice(1).forEach((input, k) => {
        const i = k + 1;
        // The nodes between the shared document and this input (shared Selectors after it included: they must
        // look at the changed document too).
        const branch = [...sets[i]].filter((id) => afterBase.has(id));
        if (branch.length === 0) return; // this input is the shared document itself: nothing to add
        const copy = (id: string) => (branch.includes(id) ? `${target.id}${SEP}${i}${SEP}${id}` : id);
        for (const id of branch) {
          const original = graph.nodes.find((n) => n.id === id)!;
          nodes = [...nodes, { ...original, id: copy(id) }];
          hidden.add(copy(id));
        }
        for (const e of graph.edges) {
          if (!branch.includes(e.target)) continue;
          const fromBase = e.source === base && portType(base, e.sourcePort) === 'document';
          added.push({
            ...e,
            id: `${target.id}${SEP}${i}${SEP}${e.id}`,
            source: fromBase ? prev.node : copy(e.source),
            sourcePort: fromBase ? prev.port : e.sourcePort,
            target: copy(e.target),
          });
        }
        prev = { node: copy(input.source), port: input.sourcePort };
      });

      edges = [
        ...edges.filter((e) => !(e.target === target.id && ports.includes(e.targetPort))),
        ...added,
        { id: `${target.id}${SEP}combined`, source: prev.node, sourcePort: prev.port, target: target.id, targetPort: ports[0] },
      ];
      merged[target.id] = inputs.length;
    }
  }
  return { graph: hidden.size || Object.keys(merged).length ? { nodes, edges } : graph, hidden, merged };
}

function topoIds(graph: Graph): string[] {
  const incoming = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (incoming.has(e.target)) incoming.set(e.target, incoming.get(e.target)! + 1);
  const ready = graph.nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const out: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const e of graph.edges) {
      if (e.source !== id || !incoming.has(e.target)) continue;
      const left = incoming.get(e.target)! - 1;
      incoming.set(e.target, left);
      if (left === 0) ready.push(e.target);
    }
  }
  return out;
}
