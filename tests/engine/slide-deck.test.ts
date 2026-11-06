import { describe, expect, it } from 'vitest';
import { DECK_VIEWER, GraphEvaluator, importPptx, nodeRegistry, parseHtml, serialize, storeFile, toSlideDeck } from '../../src/engine';
import { fixture } from './helpers';

const sections = (html: string) => [...html.matchAll(/<section class="slide" data-slide="(\d+)"/g)].map((m) => Number(m[1]));

describe('slide decks', () => {
  it('keeps a deck’s own slides and adds the viewer once', async () => {
    const doc = await importPptx(new Uint8Array(fixture('sample.pptx')));
    const deck = toSlideDeck(doc);
    expect(deck.slides).toBe(14);
    expect(deck.warnings).toEqual([]);
    expect(toSlideDeck(deck.document).document.meta.snippetAssets?.filter((a) => a.key === DECK_VIEWER.key)).toHaveLength(1);
    const page = serialize(deck.document, { fullDocument: true });
    expect(page).toContain('html.cms-deck section.slide:not(.cms-current){display:none!important}');
    expect(page).toContain("d.querySelectorAll('section.slide')");
    expect(doc.meta.snippetAssets ?? []).not.toContainEqual(DECK_VIEWER); // the input is not changed
  });

  it('splits other documents at their top-level headings', () => {
    const doc = parseHtml('<p>Intro</p><h1>Title</h1><p>a</p><h2>Part</h2><h3>Sub</h3><p>b</p>');
    const deck = toSlideDeck(doc);
    const html = serialize(deck.document);
    expect(sections(html)).toEqual([1, 2, 3]);
    expect(html).toBe(
      '<section class="slide" data-slide="1"><p>Intro</p></section><section class="slide" data-slide="2"><h1>Title</h1><p>a</p></section><section class="slide" data-slide="3"><h2>Part</h2><h3>Sub</h3><p>b</p></section>',
    );
    expect(deck.warnings).toEqual(['The document has no slides, so a new slide starts at each top-level heading (3 slides)']);
    expect(serialize(doc)).not.toContain('section'); // the input is not changed
  });

  it('also starts a slide at a block that begins with a heading (e.g. a callout around it)', () => {
    const deck = toSlideDeck(parseHtml('<h1>T</h1><p>x</p><aside class="callout"><div><h2>A</h2></div><p>in</p></aside><p>a</p><div><p>no</p><h2>later</h2></div>'));
    expect(deck.slides).toBe(2);
    expect(serialize(deck.document)).toContain('<section class="slide" data-slide="2"><aside class="callout">');
  });

  it('makes one slide of a document without headings, and says when it is empty', () => {
    expect(toSlideDeck(parseHtml('<p>Just text</p>')).warnings).toEqual(['The document has no slides or top-level headings, so it is one slide']);
    expect(toSlideDeck(parseHtml('  ')).warnings).toEqual(['The document is empty, so the deck has no slides']);
  });

  it('warns about content outside the slides; slides wrapped by a snippet still count', () => {
    const doc = parseHtml('<p>Banner</p><div class="callout"><section class="slide" data-slide="1"><h2>A</h2></section></div><section class="slide" data-slide="2"><h2>B</h2></section>');
    const deck = toSlideDeck(doc);
    expect(deck.slides).toBe(2);
    expect(deck.warnings).toEqual(['1 block is outside the slides, so it is not shown in the deck (they are in the page without JavaScript)']);
  });

  it('is an Output format', async () => {
    const file = storeFile('deck.pptx', new Uint8Array(fixture('sample.pptx')), 'deck');
    const graph = {
      nodes: [
        { id: 'src', type: 'documentSource', config: { fileId: 'deck' } },
        { id: 'out', type: 'output', config: { format: 'slides', fullDocument: false } },
      ],
      edges: [{ id: 'e', source: 'src', sourcePort: 'document', target: 'out', targetPort: 'document' }],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files: { deck: file } });
    expect(results.out.info).toMatchObject({ format: 'slides', slides: 14 });
    const html = results.out.outputs.html as string;
    expect(html.startsWith('<!doctype html>')).toBe(true); // always a complete page
    expect(html).toContain('/* cms-slide-deck@1 */');
  });
});
