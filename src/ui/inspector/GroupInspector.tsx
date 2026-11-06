import type { ReactNode } from 'react';
import { nodeRegistry } from '../../engine';
import { GROUP_COLORS } from '../../store/groups';
import { editorStore, useEditor } from '../../store/editor-store';
import { NODE_COLORS, UNKNOWN_NODE_COLOR } from '../node-colors';
import { nodeLabel } from '../node-label';
import { TextField } from './fields';

/** A group's settings: name, colour, its nodes, and what can be done with the whole group. */
export function GroupInspector({ groupId, minimise }: { groupId: string; minimise: ReactNode }) {
  const group = useEditor((s) => s.graph.groups?.find((g) => g.id === groupId));
  const nodes = useEditor((s) => s.graph.nodes);
  if (!group) return null;
  const store = editorStore.getState();
  const members = group.nodeIds.map((id) => nodes.find((n) => n.id === id)).filter((n) => n !== undefined);
  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="inspector-head">
        <h2>Group</h2>
        <span className="muted small">{group.id}</span>
        <span className="inspector-head-actions">
          <button type="button" className="ghost" title="Copy the group: its nodes and their connections" onClick={() => store.duplicateGroup(group.id)}>
            Duplicate
          </button>
          {minimise}
        </span>
      </div>
      <div className="inspector-body" key={group.id}>
        <TextField label="Name" value={group.name} hint="Double-click the name on the canvas to rename it there." onChange={(name) => store.renameGroup(group.id, name)} />
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="group-colors" role="group" aria-label="Colour">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={(group.color ?? GROUP_COLORS[0]) === c}
                style={{ background: c }}
                onClick={() => store.setGroupColor(group.id, c)}
              />
            ))}
          </div>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => store.setGroupCollapsed(group.id, !group.collapsed)}>
            {group.collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button type="button" className="ghost" onClick={() => store.focusGroup(group.id)}>
            Show on canvas
          </button>
        </div>
        <div className="field">
          <span className="field-label">
            {members.length} node{members.length === 1 ? '' : 's'}
          </span>
          <ul className="multi-selection" aria-label="Nodes in the group">
            {members.map((n) => (
              <li key={n.id}>
                <span className="swatch" style={{ background: NODE_COLORS[n.type] ?? UNKNOWN_NODE_COLOR }} aria-hidden="true" />
                <button type="button" className="link" title="Edit this node" onClick={() => store.select(n.id)}>
                  {nodeLabel(n)}
                </button>
                <span className="muted small">{nodeRegistry[n.type]?.label ?? n.type}</span>
                <button type="button" className="link" aria-label={`Remove ${nodeLabel(n)} from the group`} title="Take it out of the group" onClick={() => store.removeFromGroup([n.id])}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">
            Drag the group’s header to move all its nodes. Groups only arrange the canvas: they never change the result.
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="ghost" title="Keep the nodes, remove the group (Ctrl+Shift+G)" onClick={() => store.ungroup(group.id)}>
            Ungroup
          </button>
          <button type="button" className="ghost danger" onClick={() => store.deleteGroupAndNodes(group.id)}>
            Delete group and its {members.length} node{members.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** For a node in a group: which one, and a way out of it. */
export function InGroup({ nodeId }: { nodeId: string }) {
  const group = useEditor((s) => s.graph.groups?.find((g) => g.nodeIds.includes(nodeId)));
  if (!group) return null;
  const store = editorStore.getState();
  return (
    <p className="in-group small">
      <span className="swatch" style={{ background: group.color ?? '#64748b' }} aria-hidden="true" />
      In group
      <button type="button" className="link" onClick={() => store.selectGroup(group.id)}>
        {group.name}
      </button>
      <button type="button" className="link" onClick={() => store.removeFromGroup([nodeId])}>
        Remove from group
      </button>
    </p>
  );
}
