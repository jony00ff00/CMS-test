import { describe, expect, it } from 'vitest';
import {
  applySnippet, importJson, parseHtml, runSelector, serialize, type CmsDocument, type Selection, type SelectorConfig,
  type Snippet,
} from '../../src/engine';
import { fixture } from './helpers';

const snippet = (partial: Partial<Snippet>): Snippet => ({
  kind: 'snippet', id: 'test', name: 'Test', version: 1, mode: 'wrap', template: '<mark>{{content}}</mark>', params: [], ...partial,
});

const select = (doc: CmsDocument, ...configs: SelectorConfig[]): Selection => ({
  kind: 'selection',
  document: doc,
  matches: configs.flatMap((c) => runSelector(doc, c).matches),
  warnings: [],
});

async function apply(html: string, config: SelectorConfig | SelectorConfig[], s: Partial<Snippet>, options = {}) {
  const doc = parseHtml(html);
  const result = await applySnippet(select(doc, ...[config].flat()), snippet(s), options);
  return { ...result, html: serialize(result.document) };
}

describe('wrap', () => {
  it('wraps every matched element, keeping the original nodes', async () => {
    const r = await apply('<h2>A</h2><p>x</p><h2 class="t">B</h2>', { mode: 'css', selector: 'h2' }, {
      template: '<section class="box" data-n="{{number}}/{{count}}">{{content}}</section>',
    });
    expect(r.html).toBe(
      '<section class="box" data-n="1/2"><h2>A</h2></section><p>x</p><section class="box" data-n="2/2"><h2 class="t">B</h2></section>',
    );
    expect(r.applied).toBe(2);
    expect(r.warnings).toEqual([]);
  });

  it('wraps text inside a paragraph', async () => {
    const r = await apply(fixture('sample.html').toString(), { mode: 'regex', pattern: 'costs nothing' }, {});
    expect(r.html).toContain('<p>The basic plan <mark>costs nothing</mark>. The pro plan adds snippets.</p>');
  });

  it('splits inline elements when the text only partly covers them', async () => {
    const r = await apply('<p>a <em>bold move</em> here</p>', { mode: 'regex', pattern: 'move here' }, {});
    expect(r.html).toBe('<p>a <em>bold </em><mark><em>move</em> here</mark></p>');
  });

  it('splits deeply nested formatting on both sides', async () => {
    const r = await apply('<p><b>one <i>two three</i></b> four <u>five six</u></p>', { mode: 'regex', pattern: 'three four five' }, {});
    expect(r.html).toBe('<p><b>one <i>two </i></b><mark><b><i>three</i></b> four <u>five</u></mark><u> six</u></p>');
  });

  it('wraps each block separately when text crosses blocks, or the whole blocks with snapToBlock', async () => {
    const html = '<p>one two</p><p>three four</p>';
    const config: SelectorConfig = { mode: 'regex', pattern: 'two\\nthree' };
    const split = await apply(html, config, {});
    expect(split.html).toBe('<p>one <mark>two</mark></p><p><mark>three</mark> four</p>');
    expect(split.applied).toBe(2);

    const snapped = await apply(html, config, { template: '<div class="box">{{content}}</div>' }, { snapToBlock: true });
    expect(snapped.html).toBe('<div class="box"><p>one two</p><p>three four</p></div>');
    expect(snapped.applied).toBe(1);
  });

  it('tells pieces of a split selection apart with {{part}} and {{parts}}', async () => {
    const r = await apply('<p>a b</p><p>c d</p>', { mode: 'regex', pattern: 'b\\nc' }, {
      template: '<mark data-part="{{part}}/{{parts}}">{{content}}</mark>',
    });
    expect(r.html).toBe('<p>a <mark data-part="0/2">b</mark></p><p><mark data-part="1/2">c</mark> d</p>');
  });

  it('keeps the content (and warns) when the template has no {{content}}', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template: '<hr>' });
    expect(r.html).toBe('<hr><p>x</p>');
    expect(r.warnings).toEqual(['Test: the template has no {{content}}, so the selected content was kept after it']);
  });

  it('copies the content when {{content}} appears more than once', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template: '<div>{{content}}</div><aside>{{content}}</aside>' });
    expect(r.html).toBe('<div><p>x</p></div><aside><p>x</p></aside>');
  });
});

