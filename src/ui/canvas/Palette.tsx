import { nodeRegistry } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { MinimiseButton } from '../panels';

export const DRAG_TYPE = 'application/x-cms-node';
/** Dragged with DRAG_TYPE: a note, not a node. */
export const NOTE_DRAG = 'note';

export function Palette({ onMinimise }: { onMinimise: () => void }) {
  const addNode = useEditor((s) => s.addNode);
  return (
    <aside className="panel palette" aria-label="Node palette">
      <div className="panel-head">
        <h2>Nodes</h2>
        <MinimiseButton panel="palette" onClick={onMinimise} />
      </div>
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
      <h2 className="palette-section">Annotations</h2>
      <ul>
        <li>
          <button
            type="button"
            className="palette-item palette-note"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, NOTE_DRAG);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => editorStore.getState().addNote()}
            title="A note on the canvas, to explain part of the flow. Not a node: it has no connections and changes nothing."
          >
            <span className="palette-label">Note</span>
            <span className="palette-description">Text on the canvas that explains part of the flow</span>
          </button>
        </li>
      </ul>
      <GroupList />
    </aside>
  );
}

/** Every group: click one to select it and fit the canvas to it. */
function GroupList() {
  const groups = useEditor((s) => s.graph.groups);
  const selectedGroupId = useEditor((s) => s.selectedGroupId);
  return (
    <section className="palette-groups" aria-label="Groups">
      <h2>Groups</h2>
      {!groups?.length ? (
        <p className="muted small">Select several nodes and press Ctrl+G (or “Group” in the inspector) to group them.</p>
      ) : (
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className={`ghost${g.id === selectedGroupId ? ' is-current' : ''}`}
                aria-pressed={g.id === selectedGroupId}
                title="Select this group and show it on the canvas"
                onClick={() => editorStore.getState().focusGroup(g.id)}
              >
                <span className="swatch" style={{ background: g.color ?? '#64748b' }} aria-hidden="true" />
                <span className="group-list-name">{g.name}</span>
                <span className="muted small">
                  {g.nodeIds.length}
                  {g.collapsed ? ' · collapsed' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
