// Deciding about tracked changes and comments (the Changes node): keep a change as a suggestion, accept it or
// reject it; keep or drop comment threads; say who each author is in the editor the content goes to; and give
// dates without a time zone one. See `ReviewInfo` in types.ts for the markup.
import type { Element, ElementContent, Root } from 'hast';
import { presentReview } from './review';
import type { CmsDocument, ReviewInfo, Revision } from './types';

export type ChangeDecision = 'keep' | 'accept' | 'reject';

/** What a change is, for the rules: text in or out, formatting, a paragraph's formatting, a table row, a paragraph mark. */
export type ChangeKind = 'insertion' | 'deletion' | 'format' | 'paragraph' | 'row' | 'mark';

export interface ChangesConfig {
  /** For each kind of change: keep (default), accept or reject. */
  defaults?: Partial<Record<ChangeKind, ChangeDecision>>;
  /** For each author (by the name in the file); wins over `defaults`. */
  byAuthor?: Record<string, ChangeDecision>;
  /** For one change (or a group: every id of it); wins over everything. */
  decisions?: Record<string, ChangeDecision>;
  /** Comment threads to drop (by the thread's first comment id). */
  dropComments?: string[];
  /** Drop threads marked resolved in Word. */
  dropResolved?: boolean;
  /** Who each author is in the editor (user id and name), by the name in the file. */
  users?: Record<string, { id: string; name?: string }>;
  /** For dates the file gives without a time zone: the offset, e.g. "+08:00" (default: treated as UTC). */
  timezone?: string;
}

export const kindOf = (r: Revision): ChangeKind =>
  r.row ? 'row' : r.mark ? 'mark' : r.type === 'insertion' || r.type === 'move-to' ? 'insertion' : r.type === 'deletion' || r.type === 'move-from' ? 'deletion' : r.type === 'format' ? 'format' : 'paragraph';

export const KIND_LABELS: Record<ChangeKind, string> = {
  insertion: 'Inserted text',
  deletion: 'Deleted text',
  format: 'Formatting',
  paragraph: 'Paragraph formatting',
  row: 'Table rows',
  mark: 'Paragraphs split or joined',
};

/** The decision for one change: its own, then its author's, then its kind's, then keep. */
export function decisionFor(config: ChangesConfig, r: Revision): ChangeDecision {
  return config.decisions?.[r.id] ?? config.byAuthor?.[r.author] ?? config.defaults?.[kindOf(r)] ?? 'keep';
}

/** One row of the Changes list: changes made together (same kind, author, minute and "before") are one group. */
export interface ChangeGroup {
  ids: string[];
  kind: ChangeKind;
  type: Revision['type'];
  author: string;
  date?: string;
  utc: boolean;
  before?: string;
  /** The text it covers (the first 80 characters of the group's text). */
  text: string;
}

const textOf = (n: ElementContent | Root): string => (n.type === 'text' ? n.value : 'children' in n ? n.children.map((c) => textOf(c as ElementContent)).join('') : '');

function elementsWith(tree: Root, test: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const walk = (n: Root | ElementContent) => {
    if (n.type === 'element' && test(n)) out.push(n);
    if ('children' in n) n.children.forEach((c) => walk(c as ElementContent));
  };
  walk(tree);
  return out;
}

const idsOf = (value: unknown) => (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
const revOf = (el: Element) => [...idsOf(el.properties.dataRev), ...idsOf(el.properties.dataRevBlock), ...idsOf(el.properties.dataRevMark)];

/** The visible changes of a document, grouped for people (hidden ones are left out), in document order. */
export function changeGroups(doc: CmsDocument): ChangeGroup[] {
  const review = doc.meta.review;
  if (!review) return [];
  const text = new Map<string, string>();
  for (const el of elementsWith(doc.tree, (e) => revOf(e).length > 0)) {
    for (const id of revOf(el)) text.set(id, (text.get(id) ?? '') + (text.has(id) ? ' ' : '') + textOf(el));
  }
  const groups: ChangeGroup[] = [];
  for (const id of text.keys()) {
    const r = review.revisions[id];
    if (!r || r.hidden) continue;
    const kind = kindOf(r);
    const minute = r.date?.slice(0, 16);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind && last.author === r.author && last.date?.slice(0, 16) === minute && last.before === r.before && kind !== 'insertion' && kind !== 'deletion') {
      last.ids.push(id);
      last.text = `${last.text} · ${text.get(id)}`;
    } else {
      groups.push({ ids: [id], kind, type: r.type, author: r.author, date: r.date, utc: r.utc, before: r.before, text: text.get(id) ?? '' });
    }
  }
  for (const g of groups) if (g.text.length > 80) g.text = `${g.text.slice(0, 79)}…`;
  return groups;
}

