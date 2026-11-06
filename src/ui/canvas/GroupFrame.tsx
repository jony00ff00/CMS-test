import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useState, type CSSProperties } from 'react';
import { editorStore, useEditor } from '../../store/editor-store';
import type { GroupPort } from './group-layout';

export type GroupFrameData = {
  groupId: string;
  /** Set when collapsed: the ports the box shows. */
  ports?: { inputs: GroupPort[]; outputs: GroupPort[] };
};
export type GroupFlowNode = Node<GroupFrameData, 'cmsGroup'>;

/**
 * A group on the canvas: a frame behind its nodes with a header (drag it to move them all, double-click the name
 * to rename), or, collapsed, one small box with the group's outside connections.
 */
function GroupFrameView({ id, data, width, height }: NodeProps<GroupFlowNode>) {
  const group = useEditor((s) => s.graph.groups?.find((g) => g.id === data.groupId));
  const selected = useEditor((s) => s.selectedGroupId === data.groupId);
  // React Flow measures a node's handles once: tell it when the box's handles change (collapse, new ports).
  const updateInternals = useUpdateNodeInternals();
  const handles = data.ports ? [...data.ports.inputs, ...data.ports.outputs].map((p) => p.handle).join() : '';
  useEffect(() => updateInternals(id), [id, handles, updateInternals]);
  if (!group) return null;
  const store = editorStore.getState();
  const style = { '--group-color': group.color ?? '#64748b', width, height } as CSSProperties;
  const toggle = (
    <button
      type="button"
      className="ghost group-toggle nodrag"
      aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
      title={group.collapsed ? 'Show the nodes again' : 'Show the group as one box'}
      onClick={(e) => {
        e.stopPropagation();
        store.setGroupCollapsed(group.id, !group.collapsed);
      }}
    >
      {group.collapsed ? '+' : '−'}
    </button>
  );
  const count = `${group.nodeIds.length} node${group.nodeIds.length === 1 ? '' : 's'}`;

  if (data.ports) {
    const { inputs, outputs } = data.ports;
    const rows = Math.max(inputs.length, outputs.length);
    return (
      <div className={`group-box${selected ? ' is-selected' : ''}`} style={style} data-testid={`group-${group.id}`}>
        <div className="group-frame-head">
          <GroupTitle id={group.id} name={group.name} />
          <span className="group-count">{count}</span>
          {toggle}
        </div>
        <div className="cms-node-ports">
          {Array.from({ length: rows }, (_, i) => (
            <div className="cms-node-port-row" key={i}>
              <span className="port port-in" title={inputs[i]?.label}>
                {inputs[i] && (
                  <>
                    <Handle type="target" position={Position.Left} id={inputs[i].handle} className={`handle-${inputs[i].type}`} />
                    {inputs[i].label}
                  </>
                )}
              </span>
              <span className="port port-out" title={outputs[i]?.label}>
                {outputs[i] && (
                  <>
                    {outputs[i].label}
                    <Handle type="source" position={Position.Right} id={outputs[i].handle} className={`handle-${outputs[i].type}`} />
                  </>
                )}
              </span>
            </div>
          ))}
          {rows === 0 && <p className="muted small group-box-empty">No connections</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`group-frame${selected ? ' is-selected' : ''}`} style={style} data-testid={`group-${group.id}`}>
      <div className="group-frame-head">
        <GroupTitle id={group.id} name={group.name} />
        <span className="group-count">{count}</span>
        {toggle}
      </div>
    </div>
  );
}

export const GroupFrame = memo(GroupFrameView);

/** The group's name; double-click to rename it there. */
function GroupTitle({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    const done = (save: boolean) => {
      if (save && draft.trim()) editorStore.getState().renameGroup(id, draft.trim());
      setEditing(false);
    };
    return (
      <input
        className="node-name-input group-name-input nodrag"
        aria-label={`Name of group ${name}`}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep Backspace from deleting nodes
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
        }}
      />
    );
  }
  return (
    <span
      className="group-name"
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(name);
        setEditing(true);
      }}
    >
      {name}
    </span>
  );
}
