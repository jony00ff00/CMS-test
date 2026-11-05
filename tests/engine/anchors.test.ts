import { describe, expect, it } from 'vitest';
import {
  createAnchor, importDocx, importJson, indexDocument, parseHtml, resolveAnchor, runSelector, textOf,
  type Anchor, type CmsDocument, type Match, type ResolvedAnchor,
} from '../../src/engine';
import { fixture } from './helpers';

const sampleHtml = () => fixture('sample.html').toString();

/** The first match of a selector, as a Match. */
const pick = (doc: CmsDocument, config: Parameters<typeof runSelector>[1], n = 0): Match =>
  runSelector(doc, config).matches[n].match;

const textAt = (doc: CmsDocument, r: ResolvedAnchor) => (r.match ? textOf(indexDocument(doc), r.match) : undefined);

/** Anchors on a few kinds of target in the sample page. */
function sampleAnchors(doc: CmsDocument) {
  return {
    phrase: createAnchor(doc, pick(doc, { mode: 'regex', pattern: 'costs nothing' }), { id: 'phrase' }),
    paragraph: createAnchor(doc, pick(doc, { mode: 'css', selector: 'h2 + p' }), { id: 'paragraph' }),
    section: createAnchor(doc, pick(doc, { mode: 'heading', text: 'Pricing' }), { id: 'section' }),
    heading: createAnchor(doc, pick(doc, { mode: 'css', selector: 'h2' }), { id: 'heading' }),
    cell: createAnchor(doc, pick(doc, { mode: 'css', selector: 'td' }, 2), { id: 'cell' }),
  };
}

describe('createAnchor', () => {
  it('stores a quote with context and the strategies that apply', () => {
    const doc = parseHtml(sampleHtml());
    const { phrase, section, paragraph } = sampleAnchors(doc);
    expect(phrase).toMatchObject({
      id: 'phrase',
      target: 'text',
      textQuote: { exact: 'costs nothing', prefix: expect.stringMatching(/The basic plan $/), suffix: expect.stringMatching(/^\. The pro/) },
    });
    expect(phrase.structural).toBeUndefined();
    expect(paragraph).toMatchObject({
      target: 'nodes',
      structural: { parent: [], start: 3, end: 4, tagName: 'p' },
      css: { selector: 'p:nth-of-type(2)', depth: 1 },
    });
    expect(section.semantic).toEqual({ headingText: 'Pricing', level: 2, scope: 'section' });
    expect(sampleAnchors(doc).heading.semantic).toEqual({ headingText: 'Getting started', level: 2, scope: 'block' });
  });

  it('is plain JSON, so projects can be saved', () => {
    const { section } = sampleAnchors(parseHtml(sampleHtml()));
    expect(JSON.parse(JSON.stringify(section))).toEqual(section);
  });

  it('uses ids in CSS paths when there are some', () => {
    const doc = parseHtml('<div id="main"><section><p>a</p><p>b</p></section></div>');
    expect(createAnchor(doc, pick(doc, { mode: 'css', selector: 'p' }, 1)).css).toEqual({
      selector: '#main > section:nth-of-type(1) > p:nth-of-type(2)',
    });
  });

  it('generates unique ids', () => {
    const doc = parseHtml('<p>a</p>');
    const match = pick(doc, { mode: 'css', selector: 'p' });
    expect(createAnchor(doc, match).id).not.toBe(createAnchor(doc, match).id);
  });
});

