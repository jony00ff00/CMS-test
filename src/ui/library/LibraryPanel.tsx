import { editorStore, useEditor } from '../../store/editor-store';

export const DRAG_SNIPPET = 'application/x-cms-snippet';

/** The snippet library, below the node palette. Click to edit, drag onto the canvas to use. */
export function LibraryPanel() {
  const library = useEditor((s) => s.library);
  const openId = useEditor((s) => s.openSnippetId);
  const snippets = Object.values(library).map((versions) => versions[versions.length - 1]);
  return (
    <section className="library" aria-label="Snippet library">
      <div className="library-title">
        <h2>Snippets</h2>
        <button type="button" className="ghost small-button" onClick={() => editorStore.getState().createSnippet()}>
          New
        </button>
      </div>
      <ul>
        {snippets.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`library-item${openId === s.id ? ' is-open' : ''}`}
              draggable
              title={s.description}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_SNIPPET, s.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => editorStore.getState().openSnippet(s.id)}
            >
              <span className="library-name">{s.name}</span>
              <span className="muted small">
                v{s.version} · {s.mode}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Click to edit, drag onto the canvas to use.</p>
    </section>
  );
}
