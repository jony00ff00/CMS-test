import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildInsertion, caretTarget, createAnchor, elementMatch, enclosingBlock, highlightSelection, HIGHLIGHT_CSS, imagesOf, imageWithFrame, indexDocument, INSERT_MARKER_CSS,
  insertionPointAt, markInsertionPoint, rangeOf, serialize, type CmsDocument, type InsertWhere, type Match, type ObjectNodeConfig,
  type PointValue, type Selection, type SelectorConfig, type SelectorNodeConfig,
} from '../../engine';
import { editorStore, useEditor, type EditorState } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { BRIDGE_SOURCE, withBridge, type BridgeMessage } from './bridge';
import { openPreviewWindow, type PreviewWindow } from './preview-window';
import { PreviewResizer } from './PreviewResizer';
import { MinimiseButton, RailButton } from '../panels';

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
  /** Show where a point is (marker); with `nodeId` (a Selector in point mode) a click picks the point. */
  insert?: { nodeId?: string; where: InsertWhere; block: boolean };
  /** The selected node is an Object node (both views: where it goes, and the result). */
  insertNodeId?: string;
  /** The views the selected node has (Object, or an Extractor picking by hand); the first is the default. */
  views?: string[];
  message?: string;
}

/**
 * The same `where` object for the same Selector settings: the page is rebuilt when it changes, and a rebuild
 * closes the "Point here" popup, so it must not change on unrelated updates (e.g. the autosave time).
 */
const pointWheres = new WeakMap<object, InsertWhere>();
function pointWhere(config: Extract<SelectorConfig, { mode: 'point' }>): InsertWhere {
  let where = pointWheres.get(config);
  if (!where) pointWheres.set(config, (where = { mode: 'point', point: config.point }));
  return where;
}

const OBJECT_VIEWS = ['Where it goes', 'Result'];
/** An Object with content from another node can also show just that content. */
const OBJECT_CONTENT_VIEWS = ['Where it goes', 'Content', 'Result'];
const EXTRACTOR_VIEWS = ['Pick', 'Kept'];
const REPLACE_VIEWS = ['What it replaces', 'Content', 'Result'];

function inputOf(s: EditorState, nodeId: string, port: string) {
  const edge = s.graph.edges.find((e) => e.target === nodeId && e.targetPort === port);
  if (!edge) return undefined;
  const doc = s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined;
  return { doc, from: { nodeId: edge.source, port: edge.sourcePort } };
}