describe('resolveAnchor', () => {
  const resolveAll = (anchors: Record<string, Anchor>, doc: CmsDocument) =>
    Object.fromEntries(Object.entries(anchors).map(([k, a]) => [k, resolveAnchor(doc, a)]));

  it('finds everything exactly in an unchanged document', () => {
    const doc = parseHtml(sampleHtml());
    for (const r of Object.values(resolveAll(sampleAnchors(doc), doc))) {
      expect(r).toMatchObject({ status: 'exact', confidence: 1 });
    }
  });

  it('follows content when a paragraph is inserted above it', () => {
    const original = parseHtml(sampleHtml());
    const anchors = sampleAnchors(original);
    const edited = parseHtml(sampleHtml().replace('<h2>Getting started</h2>', '<p>A brand new opening paragraph.</p><h2>Getting started</h2>'));
    const results = resolveAll(anchors, edited);
    for (const [name, r] of Object.entries(results)) {
      expect(r.status, name).toBe('moved');
      expect(r.confidence, name).toBeGreaterThanOrEqual(0.9);
      expect(textAt(edited, r), name).toBe(anchors[name as keyof typeof anchors].textQuote!.exact);
    }
    // The structural path now points at the inserted paragraph, so another strategy must have been used.
    expect(results.paragraph.strategy).not.toBe('structural');
    expect(results.paragraph.match).toEqual({ kind: 'nodes', parent: [], start: 4, end: 5 });
  });

  it('still finds text after a typo is fixed', () => {
    const withTypos = sampleHtml().replace('costs nothing', 'costs nothng').replace('Plant a source node', 'Plant a sorce node');
    const original = parseHtml(withTypos);
    const anchors = {
      phrase: createAnchor(original, pick(original, { mode: 'regex', pattern: 'costs nothng' })),
      paragraph: createAnchor(original, pick(original, { mode: 'css', selector: 'h2 + p' })),
    };
    const fixed = parseHtml(sampleHtml());

    const phrase = resolveAnchor(fixed, anchors.phrase);
    expect(phrase).toMatchObject({ status: 'fuzzy', strategy: 'fuzzy' });
    expect(phrase.confidence).toBeGreaterThan(0.85);
    expect(textAt(fixed, phrase)).toBe('costs nothing');

    const paragraph = resolveAnchor(fixed, anchors.paragraph);
    expect(paragraph.status).toBe('fuzzy');
    expect(paragraph.match).toEqual({ kind: 'nodes', parent: [], start: 3, end: 4 });
  });

  it('keeps a heading section when content inside it changes', () => {
    const original = parseHtml(sampleHtml());
    const { section } = sampleAnchors(original);
    const edited = parseHtml(
      sampleHtml().replace('<h2>Pricing</h2>', '<h2>Intro</h2><p>Moved down.</p><h2>Pricing</h2><p>Now with a free trial.</p>'),
    );
    const r = resolveAnchor(edited, section);
    expect(r).toMatchObject({ status: 'fuzzy', strategy: 'semantic' });
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(textAt(edited, r)!.split('\n').slice(0, 2)).toEqual(['Pricing', 'Now with a free trial.']);
  });

  it('tells repeated text apart by its context', () => {
    const html = '<p>Note: check twice.</p><h2>Billing</h2><p>Note: check twice.</p><p>Invoices go out monthly.</p>';
    const original = parseHtml(html);
    const second = createAnchor(original, pick(original, { mode: 'regex', pattern: 'Note: check twice' }, 1));
    const edited = parseHtml(`<p>Welcome.</p>${html}`);
    const r = resolveAnchor(edited, second);
    expect(r.status).toBe('moved');
    expect(r.match).toEqual({ kind: 'text', start: 36, end: 53 });
    expect(indexDocument(edited).text.text.slice(36 - 8, 36)).toBe('Billing\n');
  });

  it('fails, with a reason, when the content was rewritten', () => {
    const original = parseHtml(sampleHtml());
    const { phrase, paragraph } = sampleAnchors(original);
    const rewritten = parseHtml(
      sampleHtml()
        .replace('The basic plan costs nothing. The pro plan adds snippets.', 'Pricing will be announced soon.')
        .replace('Plant a source node first. Then connect a selector to it.', 'Ask your administrator for access.'),
    );
    const r1 = resolveAnchor(rewritten, phrase);
    expect(r1).toMatchObject({ status: 'failed', reason: '"costs nothing" was not found' });
    expect(r1.match).toBeUndefined();
    const r2 = resolveAnchor(rewritten, paragraph);
    expect(r2.status).toBe('failed');
    expect(r2.reason).toMatch(/^"Plant a source node first\. Then con\w*…" was not found$/);
    expect(r2.confidence).toBeLessThan(0.75);
  });

  it('names the closest match when there is a fairly close one', () => {
    const original = parseHtml('<p>Ship it on Friday morning.</p>');
    const anchor = createAnchor(original, pick(original, { mode: 'css', selector: 'p' }));
    const r = resolveAnchor(parseHtml('<p>Ship it some other day instead.</p>'), anchor);
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('Closest match "Ship it some other day instead." is too different from "Ship it on Friday morning."');
  });

  it('lets the caller choose how strict to be', () => {
    const original = parseHtml('<p>The quick brown fox jumps.</p>');
    const anchor = createAnchor(original, pick(original, { mode: 'css', selector: 'p' }));
    const edited = parseHtml('<p>The quick brown cat jumps.</p>');
    expect(resolveAnchor(edited, anchor).status).toBe('fuzzy');
    expect(resolveAnchor(edited, anchor, { minConfidence: 0.95 }).status).toBe('failed');
  });

  it('finds elements without text, such as images, by their position and surroundings', () => {
    const original = parseHtml(sampleHtml());
    const image = createAnchor(original, pick(original, { mode: 'css', selector: 'img' }));
    const edited = parseHtml(sampleHtml().replace('<h1>', '<p><img src="other.png" alt="Banner"></p><h1>'));
    const r = resolveAnchor(edited, image);
    expect(r.status).toBe('moved');
    expect(r.match).toEqual({ kind: 'nodes', parent: [8], start: 0, end: 1 });
  });

  it('resolves anchors made on the HTML sample in the .docx version of the same content', async () => {
    const html = parseHtml(sampleHtml());
    const anchors = sampleAnchors(html);
    const docx = await importDocx(fixture('sample.docx'));
    for (const [name, anchor] of Object.entries(anchors)) {
      const r = resolveAnchor(docx, anchor);
      expect(r.status, name).not.toBe('failed');
      expect(textAt(docx, r), name).toBe(anchor.textQuote!.exact);
    }
  });
});

