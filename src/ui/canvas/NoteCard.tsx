import { NodeResizeControl, type Node, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { NOTE_COLORS, type NoteColor } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';

export type NoteFlowNode = Node<{ noteId: string }, 'cmsNote'>;

export const NOTE_PREFIX = 'note:';
export const noteFlowId = (id: string) => `${NOTE_PREFIX}${id}`;
export const isNoteId = (id: string) => id.startsWith(NOTE_PREFIX);
export const noteIdOf = (flowId: string) => flowId.slice(NOTE_PREFIX.length);
export const DEFAULT_NOTE_WIDTH = 220;

/** A note on the canvas: text that annotates the flow. Double-click to write; select it for colours and Delete. */
export function NoteCard({ data, selected }: NodeProps<NoteFlowNode>) {
  const note = useEditor((s) => s.graph.notes?.find((n) => n.id === data.noteId));
  const [editing, setEditing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // A new, empty note opens for writing.
  const fresh = useRef(note?.text === '');
  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      setEditing(true);
    }
  }, []);
  // React Flow shows a new node only once it is measured, and a hidden field cannot take the focus: try for a few frames.
  useEffect(() => {
    if (!editing) return;
    let frame = 0;
    let tries = 0;
    const focus = () => {
      const el = area.current;
      if (!el) return;
      el.focus();
      if (el.ownerDocument.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
      else if (tries++ < 30) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  if (!note) return null;
  const color = note.color ?? 'yellow';
  const update = editorStore.getState().updateNote;
  return (
    <div className={`note-card note-${color}${selected ? ' is-selected' : ''}`} style={{ width: note.width ?? DEFAULT_NOTE_WIDTH }} onDoubleClick={() => setEditing(true)}>
      <NodeResizeControl
        position="right"
        resizeDirection="horizontal"
        minWidth={120}
        className="note-resize"
        onResizeEnd={(_e, p) => update(note.id, { width: Math.round(p.width) })}
      />
      {selected && !editing && (
        <div className="note-tools nodrag" role="toolbar" aria-label="Note">
          {NOTE_COLORS.map((c: NoteColor) => (
            <button
              key={c}
              type="button"
              className={`note-swatch note-${c}`}
              aria-label={`${c[0].toUpperCase()}${c.slice(1)} note`}
              aria-pressed={c === color}
              onClick={() => update(note.id, { color: c === 'yellow' ? undefined : c })}
            />
          ))}
          <button type="button" className="ghost note-delete" aria-label="Delete this note" onClick={() => editorStore.getState().removeElements([], [], [note.id])}>
            ×
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          ref={area}
          className="note-text nodrag nowheel"
          aria-label="Note text"
          value={note.text}
          rows={Math.max(3, note.text.split('\n').length + 1)}
          placeholder="Write a note about this part of the flow"
          onChange={(e) => update(note.id, { text: e.target.value })}
          // Keys belong to the text (Backspace must not delete the note); Escape stops writing.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <div className={`note-text${note.text ? '' : ' is-empty'}`} title="Double-click to edit">
          {note.text || 'Double-click to write a note'}
        </div>
      )}
    </div>
  );
}
