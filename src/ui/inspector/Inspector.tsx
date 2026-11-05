import { nodeRegistry } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { OutputEditor } from './OutputEditor';
import { ResultPanel } from './ResultPanel';
import { SelectorEditor } from './SelectorEditor';
import { SnippetEditor } from './SnippetEditor';
import { SourceEditor } from './SourceEditor';

const EDITORS = {
  documentSource: SourceEditor,
  selector: SelectorEditor,
  snippet: SnippetEditor,
  output: OutputEditor,
} as const;

export function Inspector() {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const result = useEditor((s) => (s.selectedId ? s.results[s.selectedId] : undefined));

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
        <button type="button" className="ghost danger" onClick={() => editorStore.getState().removeNodes([node.id])}>
          Delete
        </button>
      </div>
      {/* key: a fresh editor for each node, so local state never leaks between nodes */}
      <div className="inspector-body" key={node.id}>
        {Editor ? <Editor node={node} /> : <p className="error-text">Unknown node type "{node.type}"</p>}
      </div>
      <ResultPanel result={result} />
    </aside>
  );
}
