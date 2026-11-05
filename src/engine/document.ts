// Parse HTML into a CmsDocument, serialize it back, and index its text.
import type { Element, ElementContent, Nodes, Parent, Root, RootContent, Text } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import type { CmsDocument, SourceFormat } from './types';

export const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul',
]);

/** Elements whose whitespace-only text children never render. */
const CONTAINER_TAGS = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'select', 'hgroup']);
/** Elements whose whitespace is significant. */
const PRESERVE_TAGS = new Set(['pre', 'textarea', 'code', 'script', 'style']);
/** Elements removed from source content (snippet JS/CSS is handled separately). */
const DROP_TAGS = new Set(['script', 'noscript', 'link', 'meta', 'base', 'template', 'iframe', 'object', 'embed']);

export interface ParseOptions {
  fileName?: string;
  origin?: SourceFormat;
}

const isElement = (node: Nodes | undefined): node is Element => node?.type === 'element';
const isBlock = (node: Nodes | undefined) => isElement(node) && BLOCK_TAGS.has(node.tagName);
const isWhitespace = (node: Nodes | undefined): node is Text => node?.type === 'text' && /^\s*$/.test(node.value);

function findElement(node: Nodes, tagName: string): Element | undefined {
  if (isElement(node) && node.tagName === tagName) return node;
  if ('children' in node) {
    for (const child of node.children) {
      const found = findElement(child, tagName);
      if (found) return found;
    }
  }
  return undefined;
}

function textContent(node: Nodes): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(textContent).join('') : '';
}

/** Parse an HTML string (a full page or a fragment) into a CmsDocument. */
export function parseHtml(html: string, options: ParseOptions = {}): CmsDocument {
  const full = unified().use(rehypeParse).parse(html);
  const warnings: string[] = [];
  const styles: string[] = [];

  const head = findElement(full, 'head');
  const body = findElement(full, 'body');
  const titleEl = head && findElement(head, 'title');

  if (head) {
    for (const child of head.children) {
      if (isElement(child) && child.tagName === 'style') styles.push(textContent(child));
    }
  }

  const tree: Root = { type: 'root', children: (body?.children ?? []) as RootContent[] };
  clean(tree, { styles, warnings });
  normalizeWhitespace(tree, false);

  const h1 = findElement(tree, 'h1');
  const title = (titleEl && textContent(titleEl).trim()) || (h1 && textContent(h1).trim()) || undefined;

  return {
    kind: 'document',
    tree,
    meta: { origin: options.origin ?? 'html', fileName: options.fileName, title, styles, warnings },
    assets: {},
  };
}

/** Remove comments, scripts, event handlers and position data. Collects <style> CSS. */
function clean(parent: Parent, ctx: { styles: string[]; warnings: string[] }) {
  const kept: RootContent[] = [];
  for (const child of parent.children) {
    delete (child as { position?: unknown }).position;
    if (child.type === 'comment' || child.type === 'doctype') continue;
    if (isElement(child)) {
      if (child.tagName === 'style') {
        ctx.styles.push(textContent(child));
        continue;
      }
      if (DROP_TAGS.has(child.tagName)) {
        ctx.warnings.push(`Removed <${child.tagName}> element`);
        continue;
      }
      for (const key of Object.keys(child.properties)) {
        const value = child.properties[key];
        if (/^on[A-Z]/.test(key)) {
          delete child.properties[key];
          ctx.warnings.push(`Removed ${key.toLowerCase()} attribute from <${child.tagName}>`);
        } else if ((key === 'href' || key === 'src') && typeof value === 'string' && /^\s*javascript:/i.test(value)) {
          delete child.properties[key];
          ctx.warnings.push(`Removed javascript: URL from <${child.tagName}>`);
        }
      }
      clean(child, ctx);
    }
    kept.push(child);
  }
  parent.children = kept as Parent['children'];
}

/**
 * Collapse whitespace the way a browser renders it, so the tree and the text index match what people see:
 * runs of whitespace become one space, whitespace-only text between blocks is removed,
 * and text at the start and end of a block is trimmed.
 */
function normalizeWhitespace(parent: Root | Element, preserve: boolean) {
  const tag = parent.type === 'element' ? parent.tagName : 'root';
  const isContainer = parent.type === 'root' || CONTAINER_TAGS.has(tag);
  const blockParent = parent.type === 'root' || BLOCK_TAGS.has(tag);

  if (!preserve) {
    const children = parent.children;
    const kept: ElementContent[] = [];
    children.forEach((child, i) => {
      if (isWhitespace(child)) {
        const prev = kept[kept.length - 1];
        const next = children[i + 1];
        const betweenBlocks = (prev === undefined || isBlock(prev)) && (next === undefined || isBlock(next));
        if (isContainer || (blockParent && betweenBlocks)) return;
      }
      kept.push(child as ElementContent);
    });
    for (const child of kept) {
      if (child.type === 'text') child.value = child.value.replace(/\s+/g, ' ');
    }
    if (blockParent) {
      const first = kept[0];
      const last = kept[kept.length - 1];
      if (first?.type === 'text') first.value = first.value.trimStart();
      if (last?.type === 'text') last.value = last.value.trimEnd();
      // A space right after a block (or before one) never renders either.
      kept.forEach((child, i) => {
        if (child.type !== 'text') return;
        if (isBlock(kept[i - 1])) child.value = child.value.trimStart();
        if (isBlock(kept[i + 1])) child.value = child.value.trimEnd();
      });
    }
    parent.children = kept.filter((c) => c.type !== 'text' || c.value !== '') as typeof parent.children;
  }

  for (const child of parent.children) {
    if (isElement(child)) normalizeWhitespace(child, preserve || PRESERVE_TAGS.has(child.tagName));
  }
}