describe('anchors in JSON sources', () => {
  const mapping = {
    mode: 'fields' as const,
    fields: [
      { path: '$.articles[*].body', format: 'html' as const },
      { path: '$.faq[*].a', format: 'markdown' as const },
    ],
  };

  it('survive reordering an array and renaming an unrelated key', async () => {
    const data = JSON.parse(fixture('sample.json').toString());
    const original = await importJson(JSON.stringify(data), mapping);
    const block = createAnchor(original, pick(original, { mode: 'jsonField', path: '$.articles[0].body' }));
    const phrase = createAnchor(original, pick(original, { mode: 'regex', pattern: 'never change' }));
    expect(block.jsonPath).toEqual({ path: '$.articles[0].body' });
    expect(phrase.jsonPath).toEqual({ path: '$.faq[1].a' });

    data.articles.reverse();
    data.faq.reverse();
    data.meta.slug = data.meta.id;
    delete data.meta.id;
    const edited = await importJson(JSON.stringify(data), mapping);

    const r1 = resolveAnchor(edited, block);
    expect(r1.status).toBe('moved');
    const el = r1.match!.kind === 'nodes' ? edited.tree.children[r1.match!.start] : undefined;
    expect(el?.type === 'element' && el.properties.dataJsonPath).toBe('$.articles[1].body');
    expect(textAt(edited, r1)).toBe('Plant a source node first. Then connect a selector to it.');

    const r2 = resolveAnchor(edited, phrase);
    expect(r2.status).toBe('moved');
    expect(textAt(edited, r2)).toBe('never change');
  });

  it('prefer the original field when the same text appears in several fields', async () => {
    const data = { a: 'Shared words here.', b: 'Shared words here.' };
    const map = { mode: 'fields' as const, fields: [{ path: '$.*', format: 'text' as const }] };
    const original = await importJson(JSON.stringify(data), map);
    const anchor = createAnchor(original, pick(original, { mode: 'regex', pattern: 'Shared' }, 1));
    expect(anchor.jsonPath).toEqual({ path: '$.b' });
    const edited = await importJson(JSON.stringify({ intro: 'Hello.', ...data }), map);
    const r = resolveAnchor(edited, anchor);
    expect(r.strategy).toBe('jsonPath');
    expect(r.match).toEqual({ kind: 'text', start: 26, end: 32 });
  });
});

describe('manual selector', () => {
  it('returns resolved matches with their status, and warns about anchors that need attention', () => {
    const original = parseHtml(sampleHtml());
    const { phrase, section } = sampleAnchors(original);
    const edited = parseHtml(sampleHtml().replace('costs nothing', 'is free'));
    const sel = runSelector(edited, { mode: 'manual', anchors: [phrase, section] });
    expect(sel.matches).toHaveLength(1);
    expect(sel.matches[0]).toMatchObject({ anchorId: 'section', text: expect.stringMatching(/^Pricing\n/) });
    expect(sel.warnings).toEqual(['A saved selection needs attention: "costs nothing" was not found']);
  });
});

describe('performance', () => {
  it('resolves anchors in a 3000-paragraph document quickly', () => {
    const para = (i: number) => `<p>Paragraph ${i} explains how the node graph evaluates selectors, snippets and outputs in order.</p>`;
    const html = Array.from({ length: 3000 }, (_, i) => para(i)).join('');
    const doc = parseHtml(html);
    const block = createAnchor(doc, pick(doc, { mode: 'css', selector: 'p' }, 1500));
    const phrase = createAnchor(doc, pick(doc, { mode: 'regex', pattern: 'Paragraph 2000 explains' }));
    const edited = parseHtml('<p>New first paragraph.</p>' + html.replace('Paragraph 2000 explains', 'Paragraph 2000 now explains'));
    const t = performance.now();
    const ix = indexDocument(edited);
    expect(resolveAnchor(ix, block).status).toBe('moved');
    expect(resolveAnchor(ix, phrase).status).toBe('fuzzy');
    // Typically about 150 ms; the limit leaves plenty of room for slow CI machines.
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