describe('overlapping and nested selections', () => {
  it('wraps two overlapping text selections by splitting the first wrapper', async () => {
    const r = await apply(
      '<p>The basic plan costs nothing.</p>',
      [{ mode: 'regex', pattern: 'plan costs' }, { mode: 'regex', pattern: 'costs nothing' }],
      {},
    );
    expect(r.html).toBe('<p>The basic <mark>plan </mark><mark><mark>costs</mark> nothing</mark>.</p>');
  });

  it('nests a paragraph inside its section the same way in either order', async () => {
    const html = '<h2>Pricing</h2><p>Free.</p><p>Pro.</p><h2>Next</h2>';
    const section: SelectorConfig = { mode: 'heading', text: 'Pricing' };
    const para: SelectorConfig = { mode: 'css', selector: 'h2 + p' };
    const template = '<div class="w{{number}}">{{content}}</div>';
    const a = await apply(html, [section, para], { template });
    const b = await apply(html, [para, section], { template });
    expect(a.html).toBe('<div class="w1"><h2>Pricing</h2><div class="w2"><p>Free.</p></div><p>Pro.</p></div><h2>Next</h2>');
    expect(b.html).toBe('<div class="w2"><h2>Pricing</h2><div class="w1"><p>Free.</p></div><p>Pro.</p></div><h2>Next</h2>');
  });

  it('applies to text inside an element that another match already wrapped', async () => {
    const r = await apply('<p>Hello world</p>', [{ mode: 'css', selector: 'p' }, { mode: 'regex', pattern: 'world' }], {
      template: '<b>{{content}}</b>',
    });
    expect(r.html).toBe('<b><p>Hello <b>world</b></p></b>');
  });

  it('handles many matches in one paragraph', async () => {
    const r = await apply('<p>a1 b2 c3 d4</p>', { mode: 'regex', pattern: '\\d' }, { template: '<sup>{{content}}</sup>' });
    expect(r.html).toBe('<p>a<sup>1</sup> b<sup>2</sup> c<sup>3</sup> d<sup>4</sup></p>');
  });
});

describe('prepend, append and replace', () => {
  it('inserts before or after the selection', async () => {
    const before = await apply('<h2>A</h2><p>x</p>', { mode: 'css', selector: 'p' }, { mode: 'prepend', template: '<hr>' });
    expect(before.html).toBe('<h2>A</h2><hr><p>x</p>');
    const after = await apply('<p>x</p><p>y</p>', { mode: 'css', selector: 'p' }, { mode: 'append', template: '<small>({{text}})</small>' });
    expect(after.html).toBe('<p>x</p><small>(x)</small><p>y</p><small>(y)</small>');
  });

  it('inserts inside elements with `inside`', async () => {
    const r = await apply('<h2>Pricing</h2>', { mode: 'css', selector: 'h2' }, {
      mode: 'prepend', inside: true, template: '<span class="icon">#</span>',
    });
    expect(r.html).toBe('<h2><span class="icon">#</span>Pricing</h2>');
    const end = await apply('<h2>Pricing</h2>', { mode: 'css', selector: 'h2' }, { mode: 'append', inside: true, template: ' <a href="#top">↑</a>' });
    expect(end.html).toBe('<h2>Pricing<a href="#top">↑</a></h2>');
  });

  it('inserts next to selected text', async () => {
    const r = await apply('<p>Read the docs today.</p>', { mode: 'regex', pattern: 'the docs' }, { mode: 'append', template: '<sup>1</sup>' });
    expect(r.html).toBe('<p>Read the docs<sup>1</sup> today.</p>');
  });

  it('replaces content, and {{content}} brings the original back', async () => {
    const gone = await apply('<p>costs nothing</p><p>keep</p>', { mode: 'regex', pattern: 'costs nothing' }, {
      mode: 'replace', template: '{{params.word}}', params: [{ name: 'word', type: 'text', default: 'is free' }],
    });
    expect(gone.html).toBe('<p>is free</p><p>keep</p>');
    const struck = await apply('<p>old price</p>', { mode: 'regex', pattern: 'old' }, { mode: 'replace', template: '<del>{{content}}</del> new' });
    expect(struck.html).toBe('<p><del>old</del> new price</p>');
  });
});

