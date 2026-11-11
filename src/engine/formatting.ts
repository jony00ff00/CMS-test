// One house style for a Word file read in review mode (the Formatting node). Every paragraph has a "format": its
// kind (heading, paragraph, list item, table cell), its Word style, the direct formatting on most of its text, and
// whether it is short and bold, or starts with a number typed by hand. People choose what each format becomes
// (a heading level, a paragraph, a list, a quote, removed); then inline formatting is reduced to what the editor
// keeps (no fonts, sizes or colours), headings lose their bold and italics, bold first rows become table headers and
// neighbouring lists of the same type are joined. What changed can be labelled with comments for review; numbers typed
// by hand become tracked deletions. Word's formatting changes that no longer change anything are accepted.
import type { Element, ElementContent, Root, Text } from 'hast';
import { hashString } from './hash';
import { presentReview } from './review';
import type { CmsDocument, ReviewComment, ReviewInfo, Revision } from './types';

export type FormatTarget = 'keep' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'number' | 'quote' | 'remove';
export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'sub' | 'sup';

export const TARGET_LABELS: Record<FormatTarget, string> = {
  keep: 'Keep as it is',
  p: 'Paragraph',
  h1: 'Heading (h1)',
  h2: 'Heading 1 (h2)',
  h3: 'Heading 2 (h3)',
  h4: 'Heading 3 (h4)',
  bullet: 'Bulleted list item',
  number: 'Numbered list item',
  quote: 'Quote',
  remove: 'Remove',
};

export const INLINE_LABELS: Record<InlineFormat, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', sub: 'Subscript', sup: 'Superscript',
};

export interface FormattingConfig {
  /** What each format becomes (by its key, see `analyseFormats`); formats without a choice get the suggestion. */
  targets?: Record<string, FormatTarget>;
  /** Inline formatting to keep (links are always kept). Default bold, italic, subscript, superscript. */
  inline?: InlineFormat[];
  /** A bold first row (or a row Word repeats as a header) becomes the table's header row. Default true. */
  tableHeaders?: boolean;
  /** Neighbouring lists of the same type become one. Default true. */
  mergeLists?: boolean;
  /**
   * Every paragraph and list item outside tables becomes an item of a numbered list, numbered in one running sequence
   * through the whole document (headings, tables and quotes are not numbered; a list after one continues with
   * `<ol start="…">`, which needs the editor's list properties feature).
   */
  numberParagraphs?: boolean;
  /**
   * Label what changed with comments for review: one per changed paragraph (default), one per format whose
   * paragraphs became something else, at its first paragraph ("rule"; inline clean-up is not labelled then), or none.
   */
  labels?: 'paragraph' | 'rule' | 'none';
  /** Who the labels and the deletions of typed numbers are by. Default "House style" (user id "house-style"). */
  author?: { id: string; name: string };
}

export const DEFAULT_INLINE: InlineFormat[] = ['bold', 'italic', 'sub', 'sup'];
const HOUSE_STYLE = { id: 'house-style', name: 'House style' };

/** A format found in the document: one row of the Formatting node's table. */
export interface FormatRow {
  key: string;
  /** "Paragraph · Normal · bold, short" */
  label: string;
  kind: 'heading' | 'paragraph' | 'bullet' | 'number' | 'cell' | 'empty';
  count: number;
  /** The first paragraph's text (up to 60 characters). */
  sample: string;
  suggested: FormatTarget;
}

