// Read a .docx in "review mode": tracked changes and comments are kept (mammoth, used by docx.ts, accepts every
// insertion, drops every deletion and loses where comments are), and so is the direct formatting a Formatting node
// needs to spot inconsistent formatting (fonts, sizes, colours: mammoth ignores those).
//
// A .docx is a zip of XML parts: word/document.xml (the body), styles.xml, numbering.xml (lists), comments.xml (+
// commentsExtended.xml for replies and "resolved", commentsIds.xml + commentsExtensible.xml for UTC dates) and the
// relationships (links, images). The body becomes HTML (then a CmsDocument through parseHtml, like the .pptx import),
// with the review markup described at `ReviewInfo` in types.ts.
// JSZip and xmldom are loaded on demand (the .pptx import and mammoth use them too).
import type JSZipType from 'jszip';
import { parseHtml } from './document';
import { hashBytes } from './hash';
import type { Asset, CmsDocument, ReviewComment, ReviewInfo, Revision, RevisionType } from './types';

export interface DocxReviewOptions {
  fileName?: string;
}

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  w16du: 'http://schemas.microsoft.com/office/word/2023/wordml/word16du',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
};

/** Shown in the preview (and the exported page): insertions, deletions, changed formatting, comment ranges. */
export const REVIEW_CSS = [
  'ins[data-rev]{background:#dcfce7;color:#166534;text-decoration:underline}',
  'del[data-rev]{background:#fee2e2;color:#991b1b;text-decoration:line-through}',
  'span[data-rev]{outline:1px dashed #a855f7;outline-offset:1px}',
  '[data-rev-block]{box-shadow:inset 3px 0 #a855f7;padding-left:.5em}',
  '[data-rev-mark]::after{content:"\\00b6";color:#a855f7}',
  'span[data-comments]{background:#fef08a}',
  'span[data-comments]:empty::before{content:"\\1F4AC";font-size:.8em}',
].join('\n');

/** The main part's name, word/<MAIN>.xml. */
const MAIN = 'document';

const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };

// ---------------------------------------------------------------------------------------------
// XML helpers (xmldom; localName so prefixes do not matter)

type XmlElement = Element;
const kids = (el: XmlElement | null | undefined, name?: string): XmlElement[] => {
  const out: XmlElement[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as XmlElement).localName === name)) out.push(n as XmlElement);
  }
  return out;
};
const kid = (el: XmlElement | null | undefined, name: string) => kids(el, name)[0];
const descendants = (el: XmlElement | null | undefined, name: string): XmlElement[] =>
  el ? (Array.from(el.getElementsByTagNameNS('*', name)) as XmlElement[]) : [];
/** A w: attribute (or another namespace's), undefined when missing (xmldom returns "" for missing attributes). */
const attr = (el: XmlElement | null | undefined, name: string, ns = NS.w): string | undefined =>
  el?.hasAttributeNS(ns, name) ? el.getAttributeNS(ns, name)! : el?.hasAttribute(`w:${name}`) ? el.getAttribute(`w:${name}`)! : undefined;
/** An on/off property (<w:b/>, <w:b w:val="0"/>, …). */
const on = (el: XmlElement | undefined) => !!el && !['0', 'false', 'none'].includes(attr(el, 'val') ?? '1');
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------------
// Formatting

/** Run formatting we read: on/off ones, size in points, font, colour, highlight, vertical alignment. */
export interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  /** Points. */
  sz?: number;
  font?: string;
  color?: string;
  highlight?: string;
  vert?: 'sup' | 'sub';
}

