// Where group frames go on the canvas, and the handles of a collapsed group.
import { nodeRegistry, type Graph, type NodeGroup, type PortType } from '../../engine';
import { nodeLabel } from '../node-label';

/** React Flow id of a group's frame (never a node id: those have no colon). */
export const frameId = (groupId: string) => `group:${groupId}`;
export const isFrameId = (id: string) => id.startsWith('group:');
export const groupIdOfFrame = (id: string) => id.slice('group:'.length);

/** A collapsed group's handle for a member's port: `in|<node>|<port>` or `out|<node>|<port>`. */
export const portHandle = (dir: 'in' | 'out', nodeId: string, port: string) => `${dir}|${nodeId}|${port}`;

/** The node and port a handle stands for: a frame's handle means a member's port; others are themselves. */
export function resolveHandle(nodeId: string, handle: string | null | undefined): { node: string; port: string } {
  if (isFrameId(nodeId) && handle) {
    const [, node, port] = handle.split('|');
    if (node && port) return { node, port };
  }
  return { node: nodeId, port: handle ?? '' };
}

export const FRAME_PADDING = 16;
export const FRAME_HEADER = 34;
const DEFAULT_SIZE = { width: 220, height: 90 };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box around a group's nodes, with room for the header above them. */
export function frameBox(members: { position: { x: number; y: number }; measured?: { width?: number; height?: number } }[]): Box {
  const xs = members.map((m) => m.position.x);
  const ys = members.map((m) => m.position.y);
  const rights = members.map((m) => m.position.x + (m.measured?.width ?? DEFAULT_SIZE.width));
  const bottoms = members.map((m) => m.position.y + (m.measured?.height ?? DEFAULT_SIZE.height));
  const x = Math.min(...xs) - FRAME_PADDING;
  const y = Math.min(...ys) - FRAME_PADDING - FRAME_HEADER;
  return { x, y, width: Math.max(...rights) + FRAME_PADDING - x, height: Math.max(...bottoms) + FRAME_PADDING - y };
}

export interface GroupPort {
  handle: string;
  label: string;
  type: PortType;
}

/**
 * The ports a collapsed group shows: each member port with a connection from or to outside the group, and each
 * member port with no connection at all (so the box can still be connected).
 */
export function collapsedPorts(graph: Graph, group: NodeGroup): { inputs: GroupPort[]; outputs: GroupPort[] } {
  const inside = new Set(group.nodeIds);
  const inputs: GroupPort[] = [];
  const outputs: GroupPort[] = [];
  for (const id of group.nodeIds) {
    const node = graph.nodes.find((n) => n.id === id);
    const def = node && nodeRegistry[node.type];
    if (!node || !def) continue;
    for (const p of def.inputs) {
      const into = graph.edges.filter((e) => e.target === id && e.targetPort === p.name);
      if (into.length === 0 || into.some((e) => !inside.has(e.source))) {
        inputs.push({ handle: portHandle('in', id, p.name), label: `${nodeLabel(node)} · ${p.label}`, type: p.type });
      }
    }
    for (const p of def.outputs) {
      const from = graph.edges.filter((e) => e.source === id && e.sourcePort === p.name);
      if (from.length === 0 || from.some((e) => !inside.has(e.target))) {
        outputs.push({ handle: portHandle('out', id, p.name), label: `${nodeLabel(node)} · ${p.label}`, type: p.type });
      }
    }
  }
  return { inputs, outputs };
}

/** How big a collapsed group's box is. */
export const collapsedSize = (rows: number) => ({ width: 340, height: 48 + Math.max(1, rows) * 22 });