const TYPED_NUMBER = /^\s*(\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+/i;
const textOf = (n: ElementContent | Root): string => (n.type === 'text' ? n.value : 'children' in n ? n.children.map((c) => textOf(c as ElementContent)).join('') : '');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const FMT_WORDS: Record<string, string> = { b: 'bold', i: 'italic', u: 'underlined', strike: 'struck through', caps: 'capitals', smallCaps: 'small capitals', sup: 'superscript', sub: 'subscript' };
const describeFmt = (fmt: string) =>
  fmt
    .split(' ')
    .filter(Boolean)
    .map((p) => {
      const [k, v] = p.split('=');
      if (k === 'sz') return `${v} pt`;
      if (k === 'font') return v;
      if (k === 'color') return `colour #${v}`;
      if (k === 'highlight') return `highlight ${v}`;
      return FMT_WORDS[k] ?? k;
    })
    .join(', ');

interface Block {
  el: Element;
  parent: Root | Element;
  key: string;
  row: Omit<FormatRow, 'count' | 'sample'>;
}

/** The blocks that came from Word (they have `data-docx-style`), with their format, in document order. */
function blocksOf(tree: Root): Block[] {
  const out: Block[] = [];
  const walk = (parent: Root | Element, inCell: boolean) => {
    for (const c of parent.children) {
      if (c.type !== 'element') continue;
      const style = c.properties.dataDocxStyle;
      if (typeof style === 'string') out.push(describe(c, parent, style, inCell));
      walk(c, inCell || c.tagName === 'td' || c.tagName === 'th');
    }
  };
  walk(tree, false);
  return out;
}

function describe(el: Element, parent: Root | Element, style: string, inCell: boolean): Block {
  const fmt = typeof el.properties.dataDocxFmt === 'string' ? el.properties.dataDocxFmt : '';
  const text = textOf(el);
  const listTag = parent.type === 'element' ? parent.tagName : '';
  const kind: FormatRow['kind'] = !text.trim()
    ? 'empty'
    : /^h[1-6]$/.test(el.tagName)
      ? 'heading'
      : el.tagName === 'li'
        ? listTag === 'ol' ? 'number' : 'bullet'
        : inCell ? 'cell' : 'paragraph';
  const flags: string[] = [];
  if (kind === 'paragraph' && TYPED_NUMBER.test(text)) flags.push('typed number');
  else if (kind === 'paragraph' && /(^| )b( |$)/.test(fmt) && words(text) <= 12) flags.push('short');
  const kindLabel = { heading: 'Heading', paragraph: 'Paragraph', bullet: 'Bulleted list item', number: 'Numbered list item', cell: 'Table cell', empty: 'Empty paragraph' }[kind];
  const key = [kind, style, kind === 'empty' ? '' : fmt, ...flags].join('|');
  const label = [kindLabel, style, ...(kind === 'empty' ? [] : [describeFmt(fmt), ...flags].filter(Boolean))].join(' · ');
  return { el, parent, key, row: { key, label, kind, suggested: suggest(kind, style, flags) } };
}

function suggest(kind: FormatRow['kind'], style: string, flags: string[]): FormatTarget {
  if (kind === 'empty') return 'remove';
  if (kind === 'heading') {
    // The editor's "Heading 1" is <h2> (the page title is outside the content): Word's levels move one down.
    const level = /(\d)$/.exec(style)?.[1];
    return level === '1' || !level ? 'h2' : level === '2' ? 'h3' : 'h4';
  }
  if (kind === 'paragraph' && flags.includes('typed number')) return 'number';
  if (kind === 'paragraph' && flags.includes('short')) return 'h4';
  if (kind === 'paragraph') return 'p';
  return 'keep';
}

/** The formats of a document, most used first (ties in document order). */
export function analyseFormats(doc: CmsDocument): FormatRow[] {
  const rows = new Map<string, FormatRow>();
  for (const b of blocksOf(doc.tree)) {
    const row = rows.get(b.key);
    if (row) row.count++;
    else rows.set(b.key, { ...b.row, count: 1, sample: textOf(b.el).trim().slice(0, 60) });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}

export interface FormattingResult {
  document: CmsDocument;
  warnings: string[];
  info: { formats: number; changed: number; removed: number; labels: number; typedNumbers: number; settledChanges: number; tableHeaders: number; numbered: number };
}

const TAG_OF: Record<InlineFormat, string[]> = { bold: ['strong', 'b'], italic: ['em', 'i'], underline: ['u'], strike: ['s', 'strike'], sub: ['sub'], sup: ['sup'] };
const FORMAT_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup']);
const PROP_OF: Record<string, InlineFormat> = { b: 'bold', i: 'italic', u: 'underline', strike: 'strike', sub: 'sub', sup: 'sup' };

/** Apply the house style to a copy of `doc`. Never changes `doc`. */
export function applyFormatting(doc: CmsDocument, config: FormattingConfig = {}): FormattingResult {
  const warnings: string[] = [];
  const tree = structuredClone(doc.tree);
  const keepInline = new Set(config.inline ?? DEFAULT_INLINE);
  const author = config.author ?? HOUSE_STYLE;
  const labelMode = config.labels ?? 'paragraph';
  const seed = hashString(JSON.stringify(doc.meta.review ? Object.keys(doc.meta.review.revisions) : doc.meta.fileName ?? ''));
  let counter = 0;
  const newId = (prefix: string) => `hs${seed.slice(0, 5)}-${prefix}${++counter}`;
  const revisions: Record<string, Revision> = {};
  const comments: Record<string, ReviewComment> = {};
  const info = { formats: 0, changed: 0, removed: 0, labels: 0, typedNumbers: 0, settledChanges: 0, tableHeaders: 0, numbered: 0 };

  const blocks = blocksOf(tree);
  info.formats = new Set(blocks.map((b) => b.key)).size;
  /** What changed in each block, for its label. */
  const notes = new Map<Element, string[]>();
  const note = (el: Element, text: string) => notes.set(el, [...(notes.get(el) ?? []), text]);
  const ruleFirst = new Map<string, { el: Element; count: number; label: string; target: FormatTarget }>();

  // 1. Each block becomes what its format's target says.
  const toList: { el: Element; tag: 'ul' | 'ol' }[] = [];
  for (const b of blocks) {
    const target = config.targets?.[b.key] ?? b.row.suggested;
    const { el } = b;
    const before = el.tagName;
    if (target === 'remove') {
      if (b.row.kind !== 'empty') warnings.push(`A paragraph was removed by the house style: “${textOf(el).slice(0, 40)}”`);
      const kids = b.parent.children as ElementContent[];
      kids.splice(kids.indexOf(el), 1);
      info.removed++;
      continue;
    }
    if (target === 'keep') continue;
    const changed: string[] = [];
    if (target === 'bullet' || target === 'number') {
      const tag = target === 'bullet' ? 'ul' : 'ol';
      if (el.tagName === 'li') {
        if (b.parent.type === 'element' && b.parent.tagName !== tag) {
          b.parent.tagName = tag;
          changed.push(`list → ${target === 'bullet' ? 'bulleted' : 'numbered'}`);
        }
      } else {
        toList.push({ el, tag });
        changed.push(`${b.row.label} → ${TARGET_LABELS[target].toLowerCase()}`);
        if (b.row.key.endsWith('typed number') && target === 'number') {
          if (markTypedNumber(el, () => newId('r'), (id, text) => (revisions[id] = { id, type: 'deletion', author: author.name, utc: true, before: text }))) info.typedNumbers++;
        }
      }
    } else if (el.tagName === 'li') {
      warnings.push(`A list item cannot become ${TARGET_LABELS[target].toLowerCase()} here; it stays a list item`);
    } else if (target === 'quote') {
      el.tagName = 'p';
      el.properties.dataQuote = '';
      changed.push(`${b.row.label} → quote`);
    } else if (target !== before) {
      el.tagName = target;
      changed.push(`${b.row.label} → ${TARGET_LABELS[target]}`);
    }
    if (changed.length) {
      for (const c of changed) note(el, c);
      const first = ruleFirst.get(b.key);
      if (first) first.count++;
      else ruleFirst.set(b.key, { el, count: 1, label: b.row.label, target });
    }
  }
  wrapInto(tree, toList.map((t) => t.el), (el) => toList.find((t) => t.el === el)!.tag, 'li');
  wrapQuotes(tree);

  // 2. Inline formatting: what the editor keeps; nothing in headings; fonts, sizes and colours go.
  const settle = (parent: Root | Element, inHeading: boolean, block: Element | undefined, inLink = false) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      const heading = inHeading || /^h[1-6]$/.test(c.tagName);
      const owner = typeof c.properties.dataDocxStyle === 'string' || /^h[1-6]$/.test(c.tagName) ? c : block;
      // A link's own look (Word's underline and blue) is the editor's job: removing it needs no label.
      const link = inLink || c.tagName === 'a';
      settle(c, heading, owner, link);
      if (c.tagName === 'span' && c.properties.dataDocxRun !== undefined) {
        if (owner && !link) note(owner, 'fonts, sizes or colours removed');
        out.push(...c.children);
        continue;
      }
      if (FORMAT_TAGS.has(c.tagName)) {
        const format = (Object.keys(TAG_OF) as InlineFormat[]).find((f) => TAG_OF[f].includes(c.tagName))!;
        if (heading || !keepInline.has(format)) {
          if (owner && !link) note(owner, `${INLINE_LABELS[format].toLowerCase()} removed`);
          out.push(...c.children);
          continue;
        }
      }
      out.push(c);
    }
    (parent as Element).children = out;
  };
  settle(tree, false, undefined);

  // 3. Word's formatting changes that the house style made meaningless are accepted.
  const review = doc.meta.review;
  const settled = new Set<string>();
  const settleChanges = (parent: Root | Element, inHeading: boolean) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      const heading = inHeading || /^h[1-6]$/.test(c.tagName);
      settleChanges(c, heading);
      const id = typeof c.properties.dataRev === 'string' ? c.properties.dataRev : undefined;
      const r = id ? review?.revisions[id] : undefined;
      if (r?.type === 'format') {
        const kept = (props: string[]) => new Set(heading ? [] : props.filter((p) => keepInline.has(PROP_OF[p])));
        const before = kept(Object.keys(r.beforeProps ?? {}).map((k) => k));
        const after = kept(wholeFormats(c));
        if (before.size === after.size && [...before].every((p) => after.has(p))) {
          settled.add(id!);
          out.push(...c.children);
          continue;
        }
      }
      out.push(c);
    }
    (parent as Element).children = out;
  };
  settleChanges(tree, false);
  info.settledChanges = settled.size;

  // 4. Tables: a bold first row (or a header row in Word) becomes <thead> with <th> cells.
  if (config.tableHeaders !== false) info.tableHeaders = tableHeaders(tree, (el) => note(el, 'first row → header row'));

  // 5. Neighbouring lists of the same type become one.
  if (config.mergeLists !== false) mergeLists(tree);

  // 5b. Every paragraph numbered, in one running sequence.
  let firstNumbered: Element | undefined;
  if (config.numberParagraphs) {
    const numbered = numberParagraphs(tree, (el, wasParagraph) => note(el, wasParagraph ? 'paragraph → numbered list item' : 'list item → numbered, in the running sequence'));
    info.numbered = numbered.count;
    firstNumbered = numbered.first;
  }

  // 6. Labels for review.
  const label = (el: Element, text: string) => {
    const id = newId('c');
    // No date: the result must be the same each time it runs (the editor's import gives it one).
    comments[id] = { id, author: author.name, utc: true, html: `<p>House style: ${escapeHtml(text)}.</p>`, resolved: false };
    wrapForComment(el, id);
    info.labels++;
  };
  info.changed = notes.size;
  if (labelMode === 'paragraph') {
    for (const [el, list] of notes) if (el.children.length) label(el, [...new Set(list)].join('; '));
  } else if (labelMode === 'rule') {
    for (const r of ruleFirst.values()) label(r.el, `${r.label} → ${TARGET_LABELS[r.target].toLowerCase()}${r.count > 1 ? ` (here and in ${r.count - 1} more)` : ''}`);
    if (firstNumbered) label(firstNumbered, `all ${info.numbered} paragraphs and list items are numbered, in one running sequence (headings, tables and quotes are not)`);
  }

  // 7. The Word data is no longer needed.
  clearDocxData(tree);

  const base: ReviewInfo = review ?? { authors: [], revisions: {}, comments: {} };
  const used = Object.keys(revisions).length + Object.keys(comments).length > 0;
  const nextReview: ReviewInfo = {
    authors: used && !base.authors.includes(author.name) ? [...base.authors, author.name] : base.authors,
    revisions: { ...Object.fromEntries(Object.entries(base.revisions).filter(([id]) => !settled.has(id))), ...revisions },
    comments: { ...base.comments, ...comments },
    users: { ...(used ? { [author.name]: { id: author.id, name: author.name } } : {}), ...base.users },
  };
  const out: CmsDocument = { ...doc, tree, meta: { ...doc.meta, review: nextReview } };
  out.meta.review = presentReview(out);
  if (out.meta.review && !Object.keys(out.meta.review.users ?? {}).length) delete out.meta.review.users;
  if (!review && !used) delete out.meta.review;
  return { document: out, warnings, info };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Formats (b, i, u, strike, sub, sup) that cover the whole of an element's content: a chain of single wrappers. */
