// CKEditor 5 output (real-time collaboration through CKEditor Cloud Services): the content with suggestion and
// comment markers, the suggestions, the comment threads and the users, and the body of the Cloud Services REST API
// request that imports a document with them (POST /documents).
//
// What is certain and what is not (CKEditor's documentation could not be read while this was written):
// - Certain, from the 47.x type definitions: suggestion types (insertion, deletion, formatInline, formatBlock,
//   attribute), and a suggestion's fields (id, type, authorId, createdAt, hasComments, data, attributes).
// - From the documentation, as quoted in search results: inline suggestions are `<suggestion-start>` /
//   `<suggestion-end>` tags and comments `<comment-start>` / `<comment-end>` tags (attributes on elements when a
//   range starts or ends at an element boundary).
// - NOT verified, kept in one place (`CK_FORMAT` below) so it can be corrected against a reference export
//   (GET /documents/{id} of a test document from your environment): the `name` attribute of the markers and the field
//   names of the import request body. Formatting suggestions (formatInline / formatBlock) store the editor command
//   to run when accepted; their exact data is version-specific, so changes of formatting are not made suggestions
//   here: they are kept as they are now, with a comment that says what Word recorded.
import type { Element, ElementContent, Root } from 'hast';
import { serialize } from './document';
import { kindOf } from './changes';
import type { CmsDocument, ReviewComment, ReviewInfo, Revision } from './types';

/** The parts of the format not verified against CKEditor's documentation (see the comment at the top). */
export const CK_FORMAT = {
  suggestionName: (type: string, id: string, userId: string) => `${type}:${id}:${userId}`,
  commentName: (threadId: string) => threadId,
  /** Comment `type` in the import body: 1 a comment, 2 a comment on a suggestion. */
  commentType: 1,
};

/** Editor features: which elements the content may use. "basic": paragraphs, headings, bold, italic, links, lists, quotes, tables. */
export interface CkeditorOptions {
  /** The document id in Cloud Services (the editor's `collaboration.channelId`). */
  documentId?: string;
  /** The editor bundle version uploaded to Cloud Services. */
  bundleVersion?: string;
  /** Heading elements the editor has (its heading options). Default h2, h3, h4. */
  headings?: string[];
  /** Extra elements the editor's features allow beyond the basic set, e.g. "u", "s", "img", "sub", "sup". */
  extraElements?: string[];
  /** The editor has the list properties feature (a numbered list can start at any number: `<ol start>`). */
  listProperties?: boolean;
  /** For comments and suggestions without a date (the house style's labels): this date (ISO). Default: now. */
  now?: string;
}

export interface CkUser { id: string; name: string }
export interface CkSuggestion {
  id: string;
  type: 'insertion' | 'deletion';
  authorId: string;
  createdAt: string;
  hasComments: boolean;
  data: null;
  attributes: Record<string, unknown>;
}
export interface CkComment { commentId: string; authorId: string; content: string; createdAt: string; attributes: Record<string, unknown> }
export interface CkThread { threadId: string; comments: CkComment[]; resolvedAt?: string; resolvedBy?: string }

export interface CkeditorResult {
  /** The editor data: the content with suggestion and comment markers. */
  data: string;
  suggestions: CkSuggestion[];
  commentThreads: CkThread[];
  users: CkUser[];
  /** The Cloud Services import request body (POST /documents). */
  importBody: Record<string, unknown>;
  warnings: string[];
  info: { suggestions: number; threads: number; comments: number; noted: number };
}