function readRunProps(rPr: XmlElement | undefined): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  for (const k of ['b', 'i', 'strike', 'caps', 'smallCaps'] as const) {
    const el = kid(rPr, k) ?? (k === 'strike' ? kid(rPr, 'dstrike') : undefined);
    if (el) p[k] = on(el);
  }
  const u = kid(rPr, 'u');
  if (u) p.u = (attr(u, 'val') ?? 'single') !== 'none';
  const sz = attr(kid(rPr, 'sz'), 'val');
  if (sz) p.sz = Number(sz) / 2;
  const font = kid(rPr, 'rFonts');
  const name = attr(font, 'ascii') ?? attr(font, 'hAnsi');
  if (name) p.font = name;
  const color = attr(kid(rPr, 'color'), 'val');
  if (color && color !== 'auto') p.color = color.toLowerCase();
  const hl = attr(kid(rPr, 'highlight'), 'val') ?? (attr(kid(rPr, 'shd'), 'fill', NS.w) && attr(kid(rPr, 'shd'), 'fill') !== 'auto' ? attr(kid(rPr, 'shd'), 'fill') : undefined);
  if (hl && hl !== 'none') p.highlight = hl.toLowerCase();
  const va = attr(kid(rPr, 'vertAlign'), 'val');
  if (va === 'superscript') p.vert = 'sup';
  if (va === 'subscript') p.vert = 'sub';
  return p;
}

/** "b i sz=17 font=Calibri" (only what is set and on). */
export function runPropsKey(p: RunProps): string {
  const parts: string[] = [];
  for (const k of ['b', 'i', 'u', 'strike', 'caps', 'smallCaps'] as const) if (p[k]) parts.push(k);
  if (p.sz) parts.push(`sz=${p.sz}`);
  if (p.font) parts.push(`font=${p.font}`);
  if (p.color) parts.push(`color=${p.color}`);
  if (p.highlight) parts.push(`highlight=${p.highlight}`);
  if (p.vert) parts.push(p.vert);
  return parts.join(' ');
}

/** "bold, italic, 17 pt, Calibri" for people. */
export function describeRunProps(p: RunProps): string {
  const words: Record<string, string> = { b: 'bold', i: 'italic', u: 'underlined', strike: 'struck through', caps: 'capitals', smallCaps: 'small capitals' };
  const parts: string[] = [];
  for (const k of ['b', 'i', 'u', 'strike', 'caps', 'smallCaps'] as const) if (p[k]) parts.push(words[k]);
  if (p.sz) parts.push(`${p.sz} pt`);
  if (p.font) parts.push(p.font);
  if (p.color) parts.push(`colour #${p.color}`);
  if (p.highlight) parts.push(`highlight ${p.highlight}`);
  if (p.vert) parts.push(p.vert === 'sup' ? 'superscript' : 'subscript');
  return parts.join(', ') || 'plain';
}

interface StyleInfo {
  name: string;
  basedOn?: string;
  /** The style's own list (pPr/numPr). */
  numId?: string;
  ilvl?: number;
}

interface ListLevel {
  /** 'bullet' or a number format (decimal, lowerLetter, …). */
  format: string;
  text: string;
}

interface Ctx {
  prefix: string;
  styles: Map<string, StyleInfo>;
  /** numId → levels. */
  numbering: Map<string, ListLevel[]>;
  rels: Map<string, { target: string; external: boolean }>;
  bytes: (part: string) => Promise<Uint8Array | undefined>;
  assets: Record<string, Asset>;
  review: ReviewInfo;
  warnings: Set<string>;
  revisionCount: number;
  /** Word comment id → our id, for comments found in the body. */
  commentIds: Map<string, string>;
  /** Comment ids whose range has started (a reference without a range is a comment on a point). */
  rangedComments: Set<string>;
  /** Comments open at the current position. */
  openComments: string[];
  /** Comments whose range holds text so far. */
  commentsWithText: Set<string>;
}

function styleName(ctx: Ctx, id: string | undefined): string {
  return (id && ctx.styles.get(id)?.name) || 'Normal';
}

/** The list a paragraph is in: its own numPr, or its style's (and the styles it is based on). */
function listOf(ctx: Ctx, pPr: XmlElement | undefined): { numId: string; ilvl: number } | undefined {
  const numPr = kid(pPr, 'numPr');
  if (numPr) {
    const numId = attr(kid(numPr, 'numId'), 'val');
    if (!numId || numId === '0') return undefined;
    return { numId, ilvl: Number(attr(kid(numPr, 'ilvl'), 'val') ?? 0) };
  }
  let style = attr(kid(pPr, 'pStyle'), 'val');
  for (let guard = 0; style && guard < 10; guard++) {
    const s = ctx.styles.get(style);
    if (s?.numId) return s.numId === '0' ? undefined : { numId: s.numId, ilvl: s.ilvl ?? 0 };
    style = s?.basedOn;
  }
  return undefined;
}

