import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { editorStore } from '../../store/editor-store';

/** A connection that shows a delete button at its middle while it is selected. */
export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={20} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="edge-delete nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            aria-label="Delete this connection"
            title="Delete this connection (or press Backspace)"
            onClick={(e) => {
              e.stopPropagation();
              editorStore.getState().removeEdges([id]);
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M6 2h4M2.5 4h11M4 4l.7 9.2A1 1 0 0 0 5.7 14h4.6a1 1 0 0 0 1-.8L12 4M6.5 7v4.5M9.5 7v4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
