import { getBezierPath, Position, useStore, type MiniMapNodeProps, type ReactFlowState } from '@xyflow/react';
import { memo } from 'react';

/**
 * The connections as the minimap draws them: one path per edge, from its output handle to its input handle, in
 * flow coordinates (the minimap's SVG uses those). Encoded as a string so the selector's result only changes
 * when a line really moves.
 */
function edgeLines(s: ReactFlowState): string {
  const lines: string[] = [];
  for (const e of s.edges) {
    const from = s.nodeLookup.get(e.source);
    const to = s.nodeLookup.get(e.target);
    if (!from || !to || from.hidden || to.hidden) continue;
    const handle = (n: typeof from, kind: 'source' | 'target', id?: string | null) => {
      const h = n.internals.handleBounds?.[kind]?.find((b) => b.id === id);
      const { x, y } = n.internals.positionAbsolute;
      const w = n.measured.width ?? 0;
      const ht = n.measured.height ?? 0;
      // Without measured handles: the middle of the node's side.
      return h ? { x: x + h.x + h.width / 2, y: y + h.y + h.height / 2 } : { x: kind === 'source' ? x + w : x, y: y + ht / 2 };
    };
    const a = handle(from, 'source', e.sourceHandle);
    const b = handle(to, 'target', e.targetHandle);
    const [d] = getBezierPath({ sourceX: a.x, sourceY: a.y, sourcePosition: Position.Right, targetX: b.x, targetY: b.y, targetPosition: Position.Left });
    lines.push(`${e.className ?? ''}\t${d}`);
  }
  return lines.join('\n');
}

const isFirstNode = (id: string) => (s: ReactFlowState) => s.nodes[0]?.id === id;

function MiniMapNodeView({ id, x, y, width, height, color, strokeColor, strokeWidth, borderRadius, shapeRendering, selected, onClick, className }: MiniMapNodeProps) {
  // The first node draws every connection before its own box, so all lines lie under all boxes.
  const first = useStore(isFirstNode(id));
  return (
    <>
      {first && <MiniMapEdges />}
      <rect
        className={`react-flow__minimap-node${selected ? ' selected' : ''}${className ? ` ${className}` : ''}`}
        x={x}
        y={y}
        rx={borderRadius}
        ry={borderRadius}
        width={width}
        height={height}
        style={{ fill: color, stroke: strokeColor, strokeWidth }}
        shapeRendering={shapeRendering}
        onClick={onClick ? (event) => onClick(event, id) : undefined}
      />
    </>
  );
}

function MiniMapEdges() {
  const lines = useStore(edgeLines);
  if (!lines) return null;
  return (
    <g className="minimap-edges">
      {lines.split('\n').map((line, i) => {
        const [className, d] = line.split('\t');
        return <path key={i} className={`minimap-edge ${className}`} d={d} />;
      })}
    </g>
  );
}

export const MiniMapNode = memo(MiniMapNodeView);
