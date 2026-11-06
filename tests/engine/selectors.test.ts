import { describe, expect, it } from 'vitest';
import { importJson, parseHtml, runSelector, type SelectorConfig } from '../../src/engine';
import { fixture } from './helpers';

const html = () => parseHtml(fixture('sample.html').toString());
const texts = (doc: ReturnType<typeof html>, config: SelectorConfig) => runSelector(doc, config).matches.map((m) => m.text);

describe('runSelector: css', () => {
  it('selects elements', () => {
    const sel = runSelector(html(), { mode: 'css', selector: 'h2' });
    expect(sel.kind).toBe('selection');
    expect(sel.matches.map((m) => m.text)).toEqual(['Getting started', 'Pricing']);
    expect(sel.matches[0].match).toEqual({ kind: 'nodes', parent: [], start: 2, end: 3 });
    expect(sel.warnings).toEqual([]);
  });

  it('supports combinators and nested elements', () => {
    expect(texts(html(), { mode: 'css', selector: 'h2 + p' })).toEqual([
      'Plant a source node first. Then connect a selector to it.',
      'The basic plan costs nothing. The pro plan adds snippets.',
    ]);
    expect(texts(html(), { mode: 'css', selector: 'tbody tr:first-child td' })).toEqual(['Source', 'File', 'Document']);
    expect(texts(html(), { mode: 'css', selector: 'li:nth-child(2)' })).toEqual(['Select some text']);
  });

  it('warns about invalid, empty and unmatched selectors', () => {
    expect(runSelector(html(), { mode: 'css', selector: 'p[' }).warnings[0]).toMatch(/^Invalid CSS selector: /);
    expect(runSelector(html(), { mode: 'css', selector: ' ' }).warnings).toEqual(['CSS selector is empty']);
    expect(runSelector(html(), { mode: 'css', selector: 'video' }).warnings).toEqual(['"video" matched nothing']);
  });
});

describe('runSelector: regex', () => {
  it('selects matched text as text ranges', () => {
    const sel = runSelector(html(), { mode: 'regex', pattern: 'plan \\w+' });
    expect(sel.matches.map((m) => m.text)).toEqual(['plan costs', 'plan adds']);
    const { text } = { text: sel.matches[0].text };
    expect(sel.matches[0].match.kind).toBe('text');
    expect(text).toBe('plan costs');
  });

  it('supports flags and selecting whole blocks', () => {
    expect(texts(html(), { mode: 'regex', pattern: 'NODE', flags: 'i' })).toHaveLength(5);
    expect(texts(html(), { mode: 'regex', pattern: 'node', flags: 'i', scope: 'block' })).toEqual([
      'Field Guide to Node Gardens',
      'Node gardens grow best in well-structured documents.',
      'Plant a source node first. Then connect a selector to it.',
      'Every node does one job well.',
      'Node',
    ]);
  });

  it('selects a whole list item when matching inside inline formatting', () => {
    const doc = parseHtml('<ul><li>One <b>bold</b> item</li><li>Two</li></ul>');
    expect(texts(doc, { mode: 'regex', pattern: 'bold', scope: 'block' })).toEqual(['One bold item']);
  });

  it('skips empty matches and warns about bad patterns', () => {
    expect(texts(html(), { mode: 'regex', pattern: '(?=Plant)' })).toEqual([]);
    expect(runSelector(html(), { mode: 'regex', pattern: '(' }).warnings[0]).toMatch(/^Invalid regular expression/);
    expect(runSelector(html(), { mode: 'regex', pattern: '' }).warnings).toEqual(['Regular expression is empty']);
  });

  it('caps the number of matches', () => {
    const sel = runSelector(parseHtml(`<p>${'a'.repeat(6000)}</p>`), { mode: 'regex', pattern: 'a' });
    expect(sel.matches).toHaveLength(5000);
    expect(sel.warnings[0]).toMatch(/^Only the first 5000 of /);
  });
});