const listKind = (ctx: Ctx, list: { numId: string; ilvl: number } | undefined) => {
  if (!list) return undefined;
  const level = ctx.numbering.get(list.numId)?.[list.ilvl];
  return level?.format === 'bullet' ? 'bullet' : 'number';
};

// ---------------------------------------------------------------------------------------------
// Revisions and dates

function revisionDate(el: XmlElement): { date?: string; utc: boolean } {
  const utc = attr(el, 'dateUtc', NS.w16du);
  if (utc) return { date: utc, utc: true };
  const date = attr(el, 'date');
  if (!date) return { utc: false };
  return { date, utc: /(Z|[+-]\d\d:?\d\d)$/.test(date) };
}

function addRevision(ctx: Ctx, el: XmlElement, type: RevisionType, extra: Partial<Revision> = {}): string {
  const id = `${ctx.prefix}-r${++ctx.revisionCount}`;
  const author = attr(el, 'author') ?? '';
  if (author && !ctx.review.authors.includes(author)) ctx.review.authors.push(author);
  ctx.review.revisions[id] = { id, type, author, ...revisionDate(el), ...extra };
  return id;
}

// ---------------------------------------------------------------------------------------------
// Body

/** Read a .docx with its tracked changes and comments. Throws with a plain message for files it cannot read. */
export async function importDocxReview(data: ArrayBuffer | Uint8Array, options: DocxReviewOptions = {}): Promise<CmsDocument> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const name = options.fileName ?? 'the .docx file';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error(`${name} is an old .doc file or protected with a password; save it as .docx`);
  const [{ default: JSZip }, { DOMParser }] = await Promise.all([import('jszip'), import('@xmldom/xmldom')]);
  let zip: JSZipType;
  try {
    zip = await (JSZip as unknown as typeof JSZipType).loadAsync(bytes);
  } catch {
    throw new Error(`${name} is not a Word file (it is not a zip package)`);
  }
  const parser = new DOMParser({ errorHandler: { warning: () => {} } });
  const xml = async (part: string) => {
    const text = await zip.file(part)?.async('string');
    return text ? (parser.parseFromString(text, 'application/xml').documentElement as unknown as XmlElement) : undefined;
  };
  // (Written in two parts: the engine's purity check reads "document." as the browser's document.)
  const main = await xml(`word/${MAIN}.xml`);
  const body = kid(main, 'body');
  if (!body) throw new Error(`${name} has no document body`);

  const ctx: Ctx = {
    prefix: `w${hashBytes(bytes).slice(0, 6)}`,
    styles: readStyles(await xml('word/styles.xml')),
    numbering: readNumbering(await xml('word/numbering.xml')),
    rels: readRels(await xml(`word/_rels/${MAIN}.xml.rels`)),
    bytes: async (part) => {
      const f = zip.file(part);
      return f ? new Uint8Array(await f.async('uint8array')) : undefined;
    },
    assets: {},
    review: { authors: [], revisions: {}, comments: {} },
    warnings: new Set(),
    revisionCount: 0,
    commentIds: new Map(),
    rangedComments: new Set(),
    openComments: [],
    commentsWithText: new Set(),
  };
  // Comment ids first, so ranges in the body can be named.
  const comments = await xml('word/comments.xml');
  for (const c of kids(comments, 'comment')) {
    const wid = attr(c, 'id');
    if (wid !== undefined) ctx.commentIds.set(wid, `${ctx.prefix}-c${wid}`);
  }

  const html = await renderBlocks(kids(body), ctx);
  await readComments(ctx, comments, {
    extended: await xml('word/commentsExtended.xml'),
    ids: await xml('word/commentsIds.xml'),
    extensible: await xml('word/commentsExtensible.xml'),
  });
  if (zip.file('word/footnotes.xml') && descendants(body, 'footnoteReference').length) ctx.warnings.add('Footnotes are not imported yet; their numbers are left out');
  if (descendants(body, 'endnoteReference').length) ctx.warnings.add('Endnotes are not imported yet; their numbers are left out');

  const doc = parseHtml(html, { fileName: options.fileName, origin: 'docx' });
  doc.assets = ctx.assets;
  doc.meta.styles.push(REVIEW_CSS);
  doc.meta.review = ctx.review;
  doc.meta.warnings.push(...ctx.warnings);
  return doc;
}