describe('attributes', () => {
  it('adds attributes to elements and merges classes and styles', async () => {
    const r = await apply('<h2 class="title" style="color: red">A</h2>', { mode: 'css', selector: 'h2' }, {
      mode: 'attributes', template: 'class="hl title" style="font-weight: bold" title="{{text}}" data-n="{{number}}"',
    });
    expect(r.html).toBe('<h2 class="title hl" style="color: red; font-weight: bold" title="A" data-n="1">A</h2>');
  });

  it('wraps selected text in a <span> that gets the attributes', async () => {
    const r = await apply('<p>a <em>bold</em> move</p>', { mode: 'regex', pattern: 'bold move' }, {
      mode: 'attributes', template: 'class="hl"',
    });
    expect(r.html).toBe('<p>a <span class="hl"><em>bold</em> move</span></p>');
  });

  it('refuses event handlers and data-json-path, and warns about empty templates', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { mode: 'attributes', template: 'onclick="x()" data-json-path="$.a" class="ok"' });
    expect(r.html).toBe('<p class="ok">x</p>');
    expect(r.warnings).toEqual(['Removed onclick attribute', 'data-json-path cannot be changed by a snippet']);
    const empty = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { mode: 'attributes', template: '  ' });
    expect(empty.warnings).toEqual(['The attributes template is empty']);
  });
});

describe('parameters', () => {
  const params: Snippet['params'] = [
    { name: 'variant', type: 'select', options: ['info', 'warn'], default: 'info' },
    { name: 'size', type: 'number', default: 2 },
    { name: 'open', type: 'boolean' },
    { name: 'label', type: 'text' },
  ];
  const template = '<div class="{{params.variant}}" data-size="{{params.size}}" data-open="{{params.open}}">{{params.label}}{{content}}</div>';

  it('uses defaults, coerces types and checks select options', async () => {
    const defaults = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template, params });
    expect(defaults.html).toBe('<div class="info" data-size="2" data-open="false"><p>x</p></div>');

    const given = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template, params }, {
      params: { variant: 'warn', size: '5', open: 'true', label: 'Note: ' },
    });
    expect(given.html).toBe('<div class="warn" data-size="5" data-open="true">Note: <p>x</p></div>');

    const bad = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template, params }, {
      params: { variant: 'nope', size: 'big', extra: 1 },
    });
    expect(bad.html).toBe('<div class="info" data-size="2" data-open="false"><p>x</p></div>');
    expect(bad.warnings).toEqual([
      'Unknown parameter "extra"',
      'Parameter "variant" must be one of info, warn',
      'Parameter "size" must be a number',
    ]);
  });

  it('escapes parameter values', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template, params }, { params: { label: '<img src=x onerror=alert(1)>' } });
    expect(r.html).toContain('&#x3C;img src=x onerror=alert(1)>');
    expect(r.html).not.toContain('<img');
  });
});

