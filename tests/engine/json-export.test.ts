import { describe, expect, it } from 'vitest';
import { applySnippet, exportJson, importJson, parseHtml, runSelector, type JsonMapping, type Snippet } from '../../src/engine';
import { SEED_SNIPPETS } from '../../src/snippets/seed';
import { fixture } from './helpers';

const details = SEED_SNIPPETS.find((s) => s.id === 'details')!;
const highlight = SEED_SNIPPETS.find((s) => s.id === 'highlight')!;
const sample = () => JSON.parse(fixture('sample.json').toString());

const mapping: JsonMapping = {
  mode: 'fields',
  fields: [
    { path: '$.title', format: 'text', blockTag: 'h1' },
    { path: '$.summary', format: 'text' },
    { path: '$.articles[*].body', format: 'html' },
    { path: '$.faq[*].a', format: 'markdown' },
  ],
};

async function transform(json: string, map: JsonMapping, steps: [Parameters<typeof runSelector>[1], Snippet, Record<string, unknown>?][]) {
  let doc = await importJson(json, map);
  for (const [selector, snippet, params] of steps) doc = (await applySnippet(runSelector(doc, selector), snippet, { params })).document;
  return doc;
}

describe('exportJson', () => {
  it('writes the file back unchanged when nothing was changed', async () => {
    const doc = await importJson(fixture('sample.json'), mapping);
    const r = await exportJson(doc);
    expect(r.changed).toEqual([]);
    expect(r.data).toEqual(sample());
    expect(r.warnings).toEqual([]);
  });

  it('changes only the fields a snippet touched, including the wrapper around them', async () => {
    const doc = await transform(fixture('sample.json').toString(), mapping, [
      [{ mode: 'jsonField', path: '$.faq[*].a' }, details, { summary: 'Answer' }],
    ]);
    const r = await exportJson(doc);
    expect(r.changed).toEqual(['$.faq[0].a', '$.faq[1].a']);
    const data = r.data as ReturnType<typeof sample>;
    expect(data.faq[0].a).toBe(
      '<details class="cms-details"><summary>Answer</summary><p>Yes. Map <strong>string fields</strong> with JSONPath.</p></details>',
    );
    expect(data.faq[1].a).toMatch(/^<details class="cms-details"><summary>Answer<\/summary><p>No\. Nodes never change their inputs\.<\/p><ul>/);
    // Everything else is exactly as before.
    const before = sample();
    expect({ ...data, faq: undefined }).toEqual({ ...before, faq: undefined });
    expect(data.faq.map((f: { q: string }) => f.q)).toEqual(before.faq.map((f: { q: string }) => f.q));
    expect(r.warnings).toEqual(['Changed Markdown fields are written back as HTML']);
  });

  it('writes plain text fields as text, and as HTML once markup was added', async () => {
    const json = JSON.stringify({ intro: 'One.\n\nTwo\nlines.', note: 'Keep the key point.' });
    const map: JsonMapping = { mode: 'fields', fields: [{ path: '$.*', format: 'text' }] };
    const doc = await transform(json, map, [[{ mode: 'regex', pattern: 'key point' }, highlight]]);
    const r = await exportJson(doc);
    expect(r.data).toEqual({ intro: 'One.\n\nTwo\nlines.', note: '<p>Keep the <mark class="cms-hl cms-hl-yellow">key point</mark>.</p>' });
    expect(r.changed).toEqual(['$.note']);
  });

  it('writes an edited text field back as text when it is still plain', async () => {
    const replace: Snippet = { kind: 'snippet', id: 'r', name: 'R', version: 1, mode: 'replace', template: 'free', params: [] };
    const doc = await transform(JSON.stringify({ price: 'It costs 5 euros.' }), { mode: 'fields', fields: [{ path: '$.price', format: 'text' }] }, [
      [{ mode: 'regex', pattern: '5 euros' }, replace],
    ]);
    expect((await exportJson(doc)).data).toEqual({ price: 'It costs free.' });
  });

  it('warns about content outside the fields and wrappers around several fields', async () => {
    const hr: Snippet = { kind: 'snippet', id: 'hr', name: 'Rule', version: 1, mode: 'prepend', template: '<hr>', params: [] };
    const box: Snippet = { kind: 'snippet', id: 'box', name: 'Box', version: 1, mode: 'wrap', template: '<section>{{content}}</section>', params: [] };
    let doc = await transform(fixture('sample.json').toString(), mapping, [[{ mode: 'jsonField', path: '$.summary' }, hr]]);
    // One wrapper around both article bodies (children 3 and 4 after the title, rule and summary).
    const bodies = runSelector(doc, { mode: 'jsonField', path: '$.articles[*].body' });
    const [first, second] = bodies.matches.map((m) => m.match);
    expect(first.kind === 'nodes' && second.kind === 'nodes' && second.start - first.start).toBe(1);
    const run = { ...bodies, matches: [{ match: { ...first, end: (first as { start: number }).start + 2 }, text: '' }] };
    doc = (await applySnippet(run, box)).document;

    const r = await exportJson(doc);
    expect(r.warnings).toContain('1 element outside the JSON fields was not written back');
    expect(r.warnings).toContain('A wrapper around several fields cannot be written back; only the fields inside it were');
    // The fields inside the shared wrapper are unchanged, so they keep their values.
    expect((r.data as ReturnType<typeof sample>).articles).toEqual(sample().articles);
  });

  it('adds snippet CSS and JS under $assets when asked', async () => {
    const doc = await transform(fixture('sample.json').toString(), mapping, [[{ mode: 'jsonField', path: '$.faq[0].a' }, details]]);
    const r = await exportJson(doc, { assets: true });
    expect((r.data as { $assets: { css: string } }).$assets.css).toContain('.cms-details{');
    expect(r.json.endsWith('\n')).toBe(true);
  });

  it('refuses template sources and non-JSON sources', async () => {
    const templated = await importJson('{"a":"x"}', { mode: 'template', template: '<p>{{a}}</p>' });
    await expect(exportJson(templated)).rejects.toThrow('can only be exported as HTML');
    await expect(exportJson(parseHtml('<p>x</p>'))).rejects.toThrow('JSON export needs a .json Document Source');
  });

  it('never changes the document or its stored data', async () => {
    const doc = await transform(fixture('sample.json').toString(), mapping, [[{ mode: 'jsonField', path: '$.faq[*].a' }, details]]);
    const before = JSON.stringify(doc);
    await exportJson(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