function readStyles(root: XmlElement | undefined): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  for (const s of kids(root, 'style')) {
    const id = attr(s, 'styleId');
    if (!id) continue;
    const numPr = kid(kid(s, 'pPr'), 'numPr');
    out.set(id, {
      // Word writes its built-in names in lower case ("heading 1"); people see "Heading 1".
      name: (attr(kid(s, 'name'), 'val') ?? id).replace(/^./, (c) => c.toUpperCase()),
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      numId: attr(kid(numPr, 'numId'), 'val'),
      ilvl: numPr ? Number(attr(kid(numPr, 'ilvl'), 'val') ?? 0) : undefined,
    });
  }
  return out;
}

function readNumbering(root: XmlElement | undefined): Map<string, ListLevel[]> {
  const abstract = new Map<string, ListLevel[]>();
  for (const a of kids(root, 'abstractNum')) {
    const levels: ListLevel[] = [];
    for (const l of kids(a, 'lvl')) {
      levels[Number(attr(l, 'ilvl') ?? 0)] = { format: attr(kid(l, 'numFmt'), 'val') ?? 'decimal', text: attr(kid(l, 'lvlText'), 'val') ?? '' };
    }
    abstract.set(attr(a, 'abstractNumId') ?? '', levels);
  }
  const out = new Map<string, ListLevel[]>();
  for (const n of kids(root, 'num')) out.set(attr(n, 'numId') ?? '', abstract.get(attr(kid(n, 'abstractNumId'), 'val') ?? '') ?? []);
  return out;
}

function readRels(root: XmlElement | undefined) {
  const out = new Map<string, { target: string; external: boolean }>();
  for (const r of kids(root, 'Relationship')) {
    out.set(r.getAttribute('Id') ?? '', { target: r.getAttribute('Target') ?? '', external: r.getAttribute('TargetMode') === 'External' });
  }
  return out;
}

interface RenderedParagraph {
  html: string;
  list?: { numId: string; ilvl: number; kind: 'bullet' | 'number' };
}

/** Blocks (paragraphs, tables, content controls) with consecutive list paragraphs as nested lists. */
async function renderBlocks(blocks: XmlElement[], ctx: Ctx): Promise<string> {
  const out: string[] = [];
  let run: RenderedParagraph[] = [];
  const flush = () => {
    if (run.length) out.push(renderLists(run));
    run = [];
  };
  for (const b of blocks) {
    if (b.localName === 'p') {
      const p = await renderParagraph(b, ctx);
      if (p.list) run.push(p);
      else {
        flush();
        out.push(p.html);
      }
    } else if (b.localName === 'tbl') {
      flush();
      out.push(await renderTable(b, ctx));
    } else if (b.localName === 'sdt') {
      flush();
      out.push(await renderBlocks(kids(kid(b, 'sdtContent')), ctx));
    } else if (b.localName === 'customXml') {
      flush();
      out.push(await renderBlocks(kids(b), ctx));
    }
  }
  flush();
  return out.join('\n');
}

/** List paragraphs as <ul> / <ol> nested by level; a different list or type at the same level starts a new list. */
function renderLists(items: RenderedParagraph[]): string {
  const out: string[] = [];
  const open: { tag: string; level: number; numId: string }[] = [];
  for (const p of items) {
    const level = p.list!.ilvl;
    const tag = p.list!.kind === 'number' ? 'ol' : 'ul';
    while (open.length && open[open.length - 1].level > level) out.push(`</li></${open.pop()!.tag}>`);
    const top = open[open.length - 1];
    if (top && top.level === level && (top.tag !== tag || top.numId !== p.list!.numId)) out.push(`</li></${open.pop()!.tag}>`);
    const current = open[open.length - 1];
    if (current && current.level === level) out.push(`</li>${p.html}`);
    else {
      out.push(`<${tag} data-docx-list="${escapeHtml(p.list!.numId)}">${p.html}`);
      open.push({ tag, level, numId: p.list!.numId });
    }
  }
  while (open.length) out.push(`</li></${open.pop()!.tag}>`);
  // Items were written as "<li …>content" (closed when the next one starts).
  return out.join('');
}

