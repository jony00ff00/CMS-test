import { nodeRegistry } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { LibraryEditor } from '../library/LibraryEditor';
import { TextField } from './fields';
import { InsertEditor } from './InsertEditor';
import { OutputEditor } from './OutputEditor';
import { ResultPanel } from './ResultPanel';
import { SelectorEditor } from './SelectorEditor';
import { SnippetEditor } from './SnippetEditor';
import { SourceEditor } from './SourceEditor';

const EDITORS = {
  documentSource: SourceEditor,
  selector: SelectorEditor,
  snippet: SnippetEditor,
  insert: InsertEditor,
  output: OutputEditor,
} as const;

export function Inspector() {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const result = useEditor((s) => (s.selectedId ? s.results[s.selectedId] : undefined));
  const openSnippetId = useEditor((s) => s.openSnippetId);

  if (openSnippetId) {
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <div className="inspector-head">
          <h2>Snippet library</h2>
          <span className="muted small">{openSnippetId}</span>
          <button type="button" className="ghost" onClick={() => editorStore.getState().openSnippet(undefined)}>
            Close
          </button>
        </div>
        <div className="inspector-body" key={openSnippetId}>
          <LibraryEditor id={openSnippetId} />
        </div>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        <p className="muted">Select a node to edit it.</p>
        <p className="muted small">Connect an output (right side of a node) to an input of the same kind (left side). Delete with Backspace.</p>
      </aside>
    );
  }
  const def = nodeRegistry[node.type];
  const Editor = EDITORS[node.type as keyof typeof EDITORS];
  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="inspector-head">
        <h2>{def?.label ?? node.type}</h2>
        <span className="muted small">{node.id}</span>
        <span className="inspector-head-actions">
          <button type="button" className="ghost" title="Copy this node with its settings and inputs (Ctrl+D)" onClick={() => editorStore.getState().duplicateNode(node.id)}>
            Duplicate
          </button>
          <button type="button" className="ghost danger" title="Delete this node and its connections (Backspace)" onClick={() => editorStore.getState().removeElements([node.id], [])}>
            Delete
          </button>
        </span>
      </div>
      {/* key: a fresh editor for each node, so local state never leaks between nodes */}
      <div className="inspector-body" key={node.id}>
        <TextField
          label="Name"
          value={node.name ?? ''}
          placeholder={`${def?.label ?? node.type} (${node.id})`}
          hint="Shown on the canvas and in the preview. Double-click a node's title to rename it there."
          onChange={(name) => editorStore.getState().renameNode(node.id, name)}
        />
        {Editor ? <Editor node={node} /> : <p className="error-text">Unknown node type "{node.type}"</p>}
      </div>
      <ResultPanel result={result} />
    </aside>
  );
}
