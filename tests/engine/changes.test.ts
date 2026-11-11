import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyChanges, changeGroups, commentThreads, GraphEvaluator, importDocxReview, nodeRegistry, parseHtml, serialize, storeFile, toUtc,
  type CmsDocument, type ReviewInfo,
} from '../../src/engine';

const fixture = async () => importDocxReview(new Uint8Array(readFileSync('tests/fixtures/review.docx')), { fileName: 'review.docx' });
const sample = async () => importDocxReview(new Uint8Array(readFileSync('examples/word-review/hung-by-design-review.docx')), { fileName: 'hung.docx' });
const body = (doc: CmsDocument) => serialize(doc).replace(/ data-docx-[\w-]+="[^"]*"/g, '');

/** A small document with every kind of change, written by hand. */
function handmade(): CmsDocument {
  const doc = parseHtml(
    '<p>A <ins data-rev="i">new</ins><del data-rev="d">old</del> <span data-rev="f"><em>word</em></span>.</p>' +
      '<h2 data-rev-block="p" data-docx-style="Heading 2">Was a paragraph</h2>' +
      '<ol><li data-rev-block="l1">One</li><li data-rev-block="l2">Two</li></ol>' +
      '<p data-rev-mark="m">First half</p><p>second half</p>' +
      '<table><tbody><tr><td>Keep</td></tr><tr data-rev-block="row"><td>New row</td></tr></tbody></table>' +
      '<p><span data-comments="c1">Commented</span> and <span data-comments="c2">resolved</span>.</p>',
  );
  const r = (id: string, type: ReviewInfo['revisions'][string]['type'], extra = {}) => ({ id, type, author: 'Ana', date: '2026-11-02T10:00:00', utc: false, ...extra });
  doc.meta.review = {
    authors: ['Ana'],
    revisions: {
      i: r('i', 'insertion'), d: r('d', 'deletion'), f: r('f', 'format', { before: 'bold', beforeProps: { b: 'on' } }),
      p: r('p', 'paragraph', { before: 'Normal, not in a list', beforeProps: { style: 'Normal', list: 'none' } }),
      l1: r('l1', 'paragraph', { beforeProps: { style: 'Normal', list: 'bullet' } }), l2: r('l2', 'paragraph', { beforeProps: { style: 'Normal', list: 'bullet' } }),
      m: r('m', 'deletion', { mark: true }), row: r('row', 'insertion', { row: true }),
      h: r('h', 'table', { hidden: true }),
    },
    comments: {
      c1: { id: 'c1', author: 'Ana', html: '<p>Hm</p>', utc: true, date: '2026-11-02T10:00:00Z', resolved: false },
      c2: { id: 'c2', author: 'Ben', html: '<p>Done</p>', utc: true, resolved: true },
      c3: { id: 'c3', author: 'Ana', html: '<p>Reply</p>', utc: true, resolved: true, parentId: 'c2' },
    },
  };
  return doc;
}

