// Several documents as one: their content one after another.
import { mergeReview } from './review';
import type { CmsDocument } from './types';

/**
 * One document with the content of `docs` in order. The first document gives the title (or the first one that
 * has a title); styles, images and snippet CSS/JS of all of them are kept (each snippet once). The result is not
 * a JSON source any more, so it cannot be written back to a JSON file. Never changes `docs`.
 */
export function combineDocuments(docs: CmsDocument[]): CmsDocument {
  if (docs.length === 1) return docs[0];
  const assets = Object.assign({}, ...docs.map((d) => d.assets));
  const snippetAssets = docs.flatMap((d) => d.meta.snippetAssets ?? []).filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  const review = docs.reduce<CmsDocument['meta']['review']>((r, d) => mergeReview(r, d.meta.review), undefined);
  return {
    kind: 'document',
    tree: { type: 'root', children: docs.flatMap((d) => structuredClone(d.tree.children)) },
    meta: {
      origin: docs[0]?.meta.origin ?? 'html',
      fileName: docs[0]?.meta.fileName,
      title: docs.find((d) => d.meta.title)?.meta.title,
      styles: [...new Set(docs.flatMap((d) => d.meta.styles))],
      warnings: [],
      ...(snippetAssets.length ? { snippetAssets } : {}),
      ...(review && { review }),
    },
    assets,
  };
}
