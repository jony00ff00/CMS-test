import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySnippet, combineDocuments, copyContent, documentFromSelection, GraphEvaluator, importDocxReview, nodeRegistry, parseHtml, presentReview,
  replaceSelection, reviewIdsIn, runSelector, serialize, storeFile, type CmsDocument, type Snippet,
} from '../../src/engine';

const review = async () => importDocxReview(new Uint8Array(readFileSync('tests/fixtures/review.docx')), { fileName: 'review.docx' });
const wrap = (template: string): Snippet => ({ kind: 'snippet', id: 'w', name: 'W', version: 1, mode: 'wrap', template, params: [] });

describe('tracked changes and comments travel through the engine', () => {
  it('a text range that cuts through a change and a comment: every piece keeps its marks', async () => {
    const doc = await review();
    // "ly twice" starts inside the deletion ("daily") and ends inside the insertion ("twice a week").
    const r = await applySnippet(runSelector(doc, { mode: 'regex', pattern: 'lytwice' }), wrap('<mark>{{content}}</mark>'));
    const html = serialize(r.document);
    expect(html).toMatch(/<del data-rev="(w\w+-r1)">dai<\/del><mark><del data-rev="\1">ly<\/del><ins data-rev="(w\w+-r2)">twice<\/ins><\/mark><ins data-rev="\2"> a week<\/ins>/);
    const c = await applySnippet(runSelector(r.document, { mode: 'regex', pattern: 'sprout' }), wrap('<b>{{content}}</b>'));
    // Inside one comment's text, the wrapper goes inside the comment's span (nothing needs splitting).
    expect(serialize(c.document)).toMatch(/<span data-comments="w\w+-c1">Seeds <b>sprout<\/b> in spring.<\/span>/);
    // Across the end of a comment's text: the span is split, both pieces keep the comment.
    const across = await applySnippet(runSelector(doc, { mode: 'regex', pattern: 'night\\. Done' }), wrap('<i>{{content}}</i>'));
    expect(serialize(across.document)).toMatch(/<span data-comments="(w\w+-c3)">Snails come at <\/span><i><span data-comments="\1">night.<\/span> Done<\/i>\./);
    // The review information stays with the document.
    expect(c.document.meta.review).toEqual(doc.meta.review);
  });

  it('copies bring their review information along (Extractor, Object, Replace content)', async () => {
    const doc = await review();
    const sel = runSelector(doc, { mode: 'css', selector: 'p:nth-of-type(1), p:nth-of-type(2)' });
    const copy = await copyContent(sel);
    expect(copy.review).toBe(doc.meta.review);
    const extracted = await documentFromSelection(sel);
    expect(presentReview(extracted.document)).toMatchObject({ authors: ['Ana', 'Ben'] });
    expect(Object.keys(presentReview(extracted.document)!.revisions)).toHaveLength(2);
    // Into a plain HTML page by a Replace node: the page gets the review information and its preview styles.
    const page = parseHtml('<h1>Page</h1><p>Old</p>');
    const replaced = await replaceSelection(runSelector(page, { mode: 'css', selector: 'p' }), sel);
    expect(serialize(replaced.document)).toContain('<del data-rev=');
    expect(Object.keys(presentReview(replaced.document)!.comments)).toHaveLength(2); // c1 and its reply
    expect(replaced.document.meta.styles.join()).toContain('del[data-rev]');
    expect(page.meta.review).toBeUndefined();
  });

  it('presentReview keeps only what is still marked (and hidden changes), with whole threads', async () => {
    const doc = await review();
    const ids = reviewIdsIn(doc.tree);
    expect(ids.revisions).toHaveLength(2);
    expect(ids.comments).toHaveLength(3); // c1, c3, c4 (c2 is a reply: it has no range)
    // Remove the paragraph with the deletion and insertion: those changes are gone, the comments stay.
    const removed = await replaceSelection(runSelector(doc, { mode: 'regex', pattern: 'Water', scope: 'block' }), runSelector(parseHtml('<p>Hi</p>'), { mode: 'css', selector: 'p' }));
    const present = presentReview(removed.document)!;
    expect(Object.keys(present.revisions)).toEqual([]);
    expect(Object.keys(present.comments)).toHaveLength(4);
  });

  it('documents combined by an Output keep the review information of each', async () => {
    const a = await review();
    const b: CmsDocument = { ...parseHtml('<p>Other</p>'), meta: { ...parseHtml('').meta, review: { authors: ['Cy'], revisions: { x: { id: 'x', type: 'insertion', author: 'Cy', utc: false } }, comments: {} } } };
    const both = combineDocuments([a, b]);
    expect(both.meta.review!.authors).toEqual(['Ana', 'Ben', 'Cy']);
    expect(Object.keys(both.meta.review!.revisions)).toHaveLength(3);
  });

  it('through a graph: Source (review) → Selector → Snippet → Output', async () => {
    const files = { f: storeFile('review.docx', new Uint8Array(readFileSync('tests/fixtures/review.docx')), 'f') };
    const graph = {
      nodes: [
        { id: 's', type: 'documentSource', config: { fileId: 'f', docx: { review: true } } },
        { id: 'sel', type: 'selector', config: { mode: 'css', selector: 'p' } },
        { id: 'snip', type: 'snippet', config: { snippet: wrap('<div class="box">{{content}}</div>') } },
        { id: 'out', type: 'output', config: { format: 'html', fullDocument: true } },
      ],
      edges: [
        { id: 'e1', source: 's', sourcePort: 'document', target: 'sel', targetPort: 'document' },
        { id: 'e2', source: 'sel', sourcePort: 'selection', target: 'snip', targetPort: 'selection' },
        { id: 'e3', source: 'snip', sourcePort: 'document', target: 'out', targetPort: 'document' },
      ],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files });
    const out = results.out.outputs.document as CmsDocument;
    expect(out.meta.review).toBeDefined();
    expect(reviewIdsIn(out.tree).comments).toHaveLength(3);
    expect(results.out.outputs.html as string).toContain('del[data-rev]{');
  });
});