function wholeFormats(el: Element): string[] {
  const out: string[] = [];
  let n: Element = el;
  for (;;) {
    const kids = n.children.filter((c) => !(c.type === 'text' && c.value === ''));
    if (kids.length !== 1 || kids[0].type !== 'element') break;
    n = kids[0];
    const fmt = { strong: 'b', b: 'b', em: 'i', i: 'i', u: 'u', s: 'strike', sub: 'sub', sup: 'sup' }[n.tagName];
    if (fmt) out.push(fmt);
  }
  return out;
}

/** "1. " typed at the start of a paragraph becomes a tracked deletion. Returns whether there was one. */
function markTypedNumber(el: Element, newId: () => string, add: (id: string, text: string) => void): boolean {
  const first = firstText(el);
  if (!first) return false;
  const m = TYPED_NUMBER.exec(first.node.value);
  if (!m) return false;
  const id = newId();
  add(id, m[0]);
  const del: Element = { type: 'element', tagName: 'del', properties: { dataRev: id }, children: [{ type: 'text', value: m[0] }] };
  const rest: Text = { type: 'text', value: first.node.value.slice(m[0].length) };
  first.parent.children.splice(first.parent.children.indexOf(first.node), 1, del, ...(rest.value ? [rest] : []));
  return true;
}

