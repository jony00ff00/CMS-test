import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useStore } from 'zustand';
import { editorStore, useEditor } from '../../store/editor-store';
import { download } from '../download';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Undo / redo, save / open project file, and the autosave status. */
export function ProjectToolbar() {
  const canUndo = useStore(editorStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(editorStore.temporal, (t) => t.futureStates.length > 0);
  const savedAt = useEditor((s) => s.savedAt);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const state = editorStore.getState();
    if (state.graph.nodes.length && !window.confirm(`Open “${file.name}”? It replaces the current project.`)) return;
    state.importProject(await file.text());
  };

  return (
    <div className="project-toolbar">
      <div className="project-toolbar-buttons">
      <button type="button" disabled={!canUndo} onClick={() => editorStore.getState().undo()} title={`Undo (${mod}Z)`}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => editorStore.getState().redo()} title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`}>
        Redo
      </button>
      <span className="toolbar-gap" />
      <button
        type="button"
        onClick={() => download('project.node-cms.json', editorStore.getState().exportProject(), 'application/json')}
        title="Download the graph, its files and the snippet library as one file"
      >
        Save project file
      </button>
      <button type="button" onClick={() => fileInput.current?.click()}>
        Open project…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Project file"
        className="visually-hidden"
        onChange={open}
      />
      </div>
      <SavedLabel at={savedAt} />
    </div>
  );
}

function SavedLabel({ at }: { at?: Date }) {
  // Re-render now and then so "just now" turns into a time.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  const seconds = (Date.now() - at.getTime()) / 1000;
  const when = seconds < 45 ? 'just now' : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span className="muted small saved-label" role="status" title="The project is kept in this browser and opens again next time.">
      Saved in this browser {when}
    </span>
  );
}

/**
 * Ctrl/Cmd+Z and Ctrl+Y / Shift+Cmd+Z (undo, redo) and Ctrl/Cmd+D (duplicate the selected node),
 * except while typing in a field (which has its own undo).
 */
export function useUndoShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      const key = e.key.toLowerCase();
      const state = editorStore.getState();
      if (key === 'd' && !e.shiftKey) {
        // Duplicate the selected node (instead of the browser's bookmark shortcut).
        if (!state.selectedId) return;
        state.duplicateNode(state.selectedId);
      } else if (key === 'z' && !e.shiftKey) editorStore.getState().undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') editorStore.getState().redo();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
