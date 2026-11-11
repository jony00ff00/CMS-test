import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyChanges, applyFormatting, importDocxReview, parseHtml, toCkeditor, type CmsDocument } from '../../src/engine';
import { signature } from '../../scripts/ckeditor-import.mjs';

const fixture = async () => importDocxReview(new Uint8Array(readFileSync('tests/fixtures/review.docx')), { fileName: 'review.docx' });
const sample = async () => importDocxReview(new Uint8Array(readFileSync('examples/word-review/hung-by-design-review.docx')), { fileName: 'hung.docx' });
const NOW = '2026-11-11T00:00:00.000Z';
const users = { Ana: { id: 'u-ana', name: 'Ana P.' }, Ben: { id: 'u-ben' } };

describe('CKEditor 5 output', () => {
  it('insertions and deletions become suggestions, comments become threads with markers around their ranges', async () => {
    const doc = applyChanges(await fixture(), { users }).document;
    const ck = toCkeditor(doc, { documentId: 'garden', bundleVersion: '2.0.1', now: NOW });
    const [del, ins] = ck.suggestions;
    expect(ck.data).toContain(
      `<p>Water <suggestion-start name="deletion:${del.id}:u-ana"></suggestion-start>daily<suggestion-end name="deletion:${del.id}:u-ana"></suggestion-end>` +
        `<suggestion-start name="insertion:${ins.id}:u-ben"></suggestion-start>twice a week<suggestion-end name="insertion:${ins.id}:u-ben"></suggestion-end> in summer.</p>`,
    );
    expect(ck.suggestions.map((s) => [s.type, s.authorId, s.createdAt])).toEqual([
      ['deletion', 'u-ana', '2026-11-02T09:01:00.000Z'],
      ['insertion', 'u-ben', '2026-11-02T09:02:00.000Z'],
    ]);
    // A thread across two paragraphs: start in the first, end in the second; the reply is in the thread.
    const [thread] = ck.commentThreads;
    expect(ck.data).toContain(`<p><comment-start name="${thread.threadId}"></comment-start>Seeds sprout in spring.</p><p>Pots drain best.<comment-end name="${thread.threadId}"></comment-end></p>`);
    expect(thread.comments.map((c) => [c.authorId, c.content])).toEqual([['u-ana', '<p>Is this still true?</p>'], ['u-ben', '<p>Yes, checked.</p>']]);
    // The resolved thread is dropped by default in the Changes node; here it was kept.
    expect(ck.commentThreads).toHaveLength(3);
    // A comment on a point: start and end together.
    const point = ck.commentThreads[2].threadId;
    expect(ck.data).toContain(`Done.<comment-start name="${point}"></comment-start><comment-end name="${point}"></comment-end></p>`);
    expect(ck.users).toEqual([{ id: 'u-ana', name: 'Ana P.' }, { id: 'u-ben', name: 'Ben' }]);
    // No review or Word data left in the content.
    expect(ck.data).not.toMatch(/data-(rev|comments|docx)|<ins|<del/);
  });

  it('the import body for Cloud Services', async () => {
    const ck = toCkeditor(applyChanges(await fixture(), { users }).document, { documentId: 'garden', bundleVersion: '2.0.1', now: NOW });
    const body = ck.importBody as { id: string; content: { data: string; bundle_version: string }; suggestions: unknown[]; comments: Record<string, unknown>[] };
    expect(body.id).toBe('garden');
    expect(body.content).toEqual({ data: ck.data, bundle_version: '2.0.1' });
    expect(body.suggestions[0]).toEqual({ id: ck.suggestions[0].id, document_id: 'garden', type: 'deletion', created_at: '2026-11-02T09:01:00.000Z', user: { id: 'u-ana' }, data: null, attributes: {}, has_comments: false });
    expect(body.comments).toHaveLength(4);
    expect(body.comments[1]).toMatchObject({ thread_id: ck.commentThreads[0].threadId, user: { id: 'u-ben' }, type: 1 });
    expect(ck.warnings).toEqual([
      // No Formatting node here, so the Word heading 1 is still <h1>.
      "<h1> (1×) is not one of the editor's features (headings h2, h3, h4): the editor will drop it and keep its text. Change it in the Formatting node, or add the feature",
      'Resolved threads are imported as open threads (the import body has no field for it here)',
    ]);
  });

  it('formatting and paragraph changes are kept as they are now, with one note per change made together', async () => {
    const ck = toCkeditor(await sample(), { documentId: 'x', bundleVersion: '1', now: NOW });
    const notes = ck.commentThreads.filter((t) => t.threadId.endsWith('-note'));
    expect(notes.map((t) => t.comments[0].content)).toEqual([
      '<p>Tracked change in Word: Reviewer changed the formatting of the paragraphs here (they were: Normal, bulleted list). It is shown as it is now; accept it, or change it back here.</p>',
      '<p>Tracked change in Word: Reviewer changed the formatting here (it was: bold, 17 pt). It is shown as it is now; accept it, or change it back here.</p>',
      '<p>Tracked change in Word: Reviewer changed the formatting here (it was: bold). It is shown as it is now; accept it, or change it back here.</p>',
    ]);
    // The list note runs from the first changed item to the last.
    const id = notes[0].threadId;
    expect(ck.data.indexOf(`<comment-start name="${id}">`)).toBeLessThan(ck.data.indexOf('Anwar Ibrahim'));
    expect(ck.data.indexOf(`<comment-end name="${id}">`)).toBeGreaterThan(ck.data.indexOf('Abang Johari Openg'));
    // Without the Changes node, authors have no user id: a warning, and an id from the name.
    expect(ck.warnings).toContain('“Reviewer” has no user id in the editor; “reviewer” is used. Set it in the Changes node');
  });

  it('the whole pipeline on the sample: tables in CKEditor’s wrapper, nothing outside the editor’s features', async () => {
    const doc = applyFormatting(applyChanges(await sample(), { dropResolved: true, users: { Reviewer: { id: 'u-1' } } }).document).document;
    const ck = toCkeditor(doc, { documentId: 'ge16', bundleVersion: '1.0.0', now: NOW });
    expect(ck.warnings).toEqual([]);
    expect(ck.info).toEqual({ suggestions: 7, threads: 34, comments: 34, noted: 5 });
    expect(ck.data.match(/<figure class="table"><table><thead>/g)).toHaveLength(5);
    expect(ck.data).not.toMatch(/<(h1|h5|u|s|span)[ >]/);
    // The house style's labels get the export's date (they have none).
    expect(ck.commentThreads.find((t) => t.comments[0].authorId === 'house-style')!.comments[0].createdAt).toBe(NOW);
  });

  it('warns about elements outside the editor’s features, and missing ids', () => {
    const doc: CmsDocument = parseHtml('<h1>T</h1><p><u>u</u> and <img src="x.png" alt=""></p>', { fileName: 'brief.docx' });
    const ck = toCkeditor(doc, { headings: ['h2'], now: NOW });
    expect(ck.warnings).toEqual([
      '<h1> (1×) is not one of the editor\'s features (headings h2): the editor will drop it and keep its text. Change it in the Formatting node, or add the feature',
      '<u> (1×) is not one of the editor\'s features (headings h2): the editor will drop it and keep its text. Change it in the Formatting node, or add the feature',
      '<img> (1×) is not one of the editor\'s features (headings h2): the editor will drop it and keep its text. Change it in the Formatting node, or add the feature',
      'No document id given: “brief” is used (it must be new in Cloud Services)',
      'No editor bundle version given: the import needs the version of the editor bundle uploaded to Cloud Services',
    ]);
    expect(toCkeditor(doc, { headings: ['h1', 'h2'], extraElements: ['u', 'img'], documentId: 'a', bundleVersion: '1', now: NOW }).warnings).toEqual([]);
  });

  it('the import script signs a request with HMAC SHA-256 over method, path, timestamp and body', () => {
    const sig = signature('secret', 'post', 'https://env.cke-cs.com/api/v5/env/documents?x=1', 1700000000000, { id: 'a' });
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).not.toBe(signature('secret', 'POST', 'https://env.cke-cs.com/api/v5/env/documents', 1700000000000, { id: 'a' }));
  });
});
