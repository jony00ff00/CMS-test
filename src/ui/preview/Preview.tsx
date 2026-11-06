import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildInsertion, caretTarget, createAnchor, enclosingBlock, highlightSelection, HIGHLIGHT_CSS, indexDocument, INSERT_MARKER_CSS,
  insertionPointAt, markInsertionPoint, rangeOf, serialize, type CmsDocument, type InsertNodeConfig, type InsertWhere, type Match,
  type Selection, type SelectorConfig,
} from '../../engine';
import { editorStore, useEditor, type EditorState } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { BRIDGE_SOURCE, withBridge, type BridgeMessage } from './bridge';
import { openPreviewWindow, type PreviewWindow } from './preview-window';
import { PreviewResizer } from './PreviewResizer';
import { MinimiseButton, RestoreButton } from '../panels';

/** What the preview shows, worked out from the selected node. */
interface PreviewSource {
  label: string;
  /** The document the shown page was made from; selections are anchored in it. */
  doc?: CmsDocument;
  /** Where that document comes from, so a new Selector can be connected to it. */
  from?: { nodeId: string; port: string };
  /** Matches to highlight (when a Selector is selected). */
  selection?: Selection;
  /** A finished page (when an Output is shown). */
  html?: string;
  /** The selected manual Selector that text can be added to. */
  manualSelectorId?: string;
  /** The selected Insert node: show where it inserts, and let a click pick the point. */
  insert?: { nodeId: string; where: InsertWhere; block: boolean };
  /** The selected node is an Insert node (both views). */
  insertNodeId?: string;
  message?: string;
}

function inputOf(s: EditorState, nodeId: string, port: string) {
  const edge = s.graph.edges.find((e) => e.target === nodeId && e.targetPort === port);
  if (!edge) return undefined;
  const doc = s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined;
  return { doc, from: { nodeId: edge.source, port: edge.sourcePort } };
}

function previewSource(s: EditorState, showResult: boolean): PreviewSource {
  const selected = s.graph.nodes.find((n) => n.id === s.selectedId);
  if (selected?.type === 'insert') {
    const config = selected.config as InsertNodeConfig;
    if (showResult) {
      const result = s.results[selected.id];
      const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
      return { label: `Result of ${nodeLabel(selected)}`, doc, from: { nodeId: selected.id, port: 'document' }, insertNodeId: selected.id, message: result?.message ?? 'Waiting…' };
    }
    const input = inputOf(s, selected.id, 'document');
    const built = buildInsertion(config.content, s.files);
    // Until the content is complete, guess from its kind whether it is block content.
    const block = 'nodes' in built ? built.block : config.content.kind === 'video' || config.content.kind === 'videoUrl' || config.content.kind === 'code';
    const placed = config.where.mode === 'selector' || !!config.where.point;
    return {
      label: `Input of ${nodeLabel(selected)} · ${placed ? 'the marker shows where the insertion goes; click to move it' : 'click where the insertion should go'}`,
      doc: input?.doc,
      from: input?.from,
      insert: { nodeId: selected.id, where: config.where, block },
      insertNodeId: selected.id,
      message: !input ? 'Connect a document to this Insert node.' : input.doc ? undefined : 'Waiting…',
    };
  }
  if (selected?.type === 'selector') {
    const input = inputOf(s, selected.id, 'document');
    const result = s.results[selected.id];
    const selection = result?.status === 'ok' ? (result.outputs.selection as Selection) : undefined;
    const count = selection?.matches.length ?? 0;
    return {
      label: `Input of ${nodeLabel(selected)} · ${count} match${count === 1 ? '' : 'es'} highlighted`,
      doc: input?.doc,
      from: input?.from,
      selection,
      manualSelectorId: (selected.config as SelectorConfig).mode === 'manual' ? selected.id : undefined,
      message: !input ? 'Connect a document to this Selector.' : (result?.message ?? (input.doc ? undefined : 'Waiting…')),
    };
  }
  if (selected && (selected.type === 'documentSource' || selected.type === 'snippet' || selected.type === 'connector')) {
    const result = s.results[selected.id];
    const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
    return { label: `Output of ${nodeLabel(selected)}`, doc, from: { nodeId: selected.id, port: 'document' }, message: result?.message ?? 'Waiting…' };
  }
  const outputs = s.graph.nodes.filter((n) => n.type === 'output');
  const output = outputs.find((n) => n.id === selected?.id) ?? outputs[0];
  if (!output) return { label: '', message: 'Add an Output node to see the result.' };
  const result = s.results[output.id];
  const count = s.graph.edges.filter((e) => e.target === output.id && e.targetPort === 'document').length;
  // With several documents combined, selected text cannot be traced back to one of them.
  const input = count === 1 ? inputOf(s, output.id, 'document') : undefined;
  return {
    label: count > 1 ? `${nodeLabel(output)} · ${count} inputs combined` : nodeLabel(output),
    html: result?.status === 'ok' ? (result.outputs.html as string) : undefined,
    doc: input?.doc,
    from: input?.from,
    message: result?.message ?? 'Waiting…',
  };
}