function firstText(el: Element): { node: Text; parent: Element } | undefined {
  for (const c of el.children) {
    if (c.type === 'text' && c.value.trim()) return { node: c, parent: el };
    if (c.type === 'element' && c.tagName !== 'del') {
      const found = firstText(c);
      if (found) return found;
    }
  }
  return undefined;
}

/** Elements become `itemTag`s inside lists; neighbours with the same list tag share one list. */
function wrapInto(tree: Root, els: Element[], tagOf: (el: Element) => 'ul' | 'ol', itemTag: string) {
  if (!els.length) return;
  const set = new Set(els);
  const walk = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type === 'element' && set.has(c)) {
        const tag = tagOf(c);
        c.tagName = itemTag;
        const last = out[out.length - 1];
        if (last?.type === 'element' && last.tagName === tag && last.properties.dataFromParagraphs !== undefined) last.children.push(c);
        else out.push({ type: 'element', tagName: tag, properties: { dataFromParagraphs: '' }, children: [c] });
        continue;
      }
      if (c.type === 'element') walk(c);
      out.push(c);
    }
    (parent as Element).children = out;
  };
  walk(tree);
}

/** Paragraphs marked as quotes go into <blockquote>s, neighbours together. */
function wrapQuotes(tree: Root) {
  const walk = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type === 'element' && c.properties.dataQuote !== undefined) {
        delete c.properties.dataQuote;
        const last = out[out.length - 1];
        if (last?.type === 'element' && last.tagName === 'blockquote') last.children.push(c);
        else out.push({ type: 'element', tagName: 'blockquote', properties: {}, children: [c] });
        continue;
      }
      if (c.type === 'element') walk(c);
      out.push(c);
    }
    (parent as Element).children = out;
  };
  walk(tree);
}

