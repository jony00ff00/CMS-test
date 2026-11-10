import { describe, expect, it } from 'vitest';
import {
  applySnippet, createAnchor, elementMatch, highlightSelection, imagesOf, indexDocument, parseHtml, resolveAnchor, runSelector, serialize,
  type CmsDocument, type Snippet,
} from '../../src/engine';

const html =
  '<h1>Pictures</h1>' +
  '<p>Intro <img src="a.png" alt="A red fox"> text.</p>' +
  '<figure><a href="https://example.com"><img src="photos/b%20c.jpg" alt="A blue bird"></a><figcaption>Bird</figcaption></figure>' +
  '<p><img src="data:image/png;base64,AAAA" alt=""></p>';
const doc = () => parseHtml(html);
const picked = (d: CmsDocument, config: Parameters<typeof runSelector>[1]) => runSelector(d, config).matches.map((m) => serialize({ ...d, tree: { type: 'root', children: [nodeAt(d, m.match)] } } as CmsDocument));
const nodeAt = (d: CmsDocument, m: { kind: string; parent?: number[]; start?: number }) => {
  let n: any = d.tree;
  for (const i of [...m.parent!, m.start!]) n = n.children[i];
  return n;
};

describe('Selector: images', () => {
  it('selects every image, in document order', () => {
    const r = runSelector(doc(), { mode: 'image' });
    expect(r.warnings).toEqual([]);
    expect(picked(doc(), { mode: 'image' })).toEqual(['<img src="a.png" alt="A red fox">', '<img src="photos/b%20c.jpg" alt="A blue bird">', '<img src="data:image/png;base64,AAAA" alt="">']);
  });

  it('by number, and by alternative text or file name', () => {
    expect(picked(doc(), { mode: 'image', images: '2-3' })).toHaveLength(2);
    expect(picked(doc(), { mode: 'image', text: 'FOX' })).toEqual(['<img src="a.png" alt="A red fox">']);
    expect(picked(doc(), { mode: 'image', text: 'b c.jpg' })).toHaveLength(1);
    expect(runSelector(doc(), { mode: 'image', images: '5' }).warnings).toEqual(['The document has 3 images: "5" goes beyond that']);
    expect(runSelector(doc(), { mode: 'image', images: 'x' }).warnings[0]).toBe('"x" is not an image number or range (e.g. 2-5)');
    expect(runSelector(doc(), { mode: 'image', text: 'cat' }).warnings).toEqual(['No image\'s alternative text or file name contains "cat"']);
    expect(runSelector(parseHtml('<p>None</p>'), { mode: 'image' }).warnings).toEqual(['This document has no images']);
  });

  it('with its link and figure: the figure, caption included; an image in a paragraph stays alone', () => {
    const framed = picked(doc(), { mode: 'image', scope: 'frame' });
    expect(framed[0]).toBe('<img src="a.png" alt="A red fox">');
    expect(framed[1]).toMatch(/^<figure><a href="https:\/\/example.com"><img[^>]*><\/a><figcaption>Bird<\/figcaption><\/figure>$/);
  });

  it('selected images can be highlighted and wrapped by snippets', async () => {
    const sel = runSelector(doc(), { mode: 'image', text: 'fox' });
    expect(serialize(await highlightSelection(sel))).toContain('<img src="a.png" alt="A red fox" data-cms-match');
    const wrap: Snippet = { kind: 'snippet', id: 'w', name: 'W', version: 1, mode: 'wrap', template: '<span class="pic">{{content}}</span>', params: [] };
    expect(serialize((await applySnippet(sel, wrap)).document)).toContain('<p>Intro <span class="pic"><img src="a.png" alt="A red fox"></span> text.</p>');
  });
});

describe('anchors for images', () => {
  const imagePath = (d: CmsDocument, n: number) => imagesOf(indexDocument(d))[n - 1].path;

  it('store the image, and find it again after content is added above it', () => {
    const anchor = createAnchor(doc(), elementMatch(imagePath(doc(), 1)));
    expect(anchor.image).toEqual({ src: 'a.png', alt: 'A red fox', number: 1 });
    expect(resolveAnchor(doc(), anchor)).toMatchObject({ status: 'exact', confidence: 1 });

    const changed = parseHtml(`<p><img src="new.png" alt="New"></p>${html}`);
    const r = resolveAnchor(changed, anchor);
    expect(r.status).toBe('moved');
    expect(nodeAt(changed, r.match as never).properties.src).toBe('a.png');
  });

  it('find an image whose file changed by its alternative text; fail when it is gone', () => {
    const anchor = createAnchor(doc(), elementMatch(imagePath(doc(), 1)));
    const swapped = parseHtml(html.replace('a.png', 'fox-2.png'));
    expect(resolveAnchor(swapped, anchor)).toMatchObject({ status: 'fuzzy', confidence: 0.8 });
    const gone = parseHtml(html.replace(/<img src="a.png"[^>]*>/, ''));
    expect(resolveAnchor(gone, anchor)).toMatchObject({ status: 'failed', reason: 'The image "A red fox" was not found' });
  });

  it('a figure anchor finds the figure again; long data: URLs are stored as a hash', () => {
    const figure = createAnchor(doc(), elementMatch([2]));
    expect(figure.image?.alt).toBe('A blue bird');
    const moved = parseHtml(`<p>New</p>${html}`);
    const r = resolveAnchor(moved, figure);
    expect(nodeAt(moved, r.match as never).tagName).toBe('figure');

    const big = `data:image/png;base64,${'A'.repeat(1000)}`;
    const withBig = parseHtml(`<p><img src="${big}" alt=""></p>`);
    const a = createAnchor(withBig, elementMatch(imagesOf(indexDocument(withBig))[0].path));
    expect(a.image!.src).toMatch(/^#/);
    expect(resolveAnchor(withBig, a).status).toBe('exact');
  });

  it('manual selectors resolve image anchors', () => {
    const anchor = createAnchor(doc(), elementMatch(imagePath(doc(), 3)));
    const r = runSelector(doc(), { mode: 'manual', anchors: [anchor] });
    expect(r.matches).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });
});
