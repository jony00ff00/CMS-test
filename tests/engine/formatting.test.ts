import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyseFormats, applyChanges, applyFormatting, importDocxReview, parseHtml, reviewIdsIn, runSelector, serialize, type CmsDocument } from '../../src/engine';

const sample = async () => importDocxReview(new Uint8Array(readFileSync('examples/word-review/hung-by-design-review.docx')), { fileName: 'hung.docx' });
const texts = (doc: CmsDocument, css: string) => runSelector(doc, { mode: 'css', selector: css }).matches.map((m) => m.text.trim());
/** Without the review marks, to compare plain structure. */
const plain = (doc: CmsDocument) => serialize(doc).replace(/<span data-comments="[^"]*">|<\/span>/g, '');

/** Word-like paragraphs, written by hand. */
const word = (html: string) => {
  const doc = parseHtml(html);
  doc.meta.review = { authors: [], revisions: {}, comments: {} };
  return doc;
};

describe('the Formatting node', () => {
  it('finds the formats of the sample, with suggestions', async () => {
    const rows = analyseFormats(await sample());
    const find = (label: string) => rows.find((r) => r.label === label);
    expect(find('Heading · Heading 2 · bold, 17 pt')).toMatchObject({ count: 7, suggested: 'h3' });
    expect(find('Heading · Heading 2 · italic, 14 pt')).toMatchObject({ count: 1, suggested: 'h3' });
    expect(find('Heading · Heading 2 · underlined, 17 pt, Calibri')).toMatchObject({ count: 1, suggested: 'h3' });
    expect(find('Paragraph · Normal · bold · short')).toMatchObject({ count: 5, suggested: 'h4', sample: 'What voters did' });
    expect(find('Paragraph · Normal · typed number')).toMatchObject({ count: 5, suggested: 'number' });
    expect(find('Empty paragraph · Normal')).toMatchObject({ count: 3, suggested: 'remove' });
    expect(find('Paragraph · Normal · Calibri')).toMatchObject({ count: 3, suggested: 'p' });
  });

  it('applies the house style to the sample: headings, lists, tables, inline formatting', async () => {
    const r = applyFormatting(await sample());
    const doc = r.document;
    expect(texts(doc, 'h2')).toEqual(["Hung by Design: Malaysia's Three-Way Tie and the Bargaining After GE16"]);
    expect(texts(doc, 'h3')).toHaveLength(9);
    expect(texts(doc, 'h4')).toEqual(['What voters did', 'What leaders are likely to do', 'Objectives, constraints and likely moves', 'Three relationships decide which deal forms.', 'Signals to watch, and what each would indicate']);
    // Headings are plain; nothing has fonts, sizes, colours or underline; bold lead-ins stay.
    expect(texts(doc, ':is(h1, h2, h3, h4) :is(strong, em, u)')).toEqual([]);
    expect(serialize(doc)).not.toMatch(/data-docx|<u>|<s>/);
    expect(texts(doc, 'p > strong, li > strong').length).toBeGreaterThan(20);
    // The typed numbers: one numbered list, each number a tracked deletion by the house style.
    const typed = texts(doc, 'ol')[1];
    expect(typed.startsWith('1. Malay protest voters split.')).toBe(true);
    const dels = Object.values(doc.meta.review!.revisions).filter((x) => x.author === 'House style');
    expect(dels.map((d) => d.before)).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ']);
    // Sources: one list, not two; empty paragraphs gone; five header rows.
    expect(runSelector(doc, { mode: 'css', selector: 'ul' }).matches.length).toBe(3);
    expect(texts(doc, 'ul')[2].split('\n')).toHaveLength(13);
    expect(texts(doc, 'thead th').slice(0, 4)).toEqual(['Bloc', 'Seats', 'Rough vote share', 'Party breakdown']);
    expect(serialize(doc)).not.toMatch(/<p><\/p>/);
    expect(r.info).toMatchObject({ formats: 17, removed: 3, typedNumbers: 5, tableHeaders: 5, settledChanges: 2 });
    expect(r.warnings).toEqual([]);
  });

  it('labels what changed with comments by "House style" (a user of its own), keeping Word’s comments', async () => {
    const doc = applyFormatting(await sample()).document;
    const review = doc.meta.review!;
    const labels = Object.values(review.comments).filter((c) => c.author === 'House style');
    expect(labels).toHaveLength(29);
    expect(labels[0].html).toBe('<p>House style: Heading · Heading 1 · bold, 23 pt → Heading 1 (h2); bold removed; fonts, sizes or colours removed.</p>');
    expect(labels.every((l) => !l.date)).toBe(true);
    expect(review.users).toEqual({ 'House style': { id: 'house-style', name: 'House style' } });
    expect(review.authors).toEqual(['Reviewer', 'House style']);
    // Word's four comments are still there, and every label's range is in the document.
    expect(Object.values(review.comments).filter((c) => c.author === 'Reviewer')).toHaveLength(4);
    expect(reviewIdsIn(doc.tree).comments).toHaveLength(33);
    // One label per format whose paragraphs became something else (at the first one), or none.
    expect(Object.values(applyFormatting(await sample(), { labels: 'rule' }).document.meta.review!.comments).filter((c) => c.author === 'House style')).toHaveLength(6);
    expect(Object.values(applyFormatting(await sample(), { labels: 'none' }).document.meta.review!.comments)).toHaveLength(4);
  });

  it('Word’s formatting changes that no longer change anything are accepted; the list type change stays', async () => {
    const doc = applyFormatting(await sample()).document;
    const types = Object.values(doc.meta.review!.revisions).filter((r) => r.author === 'Reviewer' && !r.hidden).map((r) => r.type);
    expect(types).toEqual(['deletion', 'deletion', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(serialize(doc)).not.toMatch(/<span data-rev=/);
  });

  it('chosen targets, inline formats and options', () => {
    const doc = word(
      '<p data-docx-style="Normal" data-docx-fmt="b"><strong>Short title</strong></p>' +
        '<p data-docx-style="Quote"><u>Said</u> <em>so</em>.</p>' +
        '<ul><li data-docx-style="Normal">a</li></ul><ul><li data-docx-style="Normal">b</li></ul>',
    );
    const rows = analyseFormats(doc);
    const r = applyFormatting(doc, {
      targets: { [rows.find((x) => x.label === 'Paragraph · Normal · bold · short')!.key]: 'h2', [rows.find((x) => x.label.startsWith('Paragraph · Quote'))!.key]: 'quote' },
      inline: ['underline'],
      mergeLists: false,
      labels: 'none',
    });
    expect(plain(r.document)).toBe('<h2>Short title</h2><blockquote><p><u>Said</u> so.</p></blockquote><ul><li>a</li></ul><ul><li>b</li></ul>');
    expect(r.document.meta.review!.users).toBeUndefined();
  });

  it('numbers every paragraph and list item in one running sequence; headings, tables and quotes are not numbered', () => {
    const doc = word(
      '<h1 data-docx-style="Heading 1">T</h1><p data-docx-style="Normal">a</p><p data-docx-style="Normal">b</p>' +
        '<h2 data-docx-style="Heading 2">S</h2><ul><li data-docx-style="Normal">c</li><li data-docx-style="Normal">d</li></ul>' +
        '<table><tbody><tr><td><p data-docx-style="Normal">cell</p></td></tr></tbody></table><p data-docx-style="Normal">e</p><p data-docx-style="Normal"></p>',
    );
    const r = applyFormatting(doc, { numberParagraphs: true, labels: 'rule', tableHeaders: false });
    expect(plain(r.document)).toBe(
      '<h2>T</h2><ol><li>a</li><li>b</li></ol><h3>S</h3><ol start="3"><li>c</li><li>d</li></ol>' +
        '<table><tbody><tr><td><p>cell</p></td></tr></tbody></table><ol start="5"><li>e</li></ol>',
    );
    expect(r.info.numbered).toBe(5);
    // One label explains the numbering, at the first item.
    expect(Object.values(r.document.meta.review!.comments).map((c) => c.html)).toContain(
      '<p>House style: all 5 paragraphs and list items are numbered, in one running sequence (headings, tables and quotes are not).</p>',
    );
  });

  it('after a Changes node: decisions first, then the house style', async () => {
    const decided = applyChanges(await sample(), { defaults: { deletion: 'accept' } }).document;
    const doc = applyFormatting(decided).document;
    expect(texts(doc, 'h2')).toEqual(["Malaysia's Three-Way Tie and the Bargaining After GE16"]);
    expect(texts(doc, 'del')).toEqual(['1.', '2.', '3.', '4.', '5.']);
  });
});