describe('JSON field blocks', () => {
  const json = () => importJson(fixture('sample.json'), { mode: 'fields', fields: [{ path: '$.faq[*].a', format: 'markdown' }] });

  it('wraps outside the field block and exposes {{jsonPath}}', async () => {
    const doc = await json();
    const r = await applySnippet(select(doc, { mode: 'jsonField', path: '$.faq[0].a' }), snippet({
      template: '<details data-from="{{jsonPath}}"><summary>Answer</summary>{{content}}</details>',
    }));
    expect(serialize(r.document)).toMatch(
      /^<details data-from="\$\.faq\[0\]\.a"><summary>Answer<\/summary><div data-json-path="\$\.faq\[0\]\.a"><p>Yes/,
    );
  });

  it('replaces inside the field block instead of removing it', async () => {
    const doc = await json();
    const r = await applySnippet(select(doc, { mode: 'jsonField', path: '$.faq[*].a' }), snippet({ mode: 'replace', template: '<p>Hidden</p>' }));
    expect(serialize(r.document)).toBe('<div data-json-path="$.faq[0].a"><p>Hidden</p></div><div data-json-path="$.faq[1].a"><p>Hidden</p></div>');
  });

  it('keeps text selections inside their field', async () => {
    const doc = await importJson('{"a":"one two","b":"three four"}', { mode: 'fields', fields: [{ path: '$.*', format: 'text', blockTag: 'p' }] });
    const r = await applySnippet(select(doc, { mode: 'regex', pattern: 'two\\nthree' }), snippet({}));
    expect(serialize(r.document)).toBe('<p data-json-path="$.a">one <mark>two</mark></p><p data-json-path="$.b"><mark>three</mark> four</p>');
  });
});

describe('snippet CSS and JS', () => {
  it('collects them once per snippet version, and full pages include them', async () => {
    const doc = parseHtml('<h2>A</h2><p>x</p>');
    const callout = snippet({ id: 'callout', name: 'Callout', template: '<aside>{{content}}</aside>', css: 'aside{border:1px solid}', js: 'console.log("</script>")' });
    const first = await applySnippet(select(doc, { mode: 'css', selector: 'h2' }), callout);
    const second = await applySnippet(select(first.document, { mode: 'css', selector: 'p' }), callout);
    const third = await applySnippet(select(second.document, { mode: 'css', selector: 'aside' }), snippet({ id: 'mark', css: 'mark{}' }));
    expect(third.document.meta.snippetAssets?.map((a) => a.key)).toEqual(['callout@1', 'mark@1']);

    const page = serialize(third.document, { fullDocument: true });
    expect(page).toContain('<style data-snippet="callout@1">/* callout@1 */\naside{border:1px solid}</style><style data-snippet="mark@1">/* mark@1 */\nmark{}</style></head>');
    expect(page).toContain('<script data-snippet="callout@1">console.log("<\\/script>")</script></body>');
  });
});

describe('safety and errors', () => {
  it('never changes the selection or its document', async () => {
    const doc = parseHtml('<p>a <em>b c</em> d</p>');
    const before = JSON.stringify(doc);
    const sel = select(doc, { mode: 'regex', pattern: 'c d' });
    await applySnippet(sel, snippet({}));
    expect(JSON.stringify(doc)).toBe(before);
    expect(sel.document).toBe(doc);
  });

  it('cleans the template output', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template: '<div onclick="x()">{{content}}</div><script>alert(1)</script>' });
    expect(r.html).toBe('<div><p>x</p></div>');
    expect(r.warnings).toEqual(['Test: Removed onclick attribute from <div>', 'Test: Removed <script> element']);
  });

  it('reports template errors and leaves the document as it was', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template: '{{#if}}' });
    expect(r.html).toBe('<p>x</p>');
    expect(r.applied).toBe(0);
    expect(r.warnings[0]).toMatch(/^Test: template error: /);
  });

  it('warns when {{content}} is used inside an attribute', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'p' }, { template: '<span title="{{content}}">{{content}}</span>' });
    expect(r.warnings).toEqual(['Test: {{content}} cannot be used inside an attribute; use {{text}}']);
  });

  it('does nothing for an empty selection', async () => {
    const r = await apply('<p>x</p>', { mode: 'css', selector: 'h1' }, {});
    expect(r).toMatchObject({ html: '<p>x</p>', applied: 0, warnings: [] });
  });
});