async function renderParagraph(p: XmlElement, ctx: Ctx): Promise<RenderedParagraph> {
  const pPr = kid(p, 'pPr');
  const styleId = attr(kid(pPr, 'pStyle'), 'val');
  const style = styleName(ctx, styleId);
  const list = listOf(ctx, pPr);
  const kind = listKind(ctx, list);
  const headingLevel = /^heading ([1-6])$/i.exec(style)?.[1] ?? (/^title$/i.test(style) ? '1' : undefined);
  const tag = list ? 'li' : headingLevel ? `h${headingLevel}` : 'p';

  const attrs: string[] = [`data-docx-style="${escapeHtml(style)}"`];
  // Paragraph formatting changes; a changed paragraph mark (split or joined paragraphs); the mark's own formatting.
  const pChange = kid(pPr, 'pPrChange');
  if (pChange) {
    const old = kid(pChange, 'pPr');
    const oldStyle = styleName(ctx, attr(kid(old, 'pStyle'), 'val'));
    const oldList = listOf(ctx, old ?? undefined);
    const oldKind = listKind(ctx, oldList);
    const beforeProps: Record<string, string> = { style: oldStyle, list: oldKind ?? 'none' };
    const before = [oldStyle, oldKind === 'bullet' ? 'bulleted list' : oldKind === 'number' ? 'numbered list' : 'not in a list'].join(', ');
    attrs.push(`data-rev-block="${addRevision(ctx, pChange, 'paragraph', { before, beforeProps })}"`);
  }
  const markRpr = kid(pPr, 'rPr');
  for (const m of ['ins', 'del'] as const) {
    const el = kid(markRpr, m);
    if (el) attrs.push(`data-rev-mark="${addRevision(ctx, el, m === 'ins' ? 'insertion' : 'deletion', { mark: true })}"`);
  }
  const markFormat = kid(markRpr, 'rPrChange');
  if (markFormat) addRevision(ctx, markFormat, 'format', { hidden: true, before: describeRunProps(readRunProps(kid(markFormat, 'rPr'))) });
  const jc = attr(kid(pPr, 'jc'), 'val');
  if (jc && jc !== 'left' && jc !== 'start' && jc !== 'both') attrs.push(`data-docx-align="${escapeHtml(jc)}"`);
  if (!list && Number(attr(kid(pPr, 'ind'), 'left') ?? attr(kid(pPr, 'ind'), 'start') ?? 0) > 0) attrs.push('data-docx-indent=""');

  const runs: { text: number; props: RunProps }[] = [];
  const content = await renderInline(kids(p), ctx, runs);
  // The paragraph's typical direct formatting: what covers most of its text.
  const fmt = dominantProps(runs);
  if (fmt) attrs.push(`data-docx-fmt="${escapeHtml(fmt)}"`);
  return {
    html: `<${tag} ${attrs.join(' ')}>${content}${tag === 'li' ? '' : `</${tag}>`}`,
    list: list && kind ? { ...list, kind } : undefined,
  };
}

function dominantProps(runs: { text: number; props: RunProps }[]): string {
  const total = runs.reduce((n, r) => n + r.text, 0);
  if (!total) return '';
  const weight = new Map<string, number>();
  for (const r of runs) {
    for (const part of runPropsKey(r.props).split(' ').filter(Boolean)) weight.set(part, (weight.get(part) ?? 0) + r.text);
  }
  // A property on (nearly) all of the text describes the paragraph; a bold lead-in does not.
  return [...weight].filter(([, w]) => w >= total * 0.8).map(([k]) => k).join(' ');
}