const BASIC = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure'];
const MARKERS = new Set(['suggestion-start', 'suggestion-end', 'comment-start', 'comment-end']);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (n: ElementContent): string => (n.type === 'text' ? n.value : n.type === 'element' ? n.children.map(textOf).join('') : '');
const idsOf = (value: unknown) => (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
const marker = (tagName: string, name: string): Element => ({ type: 'element', tagName, properties: { name }, children: [] });
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

/** The document as CKEditor 5 collaboration data. Never changes `doc`. */
export function toCkeditor(doc: CmsDocument, options: CkeditorOptions = {}): CkeditorResult {
  const warnings: string[] = [];
  const review: ReviewInfo = doc.meta.review ?? { authors: [], revisions: {}, comments: {} };
  const now = options.now ?? new Date().toISOString();
  const tree = structuredClone(doc.tree);

  // Users: as the Changes / Formatting nodes said, or made from the name (with a warning).
  const users = new Map<string, CkUser>();
  const userFor = (author: string): string => {
    const known = review.users?.[author];
    const id = known?.id ?? slug(author);
    if (!users.has(author)) {
      users.set(author, { id, name: known?.name ?? author });
      if (!known) warnings.push(`“${author || 'no name'}” has no user id in the editor; “${id}” is used. Set it in the Changes node`);
    }
    return id;
  };
  const dateOf = (x: { date?: string; utc: boolean }) => (x.date && x.utc ? new Date(x.date).toISOString() : x.date ? new Date(`${x.date}Z`).toISOString() : now);

  // 1. Changes CKEditor cannot take as suggestions here: kept as they are, with a comment by their author.
  const noted: { el: Element; r: Revision }[] = [];
  const noteIds = new Map<string, string>();
  const extraComments: ReviewComment[] = [];
  const noteChange = (el: Element, r: Revision) => {
    const what =
      kindOf(r) === 'format' ? `changed the formatting here (it was: ${r.before ?? 'different'})`
      : kindOf(r) === 'paragraph' ? `changed the formatting of the paragraphs here (they were: ${r.before ?? 'different'})`
      : kindOf(r) === 'row' ? (r.type === 'insertion' ? 'inserted this table row' : 'deleted this table row')
      : r.type === 'insertion' ? 'split this paragraph here' : 'joined this paragraph with the next one';
    // Changes made together (same kind, author, minute and "before", e.g. one list changed in Word) share one note,
    // whose range runs from the first of them to the last.
    const group = [kindOf(r), r.author, r.date?.slice(0, 16), r.before].join('|');
    const shared = noteIds.get(group);
    if (shared) {
      el.properties.dataComments = [...idsOf(el.properties.dataComments), shared].join(' ');
      noted.push({ el, r });
      return;
    }
    const id = `${r.id}-note`;
    noteIds.set(group, id);
    extraComments.push({ id, author: r.author, date: r.date, utc: r.utc, html: `<p>Tracked change in Word: ${escapeHtml(r.author || 'someone')} ${escapeHtml(what)}. It is shown as it is now; accept it, or change it back here.</p>`, resolved: false });
    el.properties.dataComments = [...idsOf(el.properties.dataComments), id].join(' ');
    noted.push({ el, r });
  };
  const visitChanges = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      visitChanges(c);
      for (const key of ['dataRevBlock', 'dataRevMark'] as const) {
        const id = c.properties[key];
        delete c.properties[key];
        const r = typeof id === 'string' ? review.revisions[id] : undefined;
        if (r) {
          // The comment goes on the block's content (a span), so its range is the block's text.
          const span: Element = { type: 'element', tagName: 'span', properties: {}, children: c.children };
          noteChange(span, r);
          c.children = [span];
        }
      }
      const id = typeof c.properties.dataRev === 'string' ? c.properties.dataRev : undefined;
      const r = id ? review.revisions[id] : undefined;
      if (r && kindOf(r) === 'format') {
        const span: Element = { type: 'element', tagName: 'span', properties: {}, children: c.children };
        noteChange(span, r);
        out.push(span);
        continue;
      }
      out.push(c);
    }
    (parent as Element).children = out;
  };
  visitChanges(tree);

  // 2. Insertions and deletions: suggestion markers around each piece.
  const suggestions: CkSuggestion[] = [];
  const pieces = new Map<string, number>();
  const visitSuggestions = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      visitSuggestions(c);
      const id = typeof c.properties.dataRev === 'string' ? c.properties.dataRev : undefined;
      const r = id ? review.revisions[id] : undefined;
      if (r && (c.tagName === 'ins' || c.tagName === 'del')) {
        const type = kindOf(r) === 'insertion' ? 'insertion' : 'deletion';
        const n = (pieces.get(r.id) ?? 0) + 1;
        pieces.set(r.id, n);
        const sid = n === 1 ? r.id : `${r.id}-${n}`;
        const userId = userFor(r.author);
        suggestions.push({ id: sid, type, authorId: userId, createdAt: dateOf(r), hasComments: false, data: null, attributes: {} });
        const name = CK_FORMAT.suggestionName(type, sid, userId);
        out.push(marker('suggestion-start', name), ...c.children, marker('suggestion-end', name));
        continue;
      }
      if (id) delete c.properties.dataRev;
      out.push(c);
    }
    (parent as Element).children = out;
  };
  visitSuggestions(tree);

  // 3. Comments: a start marker before the first piece of a thread's range, an end marker after the last.
  const allComments: Record<string, ReviewComment> = { ...review.comments, ...Object.fromEntries(extraComments.map((c) => [c.id, c])) };
  const threadOf = (id: string) => allComments[id]?.parentId ?? id;
  const order: string[] = [];
  const last = new Map<string, Element>();
  const first = new Map<string, Element>();
  const scan = (n: Root | ElementContent) => {
    if (n.type === 'element') {
      for (const id of idsOf(n.properties.dataComments)) {
        const t = threadOf(id);
        if (!first.has(t)) {
          first.set(t, n);
          order.push(t);
        }
        last.set(t, n);
      }
    }
    if ('children' in n) n.children.forEach((c) => scan(c as ElementContent));
  };
  scan(tree);
  const unwrapComments = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      unwrapComments(c);
      const ids = idsOf(c.properties.dataComments).map(threadOf);
      if (!ids.length) {
        out.push(c);
        continue;
      }
      delete c.properties.dataComments;
      const starts = [...new Set(ids)].filter((t) => first.get(t) === c).map((t) => marker('comment-start', CK_FORMAT.commentName(t)));
      const ends = [...new Set(ids)].filter((t) => last.get(t) === c).map((t) => marker('comment-end', CK_FORMAT.commentName(t)));
      const plainSpan = c.tagName === 'span' && Object.keys(c.properties).length === 0;
      out.push(...starts, ...(plainSpan ? c.children : [c]), ...ends.reverse());
    }
    (parent as Element).children = out;
  };
  unwrapComments(tree);
  const commentThreads: CkThread[] = order.map((threadId) => {
    const all = Object.values(allComments).filter((c) => threadOf(c.id) === threadId);
    const head = allComments[threadId];
    const thread: CkThread = {
      threadId,
      comments: all.map((c) => ({ commentId: c.id, authorId: userFor(c.author), content: c.html, createdAt: dateOf(c), attributes: {} })),
    };
    if (head?.resolved) {
      thread.resolvedAt = dateOf(head);
      thread.resolvedBy = userFor(head.author);
    }
    return thread;
  });

  // 4. Tables in CKEditor's own wrapper; what the editor's features do not allow is reported.
  const allowed = new Set([...BASIC, ...(options.headings ?? ['h2', 'h3', 'h4']), ...(options.extraElements ?? [])]);
  const notAllowed = new Map<string, number>();
  let startedLists = 0;
  const tidy = (parent: Root | Element) => {
    const out: ElementContent[] = [];
    for (const c of parent.children as ElementContent[]) {
      if (c.type === 'comment') continue;
      if (c.type !== 'element') {
        out.push(c);
        continue;
      }
      tidy(c);
      if (MARKERS.has(c.tagName)) {
        out.push(c);
        continue;
      }
      for (const key of Object.keys(c.properties)) if (key.startsWith('data') || key === 'style' || (key === 'className' && c.tagName !== 'figure')) delete c.properties[key];
      if (c.tagName === 'span' && !Object.keys(c.properties).length) {
        out.push(...c.children);
        continue;
      }
      if (!allowed.has(c.tagName)) notAllowed.set(c.tagName, (notAllowed.get(c.tagName) ?? 0) + 1);
      if (c.tagName === 'ol' && c.properties.start !== undefined && !options.listProperties) startedLists++;
      if (c.tagName === 'table' && !(parent.type === 'element' && parent.tagName === 'figure')) {
        out.push({ type: 'element', tagName: 'figure', properties: { className: ['table'] }, children: [c] });
        continue;
      }
      out.push(c);
    }
    (parent as Element).children = out;
  };
  tidy(tree);
  for (const [tag, n] of notAllowed) {
    warnings.push(`<${tag}> (${n}×) is not one of the editor's features (headings ${[...(options.headings ?? ['h2', 'h3', 'h4'])].join(', ')}): the editor will drop it and keep its text. Change it in the Formatting node, or add the feature`);
  }

  if (startedLists) {
    warnings.push(`${startedLists} numbered list${startedLists === 1 ? ' continues' : 's continue'} the numbers of the one before (<ol start>): without the editor's list properties feature they start at 1 again. Turn on “The editor has list properties” if it has`);
  }
  const data = serialize({ ...doc, tree });
  const documentId = options.documentId?.trim() || slug(doc.meta.fileName?.replace(/\.[^.]+$/, '') ?? 'document');
  if (!options.documentId?.trim()) warnings.push(`No document id given: “${documentId}” is used (it must be new in Cloud Services)`);
  const importBody = {
    id: documentId,
    content: { data, ...(options.bundleVersion?.trim() && { bundle_version: options.bundleVersion.trim() }) },
    suggestions: suggestions.map((s) => ({
      id: s.id, document_id: documentId, type: s.type, created_at: s.createdAt, user: { id: s.authorId }, data: s.data, attributes: s.attributes, has_comments: s.hasComments,
    })),
    comments: commentThreads.flatMap((t) =>
      t.comments.map((c) => ({
        id: c.commentId, document_id: documentId, thread_id: t.threadId, content: c.content, created_at: c.createdAt, user: { id: c.authorId }, attributes: c.attributes, type: CK_FORMAT.commentType,
      })),
    ),
  };
  if (!options.bundleVersion?.trim()) warnings.push('No editor bundle version given: the import needs the version of the editor bundle uploaded to Cloud Services');
  if (commentThreads.some((t) => t.resolvedAt)) warnings.push('Resolved threads are imported as open threads (the import body has no field for it here)');
  return {
    data,
    suggestions,
    commentThreads,
    users: [...users.values()],
    importBody,
    warnings,
    info: { suggestions: suggestions.length, threads: commentThreads.length, comments: commentThreads.reduce((n, t) => n + t.comments.length, 0), noted: noted.length },
  };
}