/** Comment threads (first comment and replies), in document order of where they are. */
export function commentThreads(doc: CmsDocument): { id: string; comments: ReviewInfo['comments'][string][]; text: string }[] {
  const review = doc.meta.review;
  if (!review) return [];
  const text = new Map<string, string>();
  for (const el of elementsWith(doc.tree, (e) => typeof e.properties.dataComments === 'string')) {
    for (const id of idsOf(el.properties.dataComments)) text.set(id, (text.get(id) ?? '') + textOf(el));
  }
  return [...text.keys()]
    .filter((id) => review.comments[id] && !review.comments[id].parentId)
    .map((id) => ({
      id,
      comments: [review.comments[id], ...Object.values(review.comments).filter((c) => c.parentId === id)],
      text: (text.get(id) ?? '').slice(0, 80),
    }));
}

/** A local date without a time zone, read in `timezone` ("+08:00"), as UTC. */
export function toUtc(date: string, timezone: string): string | undefined {
  const m = /^([+-])(\d\d):?(\d\d)$/.exec(timezone.trim());
  if (!m) return undefined;
  const t = Date.parse(`${date.replace(/Z$/, '')}${m[1]}${m[2]}:${m[3]}`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export interface ChangesResult {
  document: CmsDocument;
  warnings: string[];
  counts: { kept: number; accepted: number; rejected: number; hidden: number; threadsKept: number; threadsDropped: number };
}

/** Apply the decisions to a copy of `doc`. Never changes `doc`. */
export function applyChanges(doc: CmsDocument, config: ChangesConfig): ChangesResult {
  const warnings: string[] = [];
  const review = doc.meta.review;
  const counts = { kept: 0, accepted: 0, rejected: 0, hidden: 0, threadsKept: 0, threadsDropped: 0 };
  if (!review) {
    return { document: doc, warnings: ['This document has no tracked changes or comments (read a Word file in review mode)'], counts };
  }
  const tree = structuredClone(doc.tree);
  const decided = new Map<string, ChangeDecision>();
  for (const r of Object.values(review.revisions)) {
    // Hidden changes (table properties, a paragraph mark's formatting) show nowhere: they are accepted.
    if (r.hidden) {
      counts.hidden++;
      continue;
    }
    decided.set(r.id, decisionFor(config, r));
  }
  const decision = (id: string) => decided.get(id) ?? 'keep';

  // Inline changes: <ins>, <del>, <span data-rev>.
  const inline = (children: ElementContent[]): ElementContent[] =>
    children.flatMap((c): ElementContent[] => {
      if (c.type !== 'element') return [c];
      c.children = inline(c.children);
      const id = typeof c.properties.dataRev === 'string' ? c.properties.dataRev : undefined;
      const r = id ? review.revisions[id] : undefined;
      if (!id || !r) return [c];
      const d = decision(id);
      if (d === 'keep') return [c];
      const kind = kindOf(r);
      if (kind === 'insertion') return d === 'accept' ? c.children : [];
      if (kind === 'deletion') return d === 'accept' ? [] : c.children;
      // Formatting: accepted, the text keeps its new look; rejected, it gets its old one back.
      return d === 'accept' ? c.children : restoreFormat(c.children, r.beforeProps ?? {});
    });

  // Block changes: paragraph formatting, table rows, paragraph marks.
  const blocks = (parent: Root | Element) => {
    const kids = parent.children as ElementContent[];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.type !== 'element') continue;
      blocks(c);
      for (const key of ['dataRevBlock', 'dataRevMark'] as const) {
        const id = c.properties[key];
        if (typeof id !== 'string') continue;
        const r = review.revisions[id];
        const d = decision(id);
        if (!r || d === 'keep') continue;
        delete c.properties[key];
        const kind = kindOf(r);
        if (kind === 'row') {
          // An inserted row rejected, or a deleted row accepted, goes.
          if ((r.type === 'insertion') === (d === 'reject')) {
            kids.splice(i, 1);
            i--;
          }
        } else if (kind === 'mark') {
          // A deleted paragraph mark accepted (or an inserted one rejected) joins this paragraph with the next.
          if ((r.type === 'deletion') === (d === 'accept')) {
            const next = kids.slice(i + 1).find((k) => k.type === 'element');
            if (next?.type === 'element' && /^(p|h[1-6]|li)$/.test(next.tagName)) {
              c.children.push(...next.children);
              kids.splice(kids.indexOf(next), 1);
            } else warnings.push('A joined paragraph has no paragraph after it to join; it was left as it is');
          }
        } else if (d === 'reject') {
          const problem = restoreParagraph(c, parent, r);
          if (problem) warnings.push(problem);
        }
      }
    }
  };

  tree.children = inline(tree.children as ElementContent[]) as Root['children'];
  blocks(tree);
  for (const d of decided.values()) counts[d === 'keep' ? 'kept' : d === 'accept' ? 'accepted' : 'rejected']++;

  // Comments: drop threads (their ranges go; the text stays).
  const threadOf = (id: string) => review.comments[id]?.parentId ?? id;
  const dropped = new Set<string>([...(config.dropComments ?? [])]);
  if (config.dropResolved) for (const c of Object.values(review.comments)) if (c.resolved) dropped.add(threadOf(c.id));
  const comments = (children: ElementContent[]): ElementContent[] =>
    children.flatMap((c): ElementContent[] => {
      if (c.type !== 'element') return [c];
      c.children = comments(c.children);
      if (typeof c.properties.dataComments !== 'string') return [c];
      const kept = idsOf(c.properties.dataComments).filter((id) => !dropped.has(threadOf(id)));
      if (kept.length) {
        c.properties.dataComments = kept.join(' ');
        return [c];
      }
      return c.children;
    });
  tree.children = comments(tree.children as ElementContent[]) as Root['children'];

  // Who the authors are, and dates in UTC.
  const fix = <T extends { date?: string; utc: boolean }>(x: T): T => {
    if (x.utc || !x.date) return x;
    const utc = config.timezone ? toUtc(x.date, config.timezone) : undefined;
    return utc ? { ...x, date: utc, utc: true } : x;
  };
  const out: CmsDocument = {
    ...doc,
    tree,
    meta: {
      ...doc.meta,
      review: {
        ...review,
        revisions: Object.fromEntries(Object.entries(review.revisions).filter(([, r]) => !r.hidden).map(([id, r]) => [id, fix(r)])),
        comments: Object.fromEntries(Object.entries(review.comments).map(([id, c]) => [id, fix(c)])),
        ...(config.users && { users: { ...review.users, ...config.users } }),
      },
    },
  };
  const present = presentReview(out)!;
  out.meta.review = present;
  const threads = new Set(Object.values(review.comments).map((c) => threadOf(c.id)));
  counts.threadsKept = new Set(Object.values(present.comments).map((c) => threadOf(c.id))).size;
  counts.threadsDropped = [...threads].filter((t) => dropped.has(t)).length;
  if (!config.timezone && [...Object.values(present.revisions), ...Object.values(present.comments)].some((x) => x.date && !x.utc)) {
    warnings.push('Some dates have no time zone in the file; they are read as UTC. Set the time zone the file was written in');
  }
  return { document: out, warnings, counts };
}