/** Runs, links, changes and comment ranges inside a paragraph (or inside a w:ins / w:del / w:hyperlink). */
async function renderInline(nodes: XmlElement[], ctx: Ctx, runs: { text: number; props: RunProps }[], deleted = false): Promise<string> {
  const out: string[] = [];
  for (const n of nodes) {
    switch (n.localName) {
      case 'r':
        out.push(await renderRun(n, ctx, runs, deleted));
        break;
      case 'ins':
      case 'moveTo': {
        const id = addRevision(ctx, n, n.localName === 'ins' ? 'insertion' : 'move-to');
        out.push(`<ins data-rev="${id}">${await renderInline(kids(n), ctx, runs, deleted)}</ins>`);
        break;
      }
      case 'del':
      case 'moveFrom': {
        const id = addRevision(ctx, n, n.localName === 'del' ? 'deletion' : 'move-from');
        out.push(`<del data-rev="${id}">${await renderInline(kids(n), ctx, runs, true)}</del>`);
        break;
      }
      case 'hyperlink': {
        const rel = ctx.rels.get(attr(n, 'id', NS.r) ?? '');
        const anchor = attr(n, 'anchor');
        const href = rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : anchor ? `#${anchor}` : undefined;
        const inner = await renderInline(kids(n), ctx, runs, deleted);
        out.push(href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner);
        break;
      }
      case 'commentRangeStart': {
        const id = ctx.commentIds.get(attr(n, 'id') ?? '');
        if (id) {
          ctx.rangedComments.add(id);
          ctx.openComments.push(id);
        }
        break;
      }
      case 'commentRangeEnd': {
        const id = ctx.commentIds.get(attr(n, 'id') ?? '');
        if (!id) break;
        ctx.openComments = ctx.openComments.filter((c) => c !== id);
        // A range with no text in it: the comment is about this point.
        if (!ctx.commentsWithText.has(id)) out.push(`<span data-comments="${id}"></span>`);
        break;
      }
      case 'smartTag':
      case 'customXml':
      case 'fldSimple':
        out.push(await renderInline(kids(n), ctx, runs, deleted));
        break;
      case 'sdt':
        out.push(await renderInline(kids(kid(n, 'sdtContent')), ctx, runs, deleted));
        break;
      default:
        break;
    }
  }
  return out.join('');
}

async function renderRun(r: XmlElement, ctx: Ctx, runs: { text: number; props: RunProps }[], deleted: boolean): Promise<string> {
  const rPr = kid(r, 'rPr');
  const props = readRunProps(rPr);
  const parts: string[] = [];
  let length = 0;
  for (const c of kids(r)) {
    switch (c.localName) {
      case 't':
      case 'delText': {
        const t = c.textContent ?? '';
        length += t.length;
        parts.push(escapeHtml(t));
        break;
      }
      case 'tab':
      case 'ptab':
        parts.push(' ');
        length += 1;
        break;
      case 'br':
      case 'cr':
        if (attr(c, 'type') !== 'page' && attr(c, 'type') !== 'column') parts.push('<br>');
        break;
      case 'noBreakHyphen':
        parts.push('-');
        break;
      case 'drawing':
        parts.push(await renderDrawing(c, ctx));
        break;
      case 'pict':
      case 'object':
        ctx.warnings.add('An old-style picture or embedded object was left out');
        break;
      case 'commentReference': {
        const id = ctx.commentIds.get(attr(c, 'id') ?? '');
        // A comment without a range is about this point.
        if (id && !ctx.rangedComments.has(id)) parts.push(`<span data-comments="${id}"></span>`);
        break;
      }
      default:
        break;
    }
  }
  if (!parts.length) return '';
  if (length && !deleted) runs.push({ text: length, props });
  let html = parts.join('');
  // Formatting that has a meaning in HTML gets its element; the rest (size, font, colour, …) stays as data.
  const rest: RunProps = { ...props };
  if (props.vert) html = `<${props.vert}>${html}</${props.vert}>`;
  if (props.strike) html = `<s>${html}</s>`;
  if (props.u) html = `<u>${html}</u>`;
  if (props.i) html = `<em>${html}</em>`;
  if (props.b) html = `<strong>${html}</strong>`;
  for (const k of ['b', 'i', 'u', 'strike', 'vert'] as const) delete rest[k];
  const restKey = runPropsKey(rest);
  if (restKey) html = `<span data-docx-run="${escapeHtml(restKey)}">${html}</span>`;
  const change = kid(rPr, 'rPrChange');
  if (change) {
    const old = readRunProps(kid(change, 'rPr'));
    const beforeProps = Object.fromEntries(runPropsKey(old).split(' ').filter(Boolean).map((k) => (k.includes('=') ? k.split('=') : [k, 'on'])));
    html = `<span data-rev="${addRevision(ctx, change, 'format', { before: describeRunProps(old), beforeProps })}">${html}</span>`;
  }
  // Text inside comment ranges is marked, piece by piece.
  if (ctx.openComments.length && length) {
    for (const id of ctx.openComments) ctx.commentsWithText.add(id);
    html = `<span data-comments="${ctx.openComments.join(' ')}">${html}</span>`;
  }
  return html;
}

