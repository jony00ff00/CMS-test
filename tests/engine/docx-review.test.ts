import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, importDocxReview, importSource, nodeRegistry, runSelector, serialize, storeFile, type CmsDocument } from '../../src/engine';

const fixture = () => new Uint8Array(readFileSync('tests/fixtures/review.docx'));
/** The reviewed Word file from the example (names and account id removed). */
export const SAMPLE = 'examples/word-review/hung-by-design-review.docx';
const sample = () => new Uint8Array(readFileSync(SAMPLE));
const html = (doc: CmsDocument) => serialize(doc);
const select = (doc: CmsDocument, css: string) => runSelector(doc, { mode: 'css', selector: css }).matches.map((m) => m.text);

describe('Word review mode: tracked changes and comments', () => {
  it('keeps insertions and deletions, with their author and UTC date', async () => {
    const doc = await importDocxReview(fixture(), { fileName: 'review.docx' });
    expect(html(doc)).toContain('<p data-docx-style="Normal">Water <del data-rev="');
    expect(select(doc, 'del[data-rev]')).toEqual(['daily']);
    expect(select(doc, 'ins[data-rev]')).toEqual(['twice a week']);
    const revs = Object.values(doc.meta.review!.revisions);
    expect(revs.map((r) => [r.type, r.author, r.date, r.utc])).toEqual([
      ['deletion', 'Ana', '2026-11-02T09:01:00Z', true],
      ['insertion', 'Ben', '2026-11-02T09:02:00Z', true],
    ]);
    expect(doc.meta.review!.authors).toEqual(['Ana', 'Ben']);
    // Deleted text is part of the text (it is shown, struck through).
    expect(select(doc, 'p')[0]).toBe('Water dailytwice a week in summer.');
  });

  it('comments: ranges across paragraphs, replies, resolved threads, comments on a point', async () => {
    const doc = await importDocxReview(fixture(), { fileName: 'review.docx' });
    const c = Object.values(doc.meta.review!.comments);
    expect(c.map((x) => [x.author, x.html, x.parentId ? 'reply' : 'thread', x.resolved])).toEqual([
      ['Ana', '<p>Is this still true?</p>', 'thread', false],
      ['Ben', '<p>Yes, checked.</p>', 'reply', false],
      ['Ben', '<p>Fixed already.</p>', 'thread', true],
      ['Ana', '<p>Add a picture here?</p>', 'thread', false],
    ]);
    expect(c[1].parentId).toBe(c[0].id);
    // One span per piece of the range; a comment on a point is an empty span.
    expect(select(doc, `[data-comments~="${c[0].id}"]`)).toEqual(['Seeds sprout in spring.', 'Pots drain best.']);
    expect(html(doc)).toContain(`Done.<span data-comments="${c[3].id}"></span>`);
    // Ids start with the file's hash, so two documents never share one.
    expect(c[0].id).toMatch(/^w[a-z0-9]{6}-c1$/);
  });

  it('keeps direct formatting as data: per paragraph (what covers most of its text) and per run', async () => {
    const doc = await importDocxReview(fixture(), { fileName: 'review.docx' });
    expect(html(doc)).toContain('<p data-docx-style="Normal" data-docx-fmt="b sz=16 font=Calibri"><span data-docx-run="sz=16 font=Calibri"><strong>Pests</strong></span></p>');
    expect(html(doc)).toContain('<h1 data-docx-style="Heading 1">Garden notes</h1>');
  });

  it('reads the reviewed sample: deletions, list and formatting changes, comments in a table, links, lists', async () => {
    const doc = await importDocxReview(sample(), { fileName: 'hung.docx' });
    const review = doc.meta.review!;
    const byType = (t: string, hidden = false) => Object.values(review.revisions).filter((r) => r.type === t && !!r.hidden === hidden);
    expect(byType('deletion').length).toBe(2);
    expect(select(doc, 'del[data-rev]')).toEqual(['Hung by Design: ', '@Sam']);
    // Five list paragraphs changed from bullets to "1)" numbers (one change in Word, one per paragraph here).
    expect(byType('paragraph').map((r) => r.before)).toEqual(Array(5).fill('Normal, bulleted list'));
    expect(select(doc, 'ol > li[data-rev-block]')).toHaveLength(5);
    // Formatting changes: a heading that was bold 17 pt, a lead-in that gained an underline; the paragraph mark's and
    // the tables' property changes show nowhere.
    expect(byType('format').map((r) => r.before)).toEqual(['bold, 17 pt', 'bold']);
    expect(byType('format', true)).toHaveLength(1);
    expect(byType('table', true)).toHaveLength(4);
    expect(review.authors).toEqual(['Reviewer']);
    // Four comments, one of them in a table cell; dates in UTC from commentsExtensible.xml.
    const comments = Object.values(review.comments);
    expect(comments.map((c) => c.html)).toEqual(['<p>can we have a more professional word?</p>', '<p>Test</p>', '<p>Why this option first?</p>', '<p>TOo vague</p>']);
    expect(comments[0].date).toBe('2026-11-11T02:19:59.663Z');
    expect(select(doc, 'td [data-comments]')).toEqual(["e first attempt on PH's vote-share lead; pay UMNO in posts and seats"]);
    // Lists (bullets and "1)" numbers), headings, links, tables.
    expect(select(doc, 'h1, h2').slice(0, 3)).toEqual(["Hung by Design: Malaysia's Three-Way Tie and the Bargaining After GE16", 'Summary', 'The result: three blocs within two seats of each other']);
    expect(select(doc, 'ul > li').length).toBeGreaterThan(15);
    expect(select(doc, 'a[href^="https://"]')).toHaveLength(13);
    expect(select(doc, 'table')).toHaveLength(5);
    // No account ids or e-mail addresses from people.xml.
    expect(JSON.stringify(doc)).not.toMatch(/@[a-z]+\.(com|org)|userId/i);
  });

  it('the Document Source reads it in review mode when asked, and with mammoth otherwise', async () => {
    const file = storeFile('review.docx', fixture(), 'f');
    const graph = { nodes: [{ id: 's', type: 'documentSource', config: { fileId: 'f', docx: { review: true } } }], edges: [] };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files: { f: file } });
    expect(results.s.info).toMatchObject({ changes: 2, comments: 4 });
    const plain = await importSource({ name: 'review.docx', data: fixture() });
    expect(plain.meta.review).toBeUndefined();
    expect(serialize(plain)).not.toContain('daily'); // mammoth drops deletions
  });

  it('plain errors for files it cannot read', async () => {
    await expect(importDocxReview(new TextEncoder().encode('not a zip'), { fileName: 'x.docx' })).rejects.toThrow('x.docx is not a Word file');
    await expect(importDocxReview(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), { fileName: 'old.doc.docx' })).rejects.toThrow('old .doc file');
  });
});
