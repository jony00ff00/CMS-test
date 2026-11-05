import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createAnchor, enclosingBlock, highlightSelection, HIGHLIGHT_CSS, indexDocument, rangeOf, serialize, type CmsDocument,
  type Match, type Selection, type SelectorConfig,
} from '../../engine';
import { editorStore, useEditor, type EditorState } from '../../store/editor-store';
import { BRIDGE_SOURCE, withBridge, type BridgeMessage } from './bridge';

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
  message?: string;
}

function inputOf(s: EditorState, nodeId: string, port: string) {
  const edge = s.graph.edges.find((e) => e.target === nodeId && e.targetPort === port);
  if (!edge) return undefined;
  const doc = s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined;
  return { doc, from: { nodeId: edge.source, port: edge.sourcePort } };
}

function previewSource(s: EditorState): PreviewSource {
  const selected = s.graph.nodes.find((n) => n.id === s.selectedId);
  if (selected?.type === 'selector') {
    const input = inputOf(s, selected.id, 'document');
    const result = s.results[selected.id];
    const selection = result?.status === 'ok' ? (result.outputs.selection as Selection) : undefined;
    const count = selection?.matches.length ?? 0;
    return {
      label: `Input of ${selected.id} · ${count} match${count === 1 ? '' : 'es'} highlighted`,
      doc: input?.doc,
      from: input?.from,
      selection,
      manualSelectorId: (selected.config as SelectorConfig).mode === 'manual' ? selected.id : undefined,
      message: !input ? 'Connect a document to this Selector.' : (result?.message ?? (input.doc ? undefined : 'Waiting…')),
    };
  }
  if (selected && (selected.type === 'documentSource' || selected.type === 'snippet')) {
    const result = s.results[selected.id];
    const doc = result?.status === 'ok' ? (result.outputs.document as CmsDocument) : undefined;
    return { label: `Output of ${selected.id}`, doc, from: { nodeId: selected.id, port: 'document' }, message: result?.message ?? 'Waiting…' };
  }
  const outputs = s.graph.nodes.filter((n) => n.type === 'output');
  const output = outputs.find((n) => n.id === selected?.id) ?? outputs[0];
  if (!output) return { label: '', message: 'Add an Output node to see the result.' };
  const result = s.results[output.id];
  const input = inputOf(s, output.id, 'document');
  return {
    label: output.id,
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

export function Preview() {
  const s = useEditor((state) => state);
  const source = useMemo(() => previewSource(s), [s]);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string>();
  const [picked, setPicked] = useState<TextSelection>();

  // Build the page: highlights for a selection, the bridge script always.
  useEffect(() => {
    let cancelled = false;
    setPicked(undefined);
    (async () => {
      if (source.html) return withBridge(source.html);
      if (!source.doc) return undefined;
      const doc = source.selection && source.selection.document === source.doc ? await highlightSelection(source.selection) : source.doc;
      return withBridge(serialize(doc, { fullDocument: true, inlineAssets: true }), HIGHLIGHT_CSS);
    })()
      .then((html) => !cancelled && setPage(html))
      .catch((err: Error) => !cancelled && editorStore.getState().notify('error', `Preview: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [source.html, source.doc, source.selection]);

  // Messages from the preview page.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.current?.contentWindow) return;
      const msg = e.data as BridgeMessage;
      if (msg?.source !== BRIDGE_SOURCE) return;
      if (msg.type === 'selection') setPicked({ start: msg.start, end: msg.end, text: msg.text, rect: msg.rect });
      if (msg.type === 'selection-cleared') setPicked(undefined);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);

  const dismiss = () => {
    setPicked(undefined);
    iframe.current?.contentWindow?.postMessage({ source: BRIDGE_SOURCE, type: 'clear-selection' }, '*');
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

  const frameBox = iframe.current?.getBoundingClientRect();
  const short = picked && (picked.text.length > 48 ? `${picked.text.slice(0, 47)}…` : picked.text).replace(/\n/g, ' ');
  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-head">
        <h2>Preview</h2>
        <span className="muted small">{page ? source.label : (source.message ?? source.label)}</span>
        {page && source.doc && <span className="muted small preview-tip">Select text to make a selection from it.</span>}
      </div>
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
            left: clamp(frameBox.left + picked.rect.x, frameBox.left + 8, Math.min(frameBox.right, innerWidth) - 400),
            top: clamp(frameBox.top + picked.rect.y - 48, frameBox.top + 8, Math.min(frameBox.bottom, innerHeight) - 48),
          }}
        >
          <span className="quote">“{short}”</span>
          {source.manualSelectorId && (
            <button type="button" onClick={() => save('existing')}>
              Add to {source.manualSelectorId}
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
