import { describe, expect, it } from 'vitest';
import {
  buildInsertion, buildTextIndex, caretTarget, insertionPointAt, checkUrl, createAnchor, embedUrl, exportJson, GraphEvaluator, importJson, insertContent, markInsertionPoint,
  mediaType, nodeRegistry, parseHtml, runSelector, serialize, storeFile, type CmsDocument, type Graph, type InsertContent,
  type InsertWhere,
} from '../../src/engine';
import { PNG_BASE64 } from '../../src/samples';
import { fixture } from './helpers';

const png = storeFile('logo.png', Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0)), 'png');
const mp4 = storeFile('clip.mp4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'mp4');
const files = { png, mp4 };
const html = () => parseHtml(fixture('sample.html').toString());

/** A point picked the way the preview does it: the text right before the cursor, inserting after it. */
function caretAfter(doc: CmsDocument, before: string): InsertWhere {
  const m = runSelector(doc, { mode: 'regex', pattern: before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).matches[0].match;
  return { mode: 'point', point: { anchor: createAnchor(doc, m), place: 'after' } };
}
function block(doc: CmsDocument, selector: string, place: 'before' | 'after' | 'start' | 'end', n = 0): InsertWhere {
  return { mode: 'point', point: { anchor: createAnchor(doc, runSelector(doc, { mode: 'css', selector }).matches[n].match), place } };
}
const body = async (doc: CmsDocument, where: InsertWhere, content: InsertContent) => {
  const r = await insertContent(doc, where, content, files);
  return { ...r, html: serialize(r.document) };
};

describe('building insertions', () => {
  it('says what is missing before anything can be inserted', () => {
    expect(buildInsertion({ kind: 'code', code: ' ', render: 'block' }, files)).toEqual({ waiting: 'Write the code to insert' });
    expect(buildInsertion({ kind: 'image', alt: '' }, files)).toEqual({ waiting: 'Choose an image file' });
    expect(buildInsertion({ kind: 'video' }, files)).toEqual({ waiting: 'Choose a video file' });
    expect(buildInsertion({ kind: 'imageUrl', url: '', alt: '' }, files)).toEqual({ waiting: 'Enter the address of the image or video' });
    expect(buildInsertion({ kind: 'image', fileId: 'gone', alt: '' }, files)).toMatchObject({ waiting: expect.stringMatching(/no longer in the project/) });
  });

  it('refuses the wrong kind of file and addresses that are not web addresses', () => {
    expect(buildInsertion({ kind: 'image', fileId: 'mp4', alt: '' }, files)).toMatchObject({ error: expect.stringMatching(/^clip\.mp4 is not an image/) });
    expect(checkUrl('javascript:alert(1)')).toEqual({ error: 'Only http and https addresses can be used' });
    expect(checkUrl('data:image/png;base64,xx')).toEqual({ error: 'Only http and https addresses can be used' });
    expect(checkUrl('example.com/a.png')).toEqual({ href: 'https://example.com/a.png' });
    expect(checkUrl('http://[nope')).toMatchObject({ error: expect.stringMatching(/is not a web address/) });
  });

  it('recognises image and video files', () => {
    expect(mediaType('a.JPG')).toEqual({ kind: 'image', contentType: 'image/jpeg' });
    expect(mediaType('b.webm')).toEqual({ kind: 'video', contentType: 'video/webm' });
    expect(mediaType('c.pdf')).toBeUndefined();
  });

  it('embeds YouTube and Vimeo links', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'https://m.youtube.com/shorts/dQw4w9WgXcQ']) {
      expect(embedUrl(url), url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
    expect(embedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(embedUrl('https://example.com/movie.mp4')).toBeUndefined();
  });
});

describe('widths', () => {
  it('accepts any CSS unit, treats a plain number as pixels, and defaults to 100%', async () => {
    const { cssWidth } = await import('../../src/engine');
    expect(cssWidth(undefined)).toEqual({ value: '100%' });
    expect(cssWidth('')).toEqual({ value: '100%' });
    expect(cssWidth('  ')).toEqual({ value: '100%' });
    expect(cssWidth(320)).toEqual({ value: '320px' });
    expect(cssWidth('320')).toEqual({ value: '320px' });
    expect(cssWidth('12.5em')).toEqual({ value: '12.5em' });
    expect(cssWidth('2.5 REM')).toEqual({ value: '2.5rem' });
    expect(cssWidth('50%')).toEqual({ value: '50%' });
    expect(cssWidth('40vw')).toEqual({ value: '40vw' });
    expect(cssWidth('.5in')).toEqual({ value: '0.5in' });
    expect(cssWidth('auto')).toEqual({ value: 'auto' });
  });

  it('warns and uses 100% for anything that is not a width', async () => {
    const { cssWidth } = await import('../../src/engine');
    expect(cssWidth('wide')).toEqual({ value: '100%', warning: '"wide" is not a width (use for example 320px, 20em or 50%); using 100%' });
    expect(cssWidth('10furlongs')).toMatchObject({ value: '100%', warning: expect.stringMatching(/^"furlongs" is not a unit/) });
    expect(cssWidth('0')).toMatchObject({ value: '100%', warning: 'A width of 0 would hide it; using 100%' });
    expect(cssWidth('calc(100% - 2em)')).toMatchObject({ value: '100%', warning: expect.any(String) });
    expect(cssWidth(-5)).toMatchObject({ value: '100%' });
  });

  it('puts the width on the image, the figure (with a caption) or the image inside a link', async () => {
    const doc = html();
    const where = block(doc, 'h1', 'after');
    const plain = await body(doc, where, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A', width: '20em' });
    expect(plain.html).toContain('<img src="https://x.test/a.png" alt="A" class="cms-insert" loading="lazy" style="width:20em">');
    const captioned = await body(doc, where, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A', width: '50%', caption: 'Hi' });
    expect(captioned.html).toContain('<figure class="cms-figure" style="width:50%"><img src="https://x.test/a.png" alt="A" class="cms-insert" loading="lazy" style="width:100%"><figcaption>Hi</figcaption>');
    const linked = await body(doc, where, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A', width: 240, href: 'https://x.test/' });
    expect(linked.html).toContain('<a href="https://x.test/"><img src="https://x.test/a.png" alt="A" class="cms-insert" loading="lazy" style="width:240px"></a>');
    const bad = await body(doc, where, { kind: 'videoUrl', url: 'https://x.test/v.mp4', width: 'big' });
    expect(bad.html).toContain('style="width:100%"');
    expect(bad.warnings).toEqual(['"big" is not a width (use for example 320px, 20em or 50%); using 100%']);
  });
});

describe('inserting at a picked point', () => {
  it('puts an image right at the cursor', async () => {
    const doc = html();
    const r = await body(doc, caretAfter(doc, 'costs nothing'), { kind: 'imageUrl', url: 'https://example.com/free.png', alt: 'Free' });
    expect(r.html).toContain('<p>The basic plan costs nothing<img src="https://example.com/free.png" alt="Free" class="cms-insert" loading="lazy" style="width:100%">. The pro');
    expect(r.inserted).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it('puts an uploaded image in the page as an asset', async () => {
    const doc = html();
    const r = await insertContent(doc, block(doc, 'h2', 'after'), { kind: 'image', fileId: 'png', alt: 'Logo', caption: 'Our logo', width: 64 }, files);
    const page = serialize(r.document, { inlineAssets: true });
    expect(page).toContain('<h2>Getting started</h2><figure class="cms-figure" style="width:64px"><img src="data:image/png;base64,');
    expect(page).toContain('alt="Logo" class="cms-insert" style="width:100%"><figcaption>Our logo</figcaption></figure><p>Plant');
    expect(Object.keys(r.document.assets)).toEqual([`insert-${png.hash}`]);
    expect(serialize(r.document, { fullDocument: true })).toContain('.cms-figure{');
  });

  it('wraps a linked image in its link, and refuses unsafe links', async () => {
    const doc = html();
    const ok = await body(doc, caretAfter(doc, 'costs nothing'), { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A', href: 'https://x.test/' });
    expect(ok.html).toContain('costs nothing<a href="https://x.test/"><img src="https://x.test/a.png"');
    const bad = await body(doc, caretAfter(doc, 'costs nothing'), { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A', href: 'javascript:x()' });
    expect(bad.html).not.toContain('<a');
    expect(bad.warnings).toEqual(['The link "javascript:x()" is not a web address, so the image is not linked']);
  });

  it('puts videos and code blocks after the paragraph, not inside it', async () => {
    const doc = html();
    const video = await body(doc, caretAfter(doc, 'costs nothing'), { kind: 'video', fileId: 'mp4', autoplay: true, loop: true });
    expect(video.html).toContain('The pro plan adds snippets.</p><video src="asset:insert-');
    expect(video.html).toMatch(/<video src="asset:[^"]+" controls playsinline class="cms-insert" autoplay muted loop style="width:100%"><\/video><blockquote>/);
    expect(video.warnings).toEqual(['This content cannot go inside a paragraph, so it goes after it']);

    const code = await body(doc, block(doc, 'h2', 'end', 1), { kind: 'code', code: 'npm run build', language: 'shell', render: 'block' });
    expect(code.html).toContain('<h2>Pricing</h2><pre class="cms-insert-code" data-language="shell"><code class="language-shell">npm run build</code></pre>');
  });

  it('inserts at the start or end inside a container', async () => {
    const doc = html();
    const r = await body(doc, block(doc, 'ol', 'end'), { kind: 'code', code: '<li>Export the page</li>', render: 'html' });
    expect(r.html).toContain('<li>Apply a snippet</li><li>Export the page</li></ol>');
    const s = await body(doc, block(doc, 'blockquote', 'start'), { kind: 'code', code: '<p><b>Motto</b></p>', render: 'html' });
    expect(s.html).toContain('<blockquote><p><b>Motto</b></p><p>Every node');
  });

  it('cleans inserted HTML', async () => {
    const doc = html();
    const r = await body(doc, block(doc, 'h1', 'after'), { kind: 'code', code: '<div onclick="x()">Hi</div><script>alert(1)</script>', render: 'html' });
    expect(r.html).toContain('<h1>Field Guide to Node Gardens</h1><div>Hi</div><p>');
    expect(r.warnings).toEqual(['Removed onclick attribute from <div>', 'Removed <script> element']);
  });

  it('embeds a YouTube link and warns that the preview may not play it', async () => {
    const doc = html();
    const r = await body(doc, block(doc, 'h1', 'after'), { kind: 'videoUrl', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Demo' });
    expect(r.html).toContain('<figure class="cms-figure" style="width:100%"><div class="cms-embed" style="width:100%"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Demo"');
    expect(r.warnings[0]).toMatch(/may not play in the preview/);
    const file = await body(doc, block(doc, 'h1', 'after'), { kind: 'videoUrl', url: 'https://example.com/movie.mp4' });
    expect(file.html).toContain('<video src="https://example.com/movie.mp4" controls playsinline class="cms-insert" preload="metadata" style="width:100%"></video>');
  });

  it('follows the text when the document changes, and asks for attention when it is gone', async () => {
    const doc = html();
    const where = caretAfter(doc, 'costs nothing');
    const edited = parseHtml(fixture('sample.html').toString().replace('<h2>Pricing</h2>', '<p>New paragraph.</p><h2>Pricing</h2>'));
    const moved = await body(edited, where, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: '' });
    expect(moved.html).toContain('costs nothing<img src="https://x.test/a.png"');

    const gone = parseHtml(fixture('sample.html').toString().replace('The basic plan costs nothing.', 'Ask us.'));
    const r = await body(gone, where, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A' });
    expect(r).toMatchObject({ inserted: 0, needsAttention: true });
    expect(r.warnings[0]).toMatch(/^The insertion point needs attention: /);
    expect(r.html).toBe(serialize(gone));
  });

  it('waits for a point to be picked', async () => {
    const r = await insertContent(html(), { mode: 'point' }, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A' }, files);
    expect(r.waiting).toBe('Click in the preview where the insertion should go');
  });

  it('never changes the document it is given', async () => {
    const doc = html();
    const before = JSON.stringify(doc);
    await insertContent(doc, caretAfter(doc, 'costs nothing'), { kind: 'image', fileId: 'png', alt: 'x' }, files);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('inserting at every match of a selector', () => {
  it('inserts next to each match, once per paragraph for block content', async () => {
    const doc = html();
    const after = await body(doc, { mode: 'selector', selector: { mode: 'css', selector: 'h2' }, place: 'after' }, { kind: 'code', code: '<hr>', render: 'html' });
    expect(after.html.match(/<\/h2><hr>/g)).toHaveLength(2);
    const perParagraph = await body(doc, { mode: 'selector', selector: { mode: 'regex', pattern: 'plan' }, place: 'after' }, { kind: 'video', fileId: 'mp4' });
    expect(perParagraph.inserted).toBe(1); // both matches are in one paragraph
    const nothing = await body(doc, { mode: 'selector', selector: { mode: 'css', selector: 'video' }, place: 'after' }, { kind: 'code', code: 'x', render: 'block' });
    expect(nothing.warnings).toEqual(['"video" matched nothing']);
  });
});

describe('JSON sources', () => {
  it('inserts inside a field, so it is written back with that field', async () => {
    const doc = await importJson(fixture('sample.json'), { mode: 'fields', fields: [{ path: '$.faq[*].a', format: 'markdown' }] });
    const r = await insertContent(doc, { mode: 'selector', selector: { mode: 'jsonField', path: '$.faq[0].a' }, place: 'end' }, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'Diagram' }, files);
    const exported = await exportJson(r.document);
    expect(exported.changed).toEqual(['$.faq[0].a']);
    expect((exported.data as { faq: { a: string }[] }).faq[0].a).toBe(
      '<p>Yes. Map <strong>string fields</strong> with JSONPath.</p><img src="https://x.test/a.png" alt="Diagram" class="cms-insert" loading="lazy" style="width:100%">',
    );
  });
});

describe('preview marker', () => {
  it('marks where the insertion goes, with an element the preview ignores', async () => {
    const doc = html();
    const caret = serialize(await markInsertionPoint(doc, caretAfter(doc, 'costs nothing'), false));
    expect(caret).toContain('costs nothing<span data-cms-preview="" class="cms-insert-caret" title="Insertion goes here"></span>.');
    const after = serialize(await markInsertionPoint(doc, block(doc, 'h1', 'after'), false));
    expect(after).toContain('</h1><div data-cms-preview="" class="cms-insert-marker">Insertion goes here</div>');
  });
});

describe('Insert node', () => {
  it('runs in a graph and re-runs when its uploaded file changes', async () => {
    const source = storeFile('a.html', '<h2>A</h2><p>x</p>', 'src');
    const graph: Graph = {
      nodes: [
        { id: 's', type: 'documentSource', config: { fileId: 'src' } },
        { id: 'i', type: 'insert', config: { content: { kind: 'image', fileId: 'png', alt: 'Logo' }, where: { mode: 'selector', selector: { mode: 'css', selector: 'h2' }, place: 'after' } } },
        { id: 'o', type: 'output', config: { fullDocument: false } },
      ],
      edges: [
        { id: 'e1', source: 's', sourcePort: 'document', target: 'i', targetPort: 'document' },
        { id: 'e2', source: 'i', sourcePort: 'document', target: 'o', targetPort: 'document' },
      ],
    };
    const evaluator = new GraphEvaluator(nodeRegistry);
    const first = await evaluator.evaluate(graph, { files: { src: source, png } });
    expect(first.results.i.info).toEqual({ what: 'Image', inserted: 1 });
    expect(first.results.o.outputs.html).toMatch(/^<h2>A<\/h2><img src="data:image\/png;base64,/);
    const other = storeFile('logo.png', new Uint8Array([137, 80, 78, 71]), 'png');
    const second = await evaluator.evaluate(graph, { files: { src: source, png: other } });
    expect(second.ran).toEqual(['i', 'o']);
  });

  it('waits until there is something to insert', async () => {
    const graph: Graph = {
      nodes: [
        { id: 's', type: 'documentSource', config: { fileId: 'src' } },
        { id: 'i', type: 'insert', config: nodeRegistry.insert.defaultConfig() },
      ],
      edges: [{ id: 'e1', source: 's', sourcePort: 'document', target: 'i', targetPort: 'document' }],
    };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files: { src: storeFile('a.html', '<p>x</p>', 'src') } });
    expect(r.results.i).toMatchObject({ status: 'waiting', message: 'Enter the address of the image or video' });
  });
});

describe('picking a point from a cursor', () => {
  const offsetOf = (doc: CmsDocument, phrase: string) => buildTextIndex(doc.tree).text.indexOf(phrase) + phrase.length;

  it('names the block the cursor is in, also at its very end', () => {
    const doc = html();
    expect(caretTarget(doc, offsetOf(doc, 'costs'))).toEqual({ tagName: 'p', name: 'paragraph' });
    expect(caretTarget(doc, offsetOf(doc, 'Pricing'))).toEqual({ tagName: 'h2', name: 'heading' });
    expect(caretTarget(doc, offsetOf(doc, 'Select some text'))).toEqual({ tagName: 'li', name: 'list item' });
  });

  it('inserts at the cursor, before or after the block', async () => {
    const doc = html();
    const at = offsetOf(doc, 'costs nothing');
    const img: InsertContent = { kind: 'imageUrl', url: 'https://x.test/a.png', alt: '' };
    const cursor = await body(doc, { mode: 'point', point: insertionPointAt(doc, at, 'cursor') }, img);
    expect(cursor.html).toContain('costs nothing<img');
    const before = await body(doc, { mode: 'point', point: insertionPointAt(doc, at, 'before') }, img);
    expect(before.html).toContain('<h2>Pricing</h2><img src="https://x.test/a.png" alt="" class="cms-insert" loading="lazy" style="width:100%"><p>The basic');
    const after = await body(doc, { mode: 'point', point: insertionPointAt(doc, at, 'after') }, img);
    expect(after.html).toContain('adds snippets.</p><img');
  });

  it('starts the saved text before the cursor at a word boundary', () => {
    const doc = html();
    const point = insertionPointAt(doc, offsetOf(doc, 'Plant a source node first. Then'), 'cursor')!;
    expect(point.anchor.textQuote?.exact).toBe('source node first. Then');
  });

  it('works at the start of a block, using the text after the cursor', async () => {
    const doc = html();
    const start = buildTextIndex(doc.tree).text.indexOf('The basic');
    const point = insertionPointAt(doc, start, 'cursor')!;
    expect(point.place).toBe('before');
    expect(point.anchor.textQuote?.exact).toBe('The basic plan costs not');
    const r = await body(doc, { mode: 'point', point }, { kind: 'imageUrl', url: 'https://x.test/a.png', alt: '' });
    expect(r.html).toContain('<p><img src="https://x.test/a.png" alt="" class="cms-insert" loading="lazy" style="width:100%">The basic');
  });
});

describe('inserting selected content', () => {
  const target = parseHtml('<h1>Page</h1><p>First paragraph.</p><p>Last paragraph.</p>');
  const other = parseHtml('<h2>Note</h2><p>Some <strong>bold</strong> words here.</p><ul><li>one</li></ul>');
  const after = (selector: string): InsertWhere => ({ mode: 'selector', selector: { mode: 'css', selector }, place: 'after' });

  it('copies the matched elements, in document order, from another document', async () => {
    const sel = runSelector(other, { mode: 'css', selector: 'ul, h2' });
    const r = await insertContent(target, after('h1'), { kind: 'selection' }, {}, sel);
    expect(r.warnings).toEqual([]);
    expect(serialize(r.document)).toBe('<h1>Page</h1><h2>Note</h2><ul><li>one</li></ul><p>First paragraph.</p><p>Last paragraph.</p>');
    expect(serialize(other)).toContain('<h2>Note</h2>'); // the original is untouched
  });

  it('copies selected text with its inline formatting, and may go inside a paragraph', async () => {
    const sel = runSelector(other, { mode: 'regex', pattern: 'bold words' });
    const r = await insertContent(target, { mode: 'selector', selector: { mode: 'css', selector: 'p' }, place: 'end' }, { kind: 'selection' }, {}, sel);
    expect(serialize(r.document)).toContain('<p>First paragraph.<strong>bold</strong> words</p>');
    expect(r.inserted).toBe(2);
  });

  it('can copy part of the same document; block content goes next to a paragraph', async () => {
    const sel = runSelector(target, { mode: 'css', selector: 'h1' });
    const r = await insertContent(target, { mode: 'selector', selector: { mode: 'css', selector: 'p:last-child' }, place: 'end' }, { kind: 'selection' }, {}, sel);
    expect(serialize(r.document)).toBe('<h1>Page</h1><p>First paragraph.</p><p>Last paragraph.</p><h1>Page</h1>');
  });

  it('keeps snippet styles and images, drops JSON field paths from the copy', async () => {
    const doc = await importJson('{"a":"Hello"}');
    doc.meta.snippetAssets = [{ key: 'callout@1', name: 'Callout', css: '.callout{}' }];
    doc.assets = { pic: { id: 'pic', contentType: 'image/png', base64: PNG_BASE64 } };
    doc.tree.children.push({ type: 'element', tagName: 'img', properties: { src: 'asset:pic', alt: '' }, children: [] });
    const sel = runSelector(doc, { mode: 'all', scope: 'blocks' });
    const r = await insertContent(target, after('h1'), { kind: 'selection' }, {}, sel);
    expect(serialize(r.document)).not.toContain('data-json-path');
    expect(serialize(r.document)).toContain('Hello');
    expect(r.document.assets.pic).toBeDefined();
    expect(r.document.meta.snippetAssets?.map((a) => a.key)).toContain('callout@1');
  });

  it('warns for an empty selection and waits without one', async () => {
    const empty = runSelector(other, { mode: 'css', selector: 'table' });
    const r = await insertContent(target, after('h1'), { kind: 'selection' }, {}, empty);
    expect(r.inserted).toBe(0);
    expect(r.warnings.join()).toMatch(/selection is empty/);
    expect((await insertContent(target, after('h1'), { kind: 'selection' }, {})).waiting).toMatch(/Connect a selection/);
  });

  it('runs in a graph with the optional Selection input', async () => {
    const html = storeFile('a.html', '<h1>A</h1><p>Text</p>', 'html');
    const notes = storeFile('b.html', '<blockquote>Quoted</blockquote>', 'html');
    const g: Graph = {
      nodes: [
        { id: 'a', type: 'documentSource', config: { fileId: 'a' } },
        { id: 'b', type: 'documentSource', config: { fileId: 'b' } },
        { id: 'sel', type: 'selector', config: { mode: 'all' } },
        { id: 'ins', type: 'insert', config: { content: { kind: 'selection' }, where: after('h1') } },
        { id: 'plain', type: 'insert', config: nodeRegistry.insert.defaultConfig() },
      ],
      edges: [
        { id: 'e1', source: 'a', sourcePort: 'document', target: 'ins', targetPort: 'document' },
        { id: 'e2', source: 'b', sourcePort: 'document', target: 'sel', targetPort: 'document' },
        { id: 'e3', source: 'sel', sourcePort: 'selection', target: 'ins', targetPort: 'selection' },
        { id: 'e4', source: 'a', sourcePort: 'document', target: 'plain', targetPort: 'document' },
      ],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(g, { files: { a: html, b: notes } });
    expect(serialize(results.ins.outputs.document as CmsDocument)).toBe('<h1>A</h1><blockquote>Quoted</blockquote><p>Text</p>');
    // Without the Selection input connected, an Insert node still runs (here: waiting for an address).
    expect(results.plain.status).toBe('waiting');
    expect(results.plain.message).toMatch(/address/i);
  });
});
