import type React from 'react';
import { nodeRegistry } from '../../engine';
import { editorStore, selectedNodeIds, useEditor } from '../../store/editor-store';
import { NODE_COLORS, UNKNOWN_NODE_COLOR } from '../node-colors';
import { GroupInspector, InGroup } from './GroupInspector';
import { nodeLabel } from '../node-label';
import { LibraryEditor } from '../library/LibraryEditor';
import { TextField } from './fields';
import { ConnectorEditor } from './ConnectorEditor';
import { ExtractorEditor } from './ExtractorEditor';
import { ObjectEditor } from './ObjectEditor';
import { OutputEditor } from './OutputEditor';
import { ReplaceEditor } from './ReplaceEditor';
import { PositionEditor } from './PositionEditor';
import { ResultPanel } from './ResultPanel';
import { SelectorEditor } from './SelectorEditor';
import { SnippetEditor } from './SnippetEditor';
import { SourceEditor } from './SourceEditor';
import { MinimiseButton } from '../panels';

const EDITORS = {
  documentSource: SourceEditor,
  selector: SelectorEditor,
  snippet: SnippetEditor,
  extractor: ExtractorEditor,
  object: ObjectEditor,
  replace: ReplaceEditor,
  position: PositionEditor,
  output: OutputEditor,
  connector: ConnectorEditor,
} as const;

export function Inspector({ onMinimise }: { onMinimise: () => void }) {
  const minimise = <MinimiseButton panel="inspector" onClick={onMinimise} />;
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const result = useEditor((s) => (s.selectedId ? s.results[s.selectedId] : undefined));
  const openSnippetId = useEditor((s) => s.openSnippetId);
  const selection = useEditor((s) => selectedNodeIds(s).join(' '));
  const groupId = useEditor((s) => (s.selectedGroupId && s.graph.groups?.some((g) => g.id === s.selectedGroupId) ? s.selectedGroupId : undefined));

  if (openSnippetId) {
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <div className="inspector-head">
          <h2>Snippet library</h2>
          <span className="muted small">{openSnippetId}</span>
          <button type="button" className="ghost" onClick={() => editorStore.getState().openSnippet(undefined)}>
            Close
          </button>
          {minimise}
        </div>
        <div className="inspector-body" key={openSnippetId}>
          <LibraryEditor id={openSnippetId} />
        </div>
      </aside>
    );
  }

  if (groupId) return <GroupInspector groupId={groupId} minimise={minimise} />;
  if (selection.includes(' ')) return <MultiSelection ids={selection.split(' ')} minimise={minimise} />;

  if (!node) {
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <div className="panel-head">
          <h2>Inspector</h2>
          {minimise}
        </div>
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
          {minimise}
        </span>
      </div>
      {/* key: a fresh editor for each node, so local state never leaks between nodes */}
      <div className="inspector-body" key={node.id}>
        <InGroup nodeId={node.id} />
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

/** Several nodes selected: which ones, and what can be done with all of them. */
function MultiSelection({ ids, minimise }: { ids: string[]; minimise: React.ReactNode }) {
  const nodes = useEditor((s) => s.graph.nodes);
  const mainId = useEditor((s) => s.selectedId);
  const store = editorStore.getState();
  const picked = ids.map((id) => nodes.find((n) => n.id === id)).filter((n) => n !== undefined);
  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="inspector-head">
        <h2>{picked.length} nodes selected</h2>
        <span className="inspector-head-actions">
          <button type="button" className="ghost danger" title="Delete these nodes and their connections (Backspace)" onClick={() => store.removeElements(ids, [])}>
            Delete {picked.length} nodes
          </button>
          {minimise}
        </span>
      </div>
      <GroupActions ids={ids} />
      <ul className="multi-selection" aria-label="Selected nodes">
        {picked.map((n) => (
          <li key={n.id}>
            <span className="swatch" style={{ background: NODE_COLORS[n.type] ?? UNKNOWN_NODE_COLOR }} aria-hidden="true" />
            <button type="button" className="link" title="Select only this node" onClick={() => store.select(n.id)}>
              {nodeLabel(n)}
            </button>
            <span className="muted small">
              {nodeRegistry[n.type]?.label ?? n.type}
              {n.id === mainId ? ' · shown in the preview' : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Shift-, Ctrl- or Cmd-click a node to add it or take it out; drag one of them to move them all. Click a name to
        edit that node alone.
      </p>
    </aside>
  );
}

/** Group the selected nodes, or add them to the one group some of them are in. */
function GroupActions({ ids }: { ids: string[] }) {
  const groups = useEditor((s) => s.graph.groups);
  const store = editorStore.getState();
  const touched = (groups ?? []).filter((g) => g.nodeIds.some((id) => ids.includes(id)));
  const into = touched.length === 1 && !ids.every((id) => touched[0].nodeIds.includes(id)) ? touched[0] : undefined;
  return (
    <div className="button-row">
      <button type="button" title="Put these nodes in a new group (Ctrl+G)" onClick={() => store.groupNodes(ids)}>
        Group
      </button>
      {into && (
        <button type="button" className="ghost" onClick={() => store.addToGroup(into.id, ids)}>
          Add to “{into.name}”
        </button>
      )}
    </div>
  );
}