/** The text with its old formatting: the formatting elements inside go, the old ones go around it. */
function restoreFormat(children: ElementContent[], before: Record<string, string>): ElementContent[] {
  const strip = (nodes: ElementContent[]): ElementContent[] =>
    nodes.flatMap((n): ElementContent[] => {
      if (n.type !== 'element') return [n];
      n.children = strip(n.children);
      return ['strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub'].includes(n.tagName) || (n.tagName === 'span' && n.properties.dataDocxRun !== undefined) ? n.children : [n];
    });
  let out = strip(children);
  const wrapIn = (tagName: string, properties: Element['properties'] = {}) => {
    out = [{ type: 'element', tagName, properties, children: out }];
  };
  if (before.sup) wrapIn('sup');
  if (before.sub) wrapIn('sub');
  if (before.strike) wrapIn('s');
  if (before.u) wrapIn('u');
  if (before.i) wrapIn('em');
  if (before.b) wrapIn('strong');
  const rest = Object.entries(before)
    .filter(([k]) => !['b', 'i', 'u', 'strike', 'sup', 'sub'].includes(k))
    .map(([k, v]) => (v === 'on' ? k : `${k}=${v}`))
    .join(' ');
  if (rest) wrapIn('span', { dataDocxRun: rest });
  return out;
}

/** A paragraph change rejected: the old style (heading or paragraph) and list type. Returns a warning when it cannot. */
function restoreParagraph(el: Element, parent: Root | Element, r: Revision): string | undefined {
  const before = r.beforeProps ?? {};
  const level = /^heading ([1-6])$/i.exec(before.style ?? '')?.[1] ?? (/^title$/i.test(before.style ?? '') ? '1' : undefined);
  if (el.tagName === 'li') {
    if (before.list === 'none') return `A list item's old formatting (${r.before}) cannot be restored here, so its change is kept as accepted`;
    const want = before.list === 'number' ? 'ol' : 'ul';
    // The whole list changes type when all its items had this kind of change.
    if (parent.type === 'element' && parent.tagName !== want) parent.tagName = want;
  } else if (before.list && before.list !== 'none') {
    return `A paragraph that was a list item (${r.before}) cannot be made one again here, so its change is kept as accepted`;
  } else if (/^(p|h[1-6])$/.test(el.tagName)) {
    el.tagName = level ? `h${level}` : 'p';
  }
  if (before.style) el.properties.dataDocxStyle = before.style;
  return undefined;
}