/** Lists of the same type next to each other become one. */
function mergeLists(parent: Root | Element) {
  const out: ElementContent[] = [];
  for (const c of parent.children as ElementContent[]) {
    if (c.type === 'element') mergeLists(c);
    const last = out[out.length - 1];
    if (c.type === 'element' && (c.tagName === 'ul' || c.tagName === 'ol') && last?.type === 'element' && last.tagName === c.tagName) {
      last.children.push(...c.children);
      continue;
    }
    out.push(c);
  }
  (parent as Element).children = out;
}

/**
 * Top-level paragraphs and lists become numbered lists, counted through the whole document: each list after a heading,
 * table or quote starts where the last one stopped. Nested lists keep their own numbering.
 */
function numberParagraphs(tree: Root, noted: (el: Element, wasParagraph: boolean) => void): { count: number; first?: Element } {
  let count = 0;
  let first: Element | undefined;
  const out: ElementContent[] = [];
  let current: Element | undefined;
  const add = (item: Element) => {
    if (!current) {
      current = { type: 'element', tagName: 'ol', properties: count ? { start: count + 1 } : {}, children: [] };
      out.push(current);
    }
    current.children.push(item);
    count++;
    first ??= item;
  };
  for (const c of tree.children as ElementContent[]) {
    if (c.type !== 'element') {
      if (!(c.type === 'text' && !c.value.trim())) out.push(c);
      continue;
    }
    if (c.tagName === 'p' && textOf(c).trim()) {
      c.tagName = 'li';
      noted(c, true);
      add(c);
    } else if (c.tagName === 'ul' || c.tagName === 'ol') {
      for (const li of c.children) {
        if (li.type !== 'element') continue;
        if (c.tagName === 'ul') noted(li, false);
        add(li);
      }
    } else {
      current = undefined;
      out.push(c);
    }
  }
  tree.children = out as Root['children'];
  return { count, first };
}