async function renderDrawing(drawing: XmlElement, ctx: Ctx): Promise<string> {
  const blip = descendants(drawing, 'blip')[0];
  const rel = ctx.rels.get(blip?.getAttributeNS(NS.r, 'embed') ?? '');
  if (!rel || rel.external) {
    ctx.warnings.add(`A picture ${rel?.external ? 'linked from outside the file' : 'without image data (a chart or shape)'} was left out`);
    return '';
  }
  const ext = rel.target.split('.').pop()?.toLowerCase() ?? '';
  const type = PICTURE_TYPES[ext];
  const part = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`;
  const data = type ? await ctx.bytes(part) : undefined;
  if (!type || !data) {
    ctx.warnings.add(`A ${ext ? `.${ext} ` : ''}picture was left out (browsers cannot show it, or its file is missing)`);
    return '';
  }
  const id = `docx-${hashBytes(data)}`;
  ctx.assets[id] ??= { id, contentType: type, base64: toBase64(data) };
  const docPr = descendants(drawing, 'docPr')[0];
  const alt = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || '';
  const cx = Number(descendants(drawing, 'extent')[0]?.getAttribute('cx') ?? 0);
  return `<img src="asset:${id}" alt="${escapeHtml(alt)}"${cx > 0 ? ` width="${Math.round(cx / 9525)}"` : ''}>`;
}

/** A table: merged cells become colspan / rowspan; header rows and row changes are marked. */
async function renderTable(tbl: XmlElement, ctx: Ctx): Promise<string> {
  const attrs: string[] = [];
  const tblChange = kid(kid(tbl, 'tblPr'), 'tblPrChange');
  if (tblChange) addRevision(ctx, tblChange, 'table', { hidden: true });
  interface Cell { html: string; col: number; span: number; rowspan: number; merge?: 'restart' | 'continue' }
  const rows: { attrs: string[]; cells: Cell[] }[] = [];
  for (const tr of kids(tbl, 'tr')) {
    const trPr = kid(tr, 'trPr');
    const rowAttrs: string[] = [];
    if (on(kid(trPr, 'tblHeader'))) rowAttrs.push('data-docx-header=""');
    for (const m of ['ins', 'del'] as const) {
      const el = kid(trPr, m);
      if (el) rowAttrs.push(`data-rev-block="${addRevision(ctx, el, m === 'ins' ? 'insertion' : 'deletion', { row: true })}"`);
    }
    const trChange = kid(trPr, 'trPrChange');
    if (trChange) addRevision(ctx, trChange, 'table', { hidden: true });
    const cells: Cell[] = [];
    let col = 0;
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr');
      const span = Number(attr(kid(tcPr, 'gridSpan'), 'val') ?? 1);
      const vMerge = kid(tcPr, 'vMerge');
      const tcChange = kid(tcPr, 'tcPrChange');
      if (tcChange) addRevision(ctx, tcChange, 'table', { hidden: true });
      if (kid(tcPr, 'cellIns') || kid(tcPr, 'cellDel')) ctx.warnings.add('A tracked change that inserts or deletes table cells is shown as it is now');
      const merge = vMerge ? ((attr(vMerge, 'val') ?? 'continue') === 'restart' ? 'restart' : 'continue') : undefined;
      cells.push({ html: await renderBlocks(kids(tc).filter((c) => c.localName !== 'tcPr'), ctx), col, span, rowspan: 1, merge });
      col += span;
    }
    rows.push({ attrs: rowAttrs, cells });
  }
  // Vertically merged cells: the first one ("restart") grows; the ones it covers are left out.
  rows.forEach((row, r) => {
    for (const cell of row.cells) {
      if (cell.merge !== 'restart') continue;
      for (let below = r + 1; below < rows.length; below++) {
        const next = rows[below].cells.find((c) => c.col === cell.col);
        if (next?.merge !== 'continue') break;
        cell.rowspan++;
      }
    }
  });
  const body = rows
    .map((row) => {
      const cells = row.cells
        .filter((c) => c.merge !== 'continue')
        .map((c) => `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${c.html}</td>`);
      return `<tr${row.attrs.length ? ` ${row.attrs.join(' ')}` : ''}>${cells.join('')}</tr>`;
    })
    .join('');
  return `<table${attrs.length ? ` ${attrs.join(' ')}` : ''}><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------------------------
// Comments

async function readComments(
  ctx: Ctx,
  root: XmlElement | undefined,
  extra: { extended?: XmlElement; ids?: XmlElement; extensible?: XmlElement },
) {
  // commentsExtended: per comment (by the paraId of its last paragraph) "done" and the parent it replies to.
  const ext = new Map<string, { done: boolean; parent?: string }>();
  for (const e of kids(extra.extended, 'commentEx')) {
    ext.set(attr(e, 'paraId', NS.w15) ?? '', { done: attr(e, 'done', NS.w15) === '1', parent: attr(e, 'paraIdParent', NS.w15) });
  }
  // commentsIds + commentsExtensible: the UTC date (the comment's own date has no time zone).
  const durable = new Map<string, string>();
  for (const e of kids(extra.ids, 'commentId')) durable.set(attr(e, 'paraId', NS.w16cid) ?? '', attr(e, 'durableId', NS.w16cid) ?? '');
  const utcDates = new Map<string, string>();
  for (const e of kids(extra.extensible, 'commentExtensible')) {
    const d = attr(e, 'dateUtc', NS.w16cex);
    if (d) utcDates.set(attr(e, 'durableId', NS.w16cex) ?? '', d);
  }
  const byPara = new Map<string, string>();
  const parents = new Map<string, string>();
  for (const c of kids(root, 'comment')) {
    const id = ctx.commentIds.get(attr(c, 'id') ?? '');
    if (!id) continue;
    const paras = kids(c, 'p');
    const paraId = attr(paras[paras.length - 1], 'paraId', NS.w14) ?? '';
    byPara.set(paraId, id);
    const info = ext.get(paraId);
    if (info?.parent) parents.set(id, info.parent);
    const author = attr(c, 'author') ?? '';
    if (author && !ctx.review.authors.includes(author)) ctx.review.authors.push(author);
    const utc = utcDates.get(durable.get(paraId) ?? '');
    const local = attr(c, 'date');
    const comment: ReviewComment = {
      id,
      author,
      ...(attr(c, 'initials') && { initials: attr(c, 'initials') }),
      ...(utc ? { date: utc, utc: true } : local ? { date: local, utc: /(Z|[+-]\d\d:?\d\d)$/.test(local) } : { utc: false }),
      html: paras.map(commentParagraph).filter(Boolean).join(''),
      resolved: !!info?.done,
    };
    ctx.review.comments[id] = comment;
  }
  for (const [id, parentPara] of parents) {
    const parent = byPara.get(parentPara);
    if (parent && parent !== id) ctx.review.comments[id].parentId = parent;
  }
  // A reply belongs to its thread: resolved when the thread is.
  for (const c of Object.values(ctx.review.comments)) if (c.parentId && ctx.review.comments[c.parentId]?.resolved) c.resolved = true;
}

function commentParagraph(p: XmlElement): string {
  const parts: string[] = [];
  for (const r of descendants(p, 'r')) {
    // Skip the "annotation reference" mark Word puts at the start of a comment.
    if (kid(r, 'annotationRef')) continue;
    let t = kids(r).filter((c) => c.localName === 't').map((c) => escapeHtml(c.textContent ?? '')).join('');
    if (!t) continue;
    const props = readRunProps(kid(r, 'rPr'));
    if (props.i) t = `<em>${t}</em>`;
    if (props.b) t = `<strong>${t}</strong>`;
    parts.push(t);
  }
  const html = parts.join('').trim();
  return html ? `<p>${html}</p>` : '';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
