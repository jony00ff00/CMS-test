// The script that runs inside the sandboxed preview. It cannot touch the editor, and the editor cannot
// read the preview, so the two talk with postMessage.
//
// It rebuilds the engine's text index from the DOM (same rules as buildTextIndex: block elements are
// separated by "\n", <br> is "\n"), so a text selection can be reported as the same offsets the engine uses.
import { BLOCK_TAGS } from '../../engine';

export const BRIDGE_SOURCE = 'cms-preview';

export type BridgeMessage =
  | { source: typeof BRIDGE_SOURCE; type: 'ready' }
  | {
      source: typeof BRIDGE_SOURCE;
      type: 'selection';
      start: number;
      end: number;
      text: string;
      /** Selection box, relative to the preview's viewport. */
      rect: { x: number; y: number; width: number; height: number };
    }
  | { source: typeof BRIDGE_SOURCE; type: 'selection-cleared' }
  | { source: typeof BRIDGE_SOURCE; type: 'text'; text: string };

/** Runs inside the iframe. Must not use anything from outside its own body. */
function bridge(blockTags: string[], source: string) {
  const BLOCK = new Set(blockTags.map((t) => t.toUpperCase()));
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
  const post = (msg: Record<string, unknown>) => parent.postMessage({ source, ...msg }, '*');

  function buildIndex() {
    const parts: string[] = [];
    let length = 0;
    let last = '';
    const starts = new Map<Node, number>();
    const order: Text[] = [];
    const add = (s: string) => {
      parts.push(s);
      length += s.length;
      last = s[s.length - 1];
    };
    const breakLine = () => {
      if (length > 0 && last !== '\n') add('\n');
    };
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = (node as Text).data;
        if (value === '') return;
        starts.set(node, length);
        order.push(node as Text);
        add(value);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (SKIP.has(el.tagName) || el.hasAttribute('data-cms-preview')) return;
      if (el.tagName === 'BR') {
        add('\n');
        return;
      }
      const block = BLOCK.has(el.tagName);
      if (block) breakLine();
      el.childNodes.forEach(walk);
      if (block) breakLine();
    };
    document.body.childNodes.forEach(walk);
    return { text: parts.join('').replace(/\n+$/, ''), starts, order };
  }

  /** Offset of a DOM boundary point in the index. */
  function offsetOf(ix: ReturnType<typeof buildIndex>, node: Node, offset: number, edge: 'start' | 'end'): number {
    if (node.nodeType === Node.TEXT_NODE && ix.starts.has(node)) {
      return ix.starts.get(node)! + Math.min(offset, (node as Text).data.length);
    }
    // An element boundary: the text right after it (start) or right before it (end).
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    if (edge === 'start') {
      for (const t of ix.order) if (range.comparePoint(t, 0) >= 0) return ix.starts.get(t)!;
      return ix.text.length;
    }
    for (let i = ix.order.length - 1; i >= 0; i--) {
      const t = ix.order[i];
      if (range.comparePoint(t, t.data.length) <= 0) return ix.starts.get(t)! + t.data.length;
    }
    return 0;
  }

  let timer: number | undefined;
  let hadSelection = false;
  const report = () => {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (hadSelection) post({ type: 'selection-cleared' });
      hadSelection = false;
      return;
    }
    const range = sel.getRangeAt(0);
    const ix = buildIndex();
    let start = offsetOf(ix, range.startContainer, range.startOffset, 'start');
    let end = offsetOf(ix, range.endContainer, range.endOffset, 'end');
    while (start < end && /\s/.test(ix.text[start])) start++;
    while (end > start && /\s/.test(ix.text[end - 1])) end--;
    if (end <= start) return;
    const r = range.getBoundingClientRect();
    hadSelection = true;
    post({ type: 'selection', start, end, text: ix.text.slice(start, end), rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
  };
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = window.setTimeout(report, 120);
  });
  addEventListener('message', (e) => {
    // From the editor: the parent window, or (when the preview is in its own window) that window's opener.
    if ((e.source !== parent && e.source !== parent.opener) || !e.data || e.data.source !== source) return;
    if (e.data.type === 'get-text') post({ type: 'text', text: buildIndex().text });
    if (e.data.type === 'clear-selection') getSelection()?.removeAllRanges();
  });
  // Show the first highlighted match, which may be further down the page.
  document.querySelector('[data-cms-match]')?.scrollIntoView({ block: 'center' });
  post({ type: 'ready' });
}

export const BRIDGE_SCRIPT = `(${bridge.toString()})(${JSON.stringify([...BLOCK_TAGS])}, ${JSON.stringify(BRIDGE_SOURCE)});`;

/** Add CSS to the head and the bridge script to the end of a page (or a fragment). */
export function withBridge(html: string, css = ''): string {
  const style = css ? `<style data-cms-preview>${css}</style>` : '';
  const script = `<script data-cms-preview>${BRIDGE_SCRIPT}</script>`;
  const withStyle = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html;
  return withStyle.includes('</body>') ? withStyle.replace(/<\/body>(?![\s\S]*<\/body>)/, `${script}</body>`) : withStyle + script;
}
