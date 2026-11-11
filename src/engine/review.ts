// Tracked changes and comments travelling with a document (see `ReviewInfo` in types.ts for the markup).
// Nodes copy and combine content; these helpers keep the review information that goes with it.
import type { Element, Nodes, Root } from 'hast';
import type { CmsDocument, ReviewInfo } from './types';

/** The two merged (ids are unique per source file, so entries never clash); undefined when both are. */
export function mergeReview(a: ReviewInfo | undefined, b: ReviewInfo | undefined): ReviewInfo | undefined {
  if (!a || !b) return a ?? b;
  if (a === b) return a;
  return {
    authors: [...new Set([...a.authors, ...b.authors])],
    revisions: { ...a.revisions, ...b.revisions },
    comments: { ...a.comments, ...b.comments },
    ...((a.users || b.users) && { users: { ...b.users, ...a.users } }),
  };
}

/** Add `review` to a document's own (the document's meta is replaced, never changed in place). */
export function addReview(doc: CmsDocument, review: ReviewInfo | undefined) {
  const merged = mergeReview(doc.meta.review, review);
  if (merged !== doc.meta.review) doc.meta = { ...doc.meta, review: merged };
}

const ids = (value: unknown) => (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : Array.isArray(value) ? value.map(String) : []);

/** The change and comment ids that are marked somewhere in the tree, in document order. */
export function reviewIdsIn(tree: Root | Element): { revisions: string[]; comments: string[] } {
  const revisions = new Set<string>();
  const comments = new Set<string>();
  const walk = (n: Nodes) => {
    if (n.type === 'element') {
      for (const key of ['dataRev', 'dataRevBlock', 'dataRevMark'] as const) for (const id of ids(n.properties[key])) revisions.add(id);
      for (const id of ids(n.properties.dataComments)) comments.add(id);
    }
    if ('children' in n) n.children.forEach(walk);
  };
  walk(tree);
  return { revisions: [...revisions], comments: [...comments] };
}

/**
 * The review information of what is still in the document: changes whose markup is gone are left out (hidden
 * changes, which have no markup, stay); comments stay with their whole thread when any comment of it is marked.
 */
export function presentReview(doc: CmsDocument): ReviewInfo | undefined {
  const review = doc.meta.review;
  if (!review) return undefined;
  const found = reviewIdsIn(doc.tree);
  const revs = new Set(found.revisions);
  const threads = new Set(found.comments.map((id) => review.comments[id]?.parentId ?? id));
  const revisions = Object.fromEntries(Object.entries(review.revisions).filter(([id, r]) => revs.has(id) || r.hidden));
  const comments = Object.fromEntries(Object.entries(review.comments).filter(([id, c]) => threads.has(c.parentId ?? id)));
  const authors = review.authors.filter((a) => Object.values(revisions).some((r) => r.author === a) || Object.values(comments).some((c) => c.author === a));
  return { authors, revisions, comments, ...(review.users && { users: review.users }) };
}