describe('runSelector: heading section', () => {
  it('selects a heading and everything under it, up to the next heading of the same level', () => {
    const sel = runSelector(html(), { mode: 'heading', text: 'pricing' });
    expect(sel.matches).toHaveLength(1);
    expect(sel.matches[0].match).toEqual({ kind: 'nodes', parent: [], start: 4, end: 10 });
    expect(sel.matches[0].text.split('\n').slice(0, 3)).toEqual([
      'Pricing',
      'The basic plan costs nothing. The pro plan adds snippets.',
      'Every node does one job well.',
    ]);
  });

  it('stops at higher-level headings but includes deeper ones', () => {
    const doc = parseHtml('<h2>A</h2><p>a</p><h3>A.1</h3><p>a1</p><h2>B</h2><p>b</p><h1>Top</h1><p>t</p>');
    expect(texts(doc, { mode: 'heading', text: 'A', match: 'exact' })).toEqual(['A\na\nA.1\na1']);
    expect(texts(doc, { mode: 'heading', text: 'B', match: 'exact' })).toEqual(['B\nb']);
    expect(texts(doc, { mode: 'heading', text: 'A', level: 3 })).toEqual(['A.1\na1']);
    expect(texts(doc, { mode: 'heading', text: 'B', includeHeading: false })).toEqual(['b']);
  });

  it('warns when nothing matches or a heading is empty', () => {
    const doc = parseHtml('<h2>A</h2><h2>B</h2>');
    expect(runSelector(doc, { mode: 'heading', text: 'Z' }).warnings).toEqual(['No heading matches "Z"']);
    expect(runSelector(doc, { mode: 'heading', text: 'A', includeHeading: false }).warnings).toEqual([
      'Heading "A" has no content under it',
    ]);
  });
});

describe('runSelector: JSON field', () => {
  const json = () =>
    importJson(fixture('sample.json'), {
      mode: 'fields',
      fields: [{ path: '$.title', format: 'text', blockTag: 'h1' }, { path: '$.faq[*].a', format: 'markdown' }],
    });

  it('selects mapped field blocks with JSONPath, including wildcards and filters', async () => {
    const doc = await json();
    const sel = runSelector(doc, { mode: 'jsonField', path: '$.faq[*].a' });
    expect(sel.matches.map((m) => m.text)).toEqual([
      'Yes. Map string fields with JSONPath.',
      'No. Nodes never change their inputs.\nSources stay intact\nOutput is new',
    ]);
    expect(texts(doc, { mode: 'jsonField', path: "$.faq[?(@.q==='Can I use JSON?')].a" })).toHaveLength(1);
    expect(texts(doc, { mode: 'jsonField', path: '$.title' })).toEqual(['Field Guide to Node Gardens']);
  });

  it('warns about unmapped fields, non-JSON sources and templates', async () => {
    expect(runSelector(await json(), { mode: 'jsonField', path: '$.summary' }).warnings).toEqual([
      '$.summary: matched fields that are not mapped into the document',
    ]);
    expect(runSelector(await json(), { mode: 'jsonField', path: '$.nope' }).warnings).toEqual(['$.nope: matched nothing']);
    expect(runSelector(html(), { mode: 'jsonField', path: '$.a' }).warnings).toEqual([
      'JSON field selectors only work on .json sources',
    ]);
    const templated = await importJson('{"a":"x"}', { mode: 'template', template: '<p>{{a}}</p>' });
    expect(runSelector(templated, { mode: 'jsonField', path: '$.a' }).warnings[0]).toMatch(/uses a template/);
  });
});

describe('runSelector', () => {
  it('never changes the document it reads', () => {
    const doc = html();
    const before = JSON.stringify(doc);
    runSelector(doc, { mode: 'regex', pattern: 'node', scope: 'block' });
    runSelector(doc, { mode: 'heading', text: 'Pricing' });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('select everything', () => {
  const doc = parseHtml('\n<h1>Title</h1>\n<p>One <em>two</em></p>\n<ul><li>three</li></ul>\n');

  it('selects the whole document as one match, without the whitespace at the edges', () => {
    const sel = runSelector(doc, { mode: 'all' });
    expect(sel.warnings).toEqual([]);
    expect(sel.matches).toHaveLength(1);
    const m = sel.matches[0].match as { parent: number[]; start: number; end: number };
    expect(m.parent).toEqual([]);
    expect(doc.tree.children[m.start]).toMatchObject({ tagName: 'h1' });
    expect(doc.tree.children[m.end - 1]).toMatchObject({ tagName: 'ul' });
    expect(sel.matches[0].text).toContain('three');
  });

  it('selects each top-level block on its own', () => {
    const sel = runSelector(doc, { mode: 'all', scope: 'blocks' });
    expect(sel.matches.map((m) => m.text)).toEqual(['Title', 'One two', 'three']);
  });

  it('warns for an empty document', () => {
    expect(runSelector(parseHtml('  '), { mode: 'all' }).warnings).toEqual(['The document is empty']);
  });
});