export interface SerializeOptions {
  /** Wrap the content in a complete page with <head>, <title> and the document's styles. */
  fullDocument?: boolean;
  /** Replace `asset:<id>` image sources with data URIs. */
  inlineAssets?: boolean;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Serialize a CmsDocument to an HTML string. Never changes the document. */
export function serialize(doc: CmsDocument, options: SerializeOptions = {}): string {
  let tree = doc.tree;
  if (options.inlineAssets) {
    tree = structuredClone(tree);
    visitElements(tree, (el) => {
      const src = el.properties.src;
      if (typeof src === 'string' && src.startsWith('asset:')) {
        const asset = doc.assets[src.slice('asset:'.length)];
        if (asset) el.properties.src = `data:${asset.contentType};base64,${asset.base64}`;
      }
    });
  }
  const body = unified().use(rehypeStringify).stringify(tree);
  if (!options.fullDocument) return body;

  const title = doc.meta.title ? `<title>${escapeHtml(doc.meta.title)}</title>` : '';
  const styles = doc.meta.styles.map((css) => `<style>${css}</style>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${title}${styles}</head><body>${body}</body></html>`;
}

export function visitElements(node: Nodes, fn: (el: Element, path: number[]) => void, path: number[] = []) {
  if (isElement(node)) fn(node, path);
  if ('children' in node) node.children.forEach((child, i) => visitElements(child, fn, [...path, i]));
}

/** Follow a path of child indexes from the root. */
export function nodeAtPath(tree: Root, path: number[]): Nodes | undefined {
  let node: Nodes = tree;
  for (const i of path) {
    if (!('children' in node)) return undefined;
    const next: Nodes | undefined = node.children[i];
    if (!next) return undefined;
    node = next;
  }
  return node;
}

// ---------------------------------------------------------------------------------------------
// Text index: the document's visible text as one string, with every character mapped to its text node.
// Blocks are separated by "\n", which belongs to no text node.

export interface TextSegment {
  /** Offset of the segment's first character in `TextIndex.text`. */
  start: number;
  /** Offset just after the segment's last character. */
  end: number;
  /** Child-index path from the root to the text node. */
  path: number[];
  node: Text;
}

export interface TextIndex {
  text: string;
  segments: TextSegment[];
}

export function buildTextIndex(tree: Root): TextIndex {
  let text = '';
  const segments: TextSegment[] = [];
  const breakLine = () => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const walk = (node: Nodes, path: number[]) => {
    if (node.type === 'text') {
      if (node.value === '') return;
      segments.push({ start: text.length, end: text.length + node.value.length, path, node });
      text += node.value;
      return;
    }
    if (!isElement(node) && node.type !== 'root') return;
    if (isElement(node) && node.tagName === 'br') {
      text += '\n';
      return;
    }
    const block = isBlock(node);
    if (block) breakLine();
    if ('children' in node) node.children.forEach((child, i) => walk(child, [...path, i]));
    if (block) breakLine();
  };

  walk(tree, []);
  return { text: text.replace(/\n+$/, ''), segments };
}

export interface TextLocation {
  segment: TextSegment;
  /** Offset inside the text node. */
  offset: number;
}

/**
 * Find the text node holding a character offset. An offset on a boundary between two nodes
 * belongs to the following node, unless `bias` is 'backward' (use that for the end of a range).
 * Offsets that fall on a block separator snap to the nearest text in the `bias` direction.
 */
export function locate(index: TextIndex, offset: number, bias: 'forward' | 'backward' = 'forward'): TextLocation | undefined {
  const { segments } = index;
  if (segments.length === 0 || offset < 0 || offset > index.text.length) return undefined;

  // Binary search for the last segment starting at or before the offset.
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  let i = lo;
  const seg = segments[i];

  if (bias === 'backward') {
    if (offset > seg.start && offset <= seg.end) return { segment: seg, offset: offset - seg.start };
    if (offset === seg.start && i > 0) return { segment: segments[i - 1], offset: segments[i - 1].end - segments[i - 1].start };
    if (offset <= seg.start) return { segment: seg, offset: 0 };
    return { segment: seg, offset: seg.end - seg.start };
  }

  if (offset >= seg.start && offset < seg.end) return { segment: seg, offset: offset - seg.start };
  if (offset < seg.start) return { segment: seg, offset: 0 };
  // Past the end of this segment: move to the next one, or stay at the very end.
  i += 1;
  return i < segments.length ? { segment: segments[i], offset: 0 } : { segment: seg, offset: seg.end - seg.start };
}