describe('the Changes node', () => {
  it('keep (default): nothing changes but hidden changes, which are accepted', () => {
    const doc = handmade();
    const r = applyChanges(doc, {});
    expect(body(r.document)).toBe(body(doc));
    expect(r.counts).toMatchObject({ kept: 8, accepted: 0, rejected: 0, hidden: 1, threadsKept: 2 });
    expect(r.document.meta.review!.revisions.h).toBeUndefined();
    expect(r.warnings).toEqual(['Some dates have no time zone in the file; they are read as UTC. Set the time zone the file was written in']);
  });

  it('accept everything: insertions stay, deletions go, new formatting stays, rows and joins happen', () => {
    const r = applyChanges(handmade(), { defaults: { insertion: 'accept', deletion: 'accept', format: 'accept', paragraph: 'accept', row: 'accept', mark: 'accept' } });
    expect(body(r.document)).toBe(
      '<p>A new <em>word</em>.</p><h2>Was a paragraph</h2><ol><li>One</li><li>Two</li></ol><p>First halfsecond half</p>' +
        '<table><tbody><tr><td>Keep</td></tr><tr><td>New row</td></tr></tbody></table>' +
        '<p><span data-comments="c1">Commented</span> and <span data-comments="c2">resolved</span>.</p>',
    );
    expect(Object.keys(r.document.meta.review!.revisions)).toEqual([]);
    expect(r.counts.accepted).toBe(8);
  });

  it('reject everything: the old text, formatting, style and list type come back', () => {
    const r = applyChanges(handmade(), { defaults: { insertion: 'reject', deletion: 'reject', format: 'reject', paragraph: 'reject', row: 'reject', mark: 'reject' } });
    expect(body(r.document)).toBe(
      '<p>A old <strong>word</strong>.</p><p>Was a paragraph</p><ul><li>One</li><li>Two</li></ul><p>First half</p><p>second half</p>' +
        '<table><tbody><tr><td>Keep</td></tr></tbody></table>' +
        '<p><span data-comments="c1">Commented</span> and <span data-comments="c2">resolved</span>.</p>',
    );
    // Nothing undecided is left, so no dates without a time zone either.
    expect(r.warnings).toEqual([]);
  });

  it('one change, an author and a kind: the change wins, then the author, then the kind', () => {
    const r = applyChanges(handmade(), { defaults: { insertion: 'reject' }, byAuthor: { Ana: 'accept' }, decisions: { d: 'reject', f: 'keep' } });
    expect(body(r.document)).toContain('<p>A newold <span data-rev="f"><em>word</em></span>.</p>');
  });

  it('comments: drop a thread or the resolved ones (the text stays); users and time zone', () => {
    const r = applyChanges(handmade(), { dropResolved: true, dropComments: ['c1'], users: { Ana: { id: 'u-ana', name: 'Ana P.' } }, timezone: '+08:00' });
    expect(body(r.document)).toContain('<p>Commented and resolved.</p>');
    expect(r.counts).toMatchObject({ threadsKept: 0, threadsDropped: 2 });
    expect(r.document.meta.review!.users).toEqual({ Ana: { id: 'u-ana', name: 'Ana P.' } });
    // 10:00 at UTC+8 is 02:00 UTC.
    expect(r.document.meta.review!.revisions.i).toMatchObject({ date: '2026-11-02T02:00:00.000Z', utc: true });
    expect(r.warnings).toEqual([]);
    expect(toUtc('2026-11-02T10:00:00', '-05:30')).toBe('2026-11-02T15:30:00.000Z');
    expect(toUtc('2026-11-02T10:00:00', 'Asia/KL')).toBeUndefined();
  });

  it('lists the changes in groups and the comment threads, for the inspector', async () => {
    const doc = await sample();
    const groups = changeGroups(doc);
    // The five list paragraphs changed at once are one row.
    expect(groups.map((g) => [g.kind, g.ids.length, g.before ?? ''])).toEqual([
      ['deletion', 1, ''], ['deletion', 1, ''], ['paragraph', 5, 'Normal, bulleted list'], ['format', 1, 'bold, 17 pt'], ['format', 1, 'bold'],
    ]);
    expect(groups[0].text).toBe('Hung by Design: ');
    const threads = commentThreads(await fixture());
    expect(threads.map((t) => [t.text, t.comments.length])).toEqual([['Seeds sprout in spring.Pots drain best.', 2], ['Snails come at night.', 1], ['', 1]]);
  });

  it('as a node in a graph, with the sample: keeps everything, accepts the hidden table changes', async () => {
    const files = { f: storeFile('hung.docx', new Uint8Array(readFileSync('examples/word-review/hung-by-design-review.docx')), 'f') };
    const graph = {
      nodes: [
        { id: 's', type: 'documentSource', config: { fileId: 'f', docx: { review: true } } },
        { id: 'c', type: 'changes', config: nodeRegistry.changes.defaultConfig() },
      ],
      edges: [{ id: 'e', source: 's', sourcePort: 'document', target: 'c', targetPort: 'document' }],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files });
    expect(results.c.status).toBe('ok');
    expect(results.c.info).toMatchObject({ kept: 9, hidden: 5, threadsKept: 4 });
  });
});