function tableHeaders(tree: Root, noted: (el: Element) => void): number {
  let count = 0;
  const walk = (n: Root | Element) => {
    for (const c of n.children) {
      if (c.type !== 'element') continue;
      if (c.tagName === 'table') {
        const tbody = c.children.find((k): k is Element => k.type === 'element' && k.tagName === 'tbody');
        const first = tbody?.children.find((k): k is Element => k.type === 'element' && k.tagName === 'tr');
        if (tbody && first && !c.children.some((k) => k.type === 'element' && k.tagName === 'thead')) {
          const cells = first.children.filter((k): k is Element => k.type === 'element');
          const bold = cells.length > 0 && cells.every((td) => {
            const paras = td.children.filter((k): k is Element => k.type === 'element');
            return textOf(td).trim() === '' || paras.every((p) => /(^| )b( |$)/.test(String(p.properties.dataDocxFmt ?? '')) || isAllBold(p));
          });
          if (bold || first.properties.dataDocxHeader !== undefined) {
            for (const td of cells) {
              td.tagName = 'th';
              unwrapTags(td, new Set(['strong', 'b']));
            }
            tbody.children.splice(tbody.children.indexOf(first), 1);
            c.children.unshift({ type: 'element', tagName: 'thead', properties: {}, children: [first] });
            if (cells[0]) noted(cells[0].children.find((k): k is Element => k.type === 'element') ?? cells[0]);
            count++;
          }
        }
      }
      walk(c);
    }
  };
  walk(tree);
  return count;
}

function isAllBold(el: Element): boolean {
  const kids = el.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
  return kids.length > 0 && kids.every((c) => c.type === 'element' && (c.tagName === 'strong' || c.tagName === 'b' || isAllBold(c)));
}

function unwrapTags(el: Element, tags: Set<string>) {
  el.children = el.children.flatMap((c) => {
    if (c.type !== 'element') return [c];
    unwrapTags(c, tags);
    return tags.has(c.tagName) ? c.children : [c];
  });
}

/** The block's inline content goes into a span marked with the comment (nested blocks keep their own). */
function wrapForComment(el: Element, id: string) {
  const isBlockChild = (c: ElementContent) => c.type === 'element' && /^(p|h[1-6]|ul|ol|li|table|blockquote|div)$/.test(c.tagName);
  const out: ElementContent[] = [];
  let run: ElementContent[] = [];
  const flush = () => {
    if (run.some((c) => textOf(c).trim() || c.type === 'element')) out.push({ type: 'element', tagName: 'span', properties: { dataComments: id }, children: run });
    else out.push(...run);
    run = [];
  };
  let wrapped = false;
  for (const c of el.children) {
    if (isBlockChild(c)) {
      if (!wrapped) flush();
      else out.push(...run.splice(0));
      wrapped ||= out.some((o) => o.type === 'element' && o.properties.dataComments === id);
      if (!wrapped && c.type === 'element') {
        // A table cell's first paragraph, a list's first item: the comment goes there.
        wrapForComment(c, id);
        wrapped = true;
      }
      out.push(c);
    } else run.push(c);
  }
  if (!wrapped) flush();
  else out.push(...run);
  el.children = out;
}

function clearDocxData(n: Root | Element) {
  for (const c of n.children) {
    if (c.type !== 'element') continue;
    for (const key of Object.keys(c.properties)) if (key.startsWith('dataDocx') || key === 'dataFromParagraphs') delete c.properties[key];
    clearDocxData(c);
  }
}
