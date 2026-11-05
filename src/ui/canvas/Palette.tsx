import { nodeRegistry } from '../../engine';
import { useEditor } from '../../store/editor-store';
import { LibraryPanel } from '../library/LibraryPanel';

export const DRAG_TYPE = 'application/x-cms-node';

export function Palette() {
  const addNode = useEditor((s) => s.addNode);
  return (
    <aside className="panel palette" aria-label="Node palette">
      <h2>Nodes</h2>
      <p className="muted small">Click to add, or drag onto the canvas.</p>
      <ul>
        {Object.values(nodeRegistry).map((def) => (
          <li key={def.type}>
            <button
              type="button"
              className={`palette-item palette-${def.type}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, def.type);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addNode(def.type)}
              title={def.description}
            >
              <span className="palette-label">{def.label}</span>
              <span className="palette-description">{def.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <LibraryPanel />
    </aside>
  );
}
