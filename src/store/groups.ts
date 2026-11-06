// Groups of nodes on the canvas: pure helpers shared by the store, project files and the canvas.
import type { Graph, NodeGroup } from '../engine';

/** The colours a group can have (the first is the default for the first group, and so on). */
export const GROUP_COLORS = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#64748b'];

export const groupsOf = (graph: Graph): NodeGroup[] => graph.groups ?? [];

/** The group a node is in, if any. */
export const groupOfNode = (graph: Graph, nodeId: string) => groupsOf(graph).find((g) => g.nodeIds.includes(nodeId));

/** "Group N" with the lowest N not used yet. */
export function nextGroupName(groups: NodeGroup[]): string {
  const names = new Set(groups.map((g) => g.name));
  let i = 1;
  while (names.has(`Group ${i}`)) i++;
  return `Group ${i}`;
}

export function nextGroupId(groups: NodeGroup[]): string {
  const ids = new Set(groups.map((g) => g.id));
  let i = groups.length + 1;
  while (ids.has(`group-${i}`)) i++;
  return `group-${i}`;
}

/** The colour the next group gets: the first one fewest groups use. */
export function nextGroupColor(groups: NodeGroup[]): string {
  const uses = (c: string) => groups.filter((g) => g.color === c).length;
  return GROUP_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best), GROUP_COLORS[0]);
}

/**
 * Groups without nodes that no longer exist; a group left empty is gone. Returns the same array when nothing
 * changed (so the graph keeps its identity).
 */
export function pruneGroups(groups: NodeGroup[] | undefined, nodeIds: Set<string>): NodeGroup[] | undefined {
  if (!groups) return groups;
  let changed = false;
  const next = groups.flatMap((g) => {
    const kept = g.nodeIds.filter((id) => nodeIds.has(id));
    if (kept.length === g.nodeIds.length) return [g];
    changed = true;
    return kept.length ? [{ ...g, nodeIds: kept }] : [];
  });
  return changed ? next : groups;
}

/** Take nodes out of whatever group they are in (groups left empty are gone). */
export function withoutNodes(groups: NodeGroup[], ids: string[]): NodeGroup[] {
  const out = new Set(ids);
  return groups.flatMap((g) => {
    if (!g.nodeIds.some((id) => out.has(id))) return [g];
    const kept = g.nodeIds.filter((id) => !out.has(id));
    return kept.length ? [{ ...g, nodeIds: kept }] : [];
  });
}

/** The connections that cross a group's edge, and the ones inside it. */
export function groupConnections(graph: Graph, group: NodeGroup) {
  const inside = new Set(group.nodeIds);
  return {
    incoming: graph.edges.filter((e) => !inside.has(e.source) && inside.has(e.target)),
    outgoing: graph.edges.filter((e) => inside.has(e.source) && !inside.has(e.target)),
    internal: graph.edges.filter((e) => inside.has(e.source) && inside.has(e.target)),
  };
}