function previewSource(s: EditorState, view: string | undefined): PreviewSource {
  const selected = s.graph.nodes.find((n) => n.id === s.selectedId);
  if (selected?.type === 'object') {
    const config = selected.config as ObjectNodeConfig;
    const views = config.content.kind === 'selection' ? OBJECT_CONTENT_VIEWS : OBJECT_VIEWS;
    // No Point: the Object's output is its content alone, so there is just that to show.
    if (!s.graph.edges.some((e) => e.target === selected.id && e.targetPort === 'point')) {
      const result = s.results[selected.id];
      const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
      return { label: `${nodeLabel(selected)} on its own (no Point connected)`, doc, from: { nodeId: selected.id, port: 'document' }, insertNodeId: selected.id, message: result?.message ?? 'Waiting…' };
    }
    if (view === 'Result') {
      const result = s.results[selected.id];
      const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
      return { label: `Result of ${nodeLabel(selected)}`, doc, from: { nodeId: selected.id, port: 'document' }, insertNodeId: selected.id, views, message: result?.message ?? 'Waiting…' };
    }
    if (view === 'Content' && views.includes('Content')) {
      const result = s.results[selected.id];
      const doc = result?.status === 'ok' ? (result.outputs.content as CmsDocument | undefined) : undefined;
      const from = s.graph.edges.find((e) => e.target === selected.id && e.targetPort === 'content');
      return {
        label: `What ${nodeLabel(selected)} adds`,
        doc,
        insertNodeId: selected.id,
        views,
        message: !from ? 'Connect something to the Content input.' : doc ? undefined : (result?.message ?? 'Waiting…'),
      };
    }
    const edge = s.graph.edges.find((e) => e.target === selected.id && e.targetPort === 'point');
    const pointer = edge && s.graph.nodes.find((n) => n.id === edge.source);
    const r = edge && s.results[edge.source];
    const point = r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as PointValue | undefined) : undefined;
    const built = buildInsertion(config.content, s.files);
    // Until the content is complete, guess from its kind whether it is block content.
    const block = 'nodes' in built ? built.block : config.content.kind === 'video' || config.content.kind === 'videoUrl' || config.content.kind === 'code' || (config.content.kind === 'text' && config.content.as !== 'inline');
    // Clicks move the point when it comes straight from a Selector in point mode.
    const pickable = pointer?.type === 'selector' && (pointer.config as SelectorConfig).mode === 'point';
    return {
      label: `Where ${nodeLabel(selected)} goes${pointer ? ` (the Point of ${nodeLabel(pointer)})` : ''}${pickable ? ' · click to move it' : ''}`,
      doc: point?.document,
      insert: point ? { nodeId: pickable ? pointer!.id : undefined, where: point.where, block } : undefined,
      insertNodeId: selected.id,
      views,
      message: !edge ? "Connect a Selector's Point to this Object." : point ? undefined : (r?.message ?? 'Waiting…'),
    };
  }
  if (selected?.type === 'replace') {
    const result = s.results[selected.id];
    if (view !== 'Result') {
      const port = view === 'Content' ? 'content' : 'selection';
      const edge = s.graph.edges.find((e) => e.target === selected.id && e.targetPort === port);
      const value = edge ? s.results[edge.source]?.outputs[edge.sourcePort] : undefined;
      const sel = (value as Selection | undefined)?.kind === 'selection' ? (value as Selection) : undefined;
      const doc = sel ? sel.document : typeof value === 'object' && (value as { kind?: string })?.kind === 'document' ? (value as CmsDocument) : undefined;
      const count = sel?.matches.length ?? 0;
      return {
        label: view === 'Content' ? `Content for ${nodeLabel(selected)}${sel ? ` · ${count} match${count === 1 ? '' : 'es'} highlighted` : ''}` : `What ${nodeLabel(selected)} replaces · ${count} match${count === 1 ? '' : 'es'} highlighted`,
        doc,
        html: typeof value === 'string' ? value : undefined,
        selection: sel,
        views: REPLACE_VIEWS,
        message: !edge ? `Connect something to the ${view === 'Content' ? 'Content' : 'Selection'} input.` : value === undefined ? (s.results[edge.source]?.message ?? 'Waiting…') : undefined,
      };
    }
    const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
    return { label: `Result of ${nodeLabel(selected)}`, doc, from: { nodeId: selected.id, port: 'document' }, views: REPLACE_VIEWS, message: result?.message ?? 'Waiting…' };
  }
  if (selected?.type === 'selector' && (selected.config as SelectorConfig).mode === 'point') {
    const input = inputOf(s, selected.id, 'document');
    const config = selected.config as Extract<SelectorConfig, { mode: 'point' }>;
    return {
      label: `Input of ${nodeLabel(selected)} · ${config.point ? 'the marker shows the point; click to move it' : 'click where the point should be'}`,
      doc: input?.doc,
      from: input?.from,
      insert: { nodeId: selected.id, where: pointWhere(config), block: false },
      message: !input ? 'Connect a document to this Selector.' : input.doc ? undefined : 'Waiting…',
    };
  }
  // An Extractor picking by hand: its input with what it keeps highlighted, where more can be added.
  if (selected?.type === 'extractor' && (selected.config as SelectorConfig).mode === 'manual' && view !== 'Kept') {
    const input = inputOf(s, selected.id, 'document');
    const result = s.results[selected.id];
    const selection = result?.status === 'ok' ? (result.outputs.selection as Selection) : undefined;
    const count = selection?.matches.length ?? 0;
    return {
      label: `Input of ${nodeLabel(selected)} · ${count} kept part${count === 1 ? '' : 's'} highlighted`,
      doc: input?.doc,
      from: input?.from,
      selection,
      manualSelectorId: selected.id,
      views: EXTRACTOR_VIEWS,
      message: !input ? 'Connect a document to this Extractor.' : (result?.message ?? (input.doc ? undefined : 'Waiting…')),
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
  if (selected && ['documentSource', 'snippet', 'connector', 'extractor'].includes(selected.type)) {
    const result = s.results[selected.id];
    const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
    const views = selected.type === 'extractor' && (selected.config as SelectorConfig).mode === 'manual' ? EXTRACTOR_VIEWS : undefined;
    return { label: `Output of ${nodeLabel(selected)}`, doc, from: { nodeId: selected.id, port: 'document' }, views, message: result?.message ?? 'Waiting…' };
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
  width: number;
  onWidthChange: (width: number) => void;
  /** Called when the preview moves to its own window, or back. */
  onDetachedChange: (detached: boolean) => void;
  /** Minimised: only the header bar shows here (a separate window keeps showing the page). */
  minimised: boolean;
  onMinimisedChange: (minimised: boolean) => void;
}

export function Preview({ width, onWidthChange, onDetachedChange, minimised, onMinimisedChange }: PreviewProps) {
  const s = useEditor((state) => state);
  const [view, setView] = useState<string>();
  useEffect(() => setView(undefined), [s.selectedId]);
  const source = useMemo(() => previewSource(s, view), [s, view]);
  const shownView = source.views && (view && source.views.includes(view) ? view : source.views[0]);
  // The message listener lives longer than one render: it reads the current source from here.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [caret, setCaret] = useState<{ offset: number; rect: TextSelection['rect']; name: string }>();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string>();
  const [picked, setPicked] = useState<TextSelection>();
  const [image, setImage] = useState<{ number: number; alt: string; rect: TextSelection['rect']; framed: boolean }>();
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
    setImage(undefined);
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
      if (msg.type === 'image') {
        const current = sourceRef.current;
        // Picking a point (or an Object's views) uses clicks for that; elsewhere a click on an image selects it.
        if (current.insert || current.insertNodeId || !current.doc || !current.from) return;
        setPicked(undefined);
        setImage({ number: msg.number, alt: msg.alt, rect: msg.rect, framed: false });
      }
      if (msg.type === 'caret') {
        const current = sourceRef.current;
        const target = current.insert?.nodeId && current.doc ? caretTarget(current.doc, msg.offset) : undefined;
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

  /** Move the point of the Selector (in point mode) here. */
  const placeInsertion = (choice: 'cursor' | 'before' | 'after') => {
    if (!caret || !source.insert?.nodeId || !source.doc) return;
    const point = insertionPointAt(source.doc, caret.offset, choice);
    setCaret(undefined);
    if (!point) return;
    editorStore.getState().updateConfig<SelectorNodeConfig>(source.insert.nodeId, (c) => ({ ...c, mode: 'point', point }) as SelectorNodeConfig);
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

  const saveImage = (target: 'new' | 'existing') => {
    if (!image || !source.doc || !source.from) return;
    const match = imageMatch(source.doc, image.number, image.alt, image.framed);
    setImage(undefined);
    if (!match) {
      editorStore.getState().notify('error', 'That image could not be found in the document.');
      return;
    }
    const anchor = createAnchor(source.doc, match);
    const state = editorStore.getState();
    if (target === 'existing' && source.manualSelectorId) state.addAnchor(source.manualSelectorId, anchor);
    else state.createManualSelector(source.from, anchor);
  };
  const imageHasFrame = useMemo(() => !!image && !!source.doc && !!imageMatch(source.doc, image.number, image.alt, true, true), [image, source.doc]);

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
        {image && source.doc && frameBox && (
          <div
            className="selection-actions"
            role="dialog"
            aria-label="Selected image"
            style={{
              left: clamp(frameBox.left + image.rect.x, frameBox.left + 8, Math.min(frameBox.right, win.innerWidth) - 460),
              top: clamp(frameBox.top + image.rect.y - 48, frameBox.top + 8, Math.min(frameBox.bottom, win.innerHeight) - 48),
            }}
          >
            <span className="quote">{image.alt ? `Image “${image.alt.length > 32 ? `${image.alt.slice(0, 31)}…` : image.alt}”` : `Image ${image.number}`}</span>
            {imageHasFrame && (
              <label className="inline-check">
                <input type="checkbox" checked={image.framed} onChange={(e) => setImage({ ...image, framed: e.target.checked })} />
                With its figure / link
              </label>
            )}
            {source.manualSelectorId && (
              <button type="button" onClick={() => saveImage('existing')}>
                Add to {nodeLabel(s.graph.nodes.find((n) => n.id === source.manualSelectorId), source.manualSelectorId)}
              </button>
            )}
            <button type="button" onClick={() => saveImage('new')}>
              Create selector from image
            </button>
            <button type="button" className="ghost" aria-label="Cancel" onClick={() => setImage(undefined)}>
              ✕
            </button>
          </div>
        )}
        {caret && source.insert?.nodeId && frameBox && (
          <div
            className="selection-actions insert-actions"
            role="dialog"
            aria-label="Point here"
            style={{
              left: clamp(frameBox.left + caret.rect.x, frameBox.left + 8, Math.min(frameBox.right, win.innerWidth) - 420),
              top: clamp(frameBox.top + caret.rect.y + 12, frameBox.top + 8, Math.min(frameBox.bottom, win.innerHeight) - 48),
            }}
          >
            <span className="quote">Point</span>
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

  const insertToggle = source.views && (
    <span className="segmented" role="group" aria-label="Show">
      {source.views.map((v) => (
        <button key={v} type="button" aria-pressed={v === shownView} onClick={() => setView(v)}>
          {v}
        </button>
      ))}
    </span>
  );


  return (
    <section className={`preview${popup ? ' is-detached' : ''}${minimised ? ' is-minimised' : ''}`} aria-label="Preview">
      {minimised ? (
        <RailButton panel="preview" onRestore={() => onMinimisedChange(false)} note={popup ? 'in its own window' : undefined} />
      ) : (
        <>
          {!popup && <PreviewResizer width={width} onChange={onWidthChange} />}
          <div className="preview-head">
            <h2>Preview</h2>
            <span className="preview-actions">
              {popup ? (
                <>
                  <button type="button" onClick={() => popup.win.focus()}>
                    Show the window
                  </button>
                  <button type="button" onClick={attach}>
                    Bring it back here
                  </button>
                </>
              ) : (
                <button type="button" className="ghost" onClick={detach} title="Open the preview in a separate window, e.g. on another screen">
                  Open in new window
                </button>
              )}
              <MinimiseButton panel="preview" onClick={() => onMinimisedChange(true)} />
            </span>
          </div>
          <div className="preview-meta">
            <span className="muted small">{popup ? 'Showing in its own window.' : label}</span>
            {!popup && page && source.doc && source.from && !source.insertNodeId && !source.insert && <span className="muted small preview-tip">Select text, or click an image, to make a selection from it.</span>}
            {!popup && insertToggle}
          </div>
        </>
      )}
      {popup
        ? createPortal(
            <div className="preview preview-in-window" aria-label="Preview" role="region">
              <div className="preview-head">
                <h2>Preview</h2>
                <span className="muted small">{label}</span>
                {page && source.doc && source.from && !source.insertNodeId && !source.insert && <span className="muted small preview-tip">Select text, or click an image, to make a selection from it.</span>}
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

/**
 * The match for an image clicked in the preview (by its number; by its alternative text if the page has other
 * images than the document, e.g. from snippet JavaScript). `framed`: with its link / figure. `onlyFramed`:
 * undefined unless the image has one.
 */
function imageMatch(doc: CmsDocument, number: number, alt: string, framed: boolean, onlyFramed = false): Match | undefined {
  const ix = indexDocument(doc);
  const images = imagesOf(ix);
  const img = images[number - 1]?.alt === alt ? images[number - 1] : images.find((i) => i.alt === alt && alt);
  if (!img) return undefined;
  const path = framed ? imageWithFrame(ix, img.path) : img.path;
  if (onlyFramed && path.length === img.path.length) return undefined;
  return elementMatch(path);
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