interface TextSelection {
  start: number;
  end: number;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface PreviewProps {
  height: number;
  onHeightChange: (height: number) => void;
  /** Called when the preview moves to its own window, or back. */
  onDetachedChange: (detached: boolean) => void;
  /** Minimised: only the header bar shows here (a separate window keeps showing the page). */
  minimised: boolean;
  onMinimisedChange: (minimised: boolean) => void;
}

export function Preview({ height, onHeightChange, onDetachedChange, minimised, onMinimisedChange }: PreviewProps) {
  const s = useEditor((state) => state);
  const [showResult, setShowResult] = useState(false);
  useEffect(() => setShowResult(false), [s.selectedId]);
  const source = useMemo(() => previewSource(s, showResult), [s, showResult]);
  // The message listener lives longer than one render: it reads the current source from here.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [caret, setCaret] = useState<{ offset: number; rect: TextSelection['rect']; name: string }>();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string>();
  const [picked, setPicked] = useState<TextSelection>();
  const [popup, setPopup] = useState<PreviewWindow>();
  const host = popup?.win ?? window;

  const detach = () => {
    const opened = openPreviewWindow();
    if (!opened) {
      editorStore.getState().notify('error', 'The browser blocked the new window. Allow pop-ups for this site and try again.');
      return;
    }
    setPicked(undefined);
    setPopup(opened);
  };
  const attach = () => {
    popup?.win.close();
    setPopup(undefined);
  };

  // Tell the layout, and notice when the window is closed (or reloaded, which empties it).
  useEffect(() => {
    onDetachedChange(!!popup);
    if (!popup) return;
    const back = () => {
      setPicked(undefined);
      setPopup(undefined);
    };
    popup.win.addEventListener('pagehide', back);
    // Closing the editor closes its preview window too.
    const closeIt = () => popup.win.close();
    addEventListener('pagehide', closeIt);
    return () => {
      popup.win.removeEventListener('pagehide', back);
      removeEventListener('pagehide', closeIt);
    };
  }, [popup, onDetachedChange]);

  // Build the page: highlights for a selection, the bridge script always.
  useEffect(() => {
    let cancelled = false;
    setPicked(undefined);
    setCaret(undefined);
    (async () => {
      if (source.html) return withBridge(source.html);
      if (!source.doc) return undefined;
      if (source.insert) {
        const marked = await markInsertionPoint(source.doc, source.insert.where, source.insert.block);
        return withBridge(serialize(marked, { fullDocument: true, inlineAssets: true }), HIGHLIGHT_CSS + INSERT_MARKER_CSS);
      }
      const doc = source.selection && source.selection.document === source.doc ? await highlightSelection(source.selection) : source.doc;
      return withBridge(serialize(doc, { fullDocument: true, inlineAssets: true }), HIGHLIGHT_CSS);
    })()
      .then((html) => !cancelled && setPage(html))
      .catch((err: Error) => !cancelled && editorStore.getState().notify('error', `Preview: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [source.html, source.doc, source.selection, source.insert?.where, source.insert?.block]);

  // Messages from the preview page.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow) return;
      const msg = e.data as BridgeMessage;
      if (msg?.source !== BRIDGE_SOURCE) return;
      if (msg.type === 'selection') {
        setCaret(undefined);
        setPicked({ start: msg.start, end: msg.end, text: msg.text, rect: msg.rect });
      }
      if (msg.type === 'selection-cleared') setPicked(undefined);
      if (msg.type === 'caret') {
        const current = sourceRef.current;
        const target = current.insert && current.doc ? caretTarget(current.doc, msg.offset) : undefined;
        setCaret(target ? { offset: msg.offset, rect: msg.rect, name: target.name } : undefined);
      }
    };
    // Messages arrive at the window the iframe is in: this one, or the preview window.
    host.addEventListener('message', onMessage);
    return () => host.removeEventListener('message', onMessage);
  }, [host]);

  const dismiss = () => {
    setPicked(undefined);
    iframe.current?.contentWindow?.postMessage({ source: BRIDGE_SOURCE, type: 'clear-selection' }, '*');
  };

  /** Put the selected Insert node's insertion here. */
  const placeInsertion = (choice: 'cursor' | 'before' | 'after') => {
    if (!caret || !source.insert || !source.doc) return;
    const point = insertionPointAt(source.doc, caret.offset, choice);
    setCaret(undefined);
    if (!point) return;
    editorStore.getState().updateConfig<InsertNodeConfig>(source.insert.nodeId, (c) => ({ ...c, where: { mode: 'point', point } }));
  };

  const save = (target: 'new' | 'existing') => {
    if (!picked || !source.doc || !source.from) return;
    const match = toMatch(source.doc, picked);
    if (!match) {
      editorStore.getState().notify('error', 'That text could not be found in the document. Try selecting it again.');
      return;
    }
    const anchor = createAnchor(source.doc, match);
    const state = editorStore.getState();
    if (target === 'existing' && source.manualSelectorId) state.addAnchor(source.manualSelectorId, anchor);
    else state.createManualSelector(source.from, anchor);
    dismiss();
  };

  const short = picked && (picked.text.length > 48 ? `${picked.text.slice(0, 47)}…` : picked.text).replace(/\n/g, ' ');
  const label = page ? source.label : (source.message ?? source.label);

  /** The page and the actions for selected text: shown here, or in the preview window. */
  const surface = (win: Window) => {
    const frameBox = iframe.current?.getBoundingClientRect();
    return (
      <>
        {page ? (
          // allow-scripts without allow-same-origin: snippet JS runs, but cannot reach the editor.
          <iframe ref={iframe} title="Output preview" sandbox="allow-scripts" srcDoc={page} />
        ) : (
          <div className="preview-empty muted">Nothing to show yet.</div>
        )}
        {picked && source.doc && frameBox && (
          <div
            className="selection-actions"
            role="dialog"
            aria-label="Selected text"
            style={{
              // Above the selected text, but always inside the preview area.
              left: clamp(frameBox.left + picked.rect.x, frameBox.left + 8, Math.min(frameBox.right, win.innerWidth) - 400),
              top: clamp(frameBox.top + picked.rect.y - 48, frameBox.top + 8, Math.min(frameBox.bottom, win.innerHeight) - 48),
            }}
          >
            <span className="quote">“{short}”</span>
            {source.manualSelectorId && (
              <button type="button" onClick={() => save('existing')}>
                Add to {nodeLabel(s.graph.nodes.find((n) => n.id === source.manualSelectorId), source.manualSelectorId)}
              </button>
            )}
            <button type="button" onClick={() => save('new')}>
              Create selector from selection
            </button>
            <button type="button" className="ghost" aria-label="Cancel" onClick={dismiss}>
              ✕
            </button>
          </div>
        )}
        {caret && source.insert && frameBox && (
          <div
            className="selection-actions insert-actions"
            role="dialog"
            aria-label="Insert here"
            style={{
              left: clamp(frameBox.left + caret.rect.x, frameBox.left + 8, Math.min(frameBox.right, win.innerWidth) - 420),
              top: clamp(frameBox.top + caret.rect.y + 12, frameBox.top + 8, Math.min(frameBox.bottom, win.innerHeight) - 48),
            }}
          >
            <span className="quote">Insert</span>
            {!source.insert.block && (
              <button type="button" onClick={() => placeInsertion('cursor')}>
                At the cursor
              </button>
            )}
            <button type="button" onClick={() => placeInsertion('before')}>
              Before this {caret.name}
            </button>
            <button type="button" onClick={() => placeInsertion('after')}>
              After this {caret.name}
            </button>
            <button type="button" className="ghost" aria-label="Cancel" onClick={() => setCaret(undefined)}>
              ✕
            </button>
          </div>
        )}
      </>
    );
  };

  const insertToggle = source.insertNodeId && (
    <span className="segmented" role="group" aria-label="Show">
      <button type="button" aria-pressed={!showResult} onClick={() => setShowResult(false)}>
        Where it goes
      </button>
      <button type="button" aria-pressed={showResult} onClick={() => setShowResult(true)}>
        Result
      </button>
    </span>
  );

  const toggle = minimised ? (
    <RestoreButton panel="preview" onClick={() => onMinimisedChange(false)} />
  ) : (
    <MinimiseButton panel="preview" onClick={() => onMinimisedChange(true)} />
  );

  return (
    <section className={`preview${popup ? ' is-detached' : ''}${minimised ? ' is-minimised' : ''}`} aria-label="Preview">
      {!popup && !minimised && <PreviewResizer height={height} onChange={onHeightChange} />}
      <div className="preview-head">
        <h2>Preview</h2>
        <span className="muted small">{popup ? 'Showing in its own window.' : label}</span>
        {!popup && !minimised && page && source.doc && !source.insertNodeId && <span className="muted small preview-tip">Select text to make a selection from it.</span>}
        {!popup && !minimised && insertToggle}
        {popup ? (
          <span className="preview-actions">
            <button type="button" onClick={() => popup.win.focus()}>
              Show the window
            </button>
            <button type="button" onClick={attach}>
              Bring it back here
            </button>
            {toggle}
          </span>
        ) : (
          <span className="preview-actions">
            <button type="button" className="ghost" onClick={detach} title="Open the preview in a separate window, e.g. on another screen">
              Open in new window
            </button>
            {toggle}
          </span>
        )}
      </div>
      {popup
        ? createPortal(
            <div className="preview preview-in-window" aria-label="Preview" role="region">
              <div className="preview-head">
                <h2>Preview</h2>
                <span className="muted small">{label}</span>
                {page && source.doc && !source.insertNodeId && <span className="muted small preview-tip">Select text to make a selection from it.</span>}
                {insertToggle}
                <span className="preview-actions">
                  <button type="button" onClick={attach}>
                    Back into the editor
                  </button>
                </span>
              </div>
              {surface(popup.win)}
            </div>,
            popup.container,
          )
        : !minimised && surface(window)}
    </section>
  );
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

/**
 * The match for text selected in the preview. Selecting a whole paragraph (or list item, heading, ...)
 * gives an element match, anything else a text match.
 */
function toMatch(doc: CmsDocument, picked: TextSelection): Match | undefined {
  const ix = indexDocument(doc);
  let { start, end } = picked;
  if (ix.text.text.slice(start, end) !== picked.text) {
    // The page changed under the selection (e.g. snippet JavaScript added text): find it by its text.
    const at = ix.text.text.indexOf(picked.text);
    if (at === -1) return undefined;
    [start, end] = [at, at + picked.text.length];
  }
  const block = enclosingBlock(ix, start);
  const range = block && rangeOf(ix, block);
  if (block && range && range.start === start && range.end === end) return block;
  return { kind: 'text', start, end };
}
