import { describe, expect, it } from 'vitest';
import { buildTextIndex, locate, nodeAtPath, parseHtml, serialize } from '../../src/engine';
import { findAll, fixture } from './helpers';

const sampleHtml = () => fixture('sample.html').toString();

describe('parseHtml', () => {
  it('imports the sample page structure', () => {
    const doc = parseHtml(sampleHtml(), { fileName: 'sample.html' });
    expect(doc.kind).toBe('document');
    expect(doc.meta).toMatchObject({ origin: 'html', fileName: 'sample.html', title: 'Field Guide to Node Gardens' });
    expect(findAll(doc.tree, 'h2')).toHaveLength(2);
    expect(findAll(doc.tree, 'li')).toHaveLength(3);
    expect(findAll(doc.tree, 'tr')).toHaveLength(3);
    expect(findAll(doc.tree, 'blockquote')).toHaveLength(1);
    expect(findAll(doc.tree, 'img')[0].properties.alt).toBe('Logo');
    expect(doc.meta.warnings).toEqual([]);
  });

  it('keeps only body content and drops the source formatting whitespace', () => {
    const doc = parseHtml(sampleHtml());
    expect(doc.tree.children.every((c) => c.type === 'element')).toBe(true);
    expect(serialize(doc)).toMatch(/^<h1>Field Guide to Node Gardens<\/h1><p>Node gardens <em>grow best<\/em> in <strong>/);
  });

  it('round-trips without changing', () => {
    const once = serialize(parseHtml(sampleHtml()));
    const twice = serialize(parseHtml(once));
    expect(twice).toBe(once);
  });

  it('accepts fragments', () => {
    const doc = parseHtml('<p>Just a <b>fragment</b></p>');
    expect(serialize(doc)).toBe('<p>Just a <b>fragment</b></p>');
    expect(doc.meta.title).toBeUndefined();
  });

  it('removes scripts, event handlers, javascript: URLs and comments, and collects styles', () => {
    const doc = parseHtml(`<html><head><style>h1{color:red}</style><script>alert(1)</script></head><body>
      <!-- note --><h1 onclick="steal()">Hi</h1><a href="javascript:alert(1)">x</a><style>p{margin:0}</style>
      <script>alert(2)</script></body></html>`);
    expect(serialize(doc)).toBe('<h1>Hi</h1><a>x</a>');
    expect(doc.meta.styles).toEqual(['h1{color:red}', 'p{margin:0}']);
    expect(doc.meta.warnings).toEqual([
      'Removed onclick attribute from <h1>',
      'Removed javascript: URL from <a>',
      'Removed <script> element',
    ]);
  });

  it('collapses whitespace like a browser, but keeps it in <pre>', () => {
    const doc = parseHtml(`<div>
      <p>  one
         <em>two</em>   <strong>three</strong>
      </p>
      <pre>  keep
   this  </pre>
    </div>`);
    expect(serialize(doc)).toBe('<div><p>one <em>two</em> <strong>three</strong></p><pre>  keep\n   this  </pre></div>');
  });

  it('removes position data', () => {
    expect(JSON.stringify(parseHtml(sampleHtml()).tree)).not.toContain('"position"');
  });
});

describe('serialize', () => {
  it('writes a full page with title and styles', () => {
    const doc = parseHtml('<html><head><title>A &amp; B</title><style>p{}</style></head><body><p>x</p></body></html>');
    expect(serialize(doc, { fullDocument: true })).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><title>A &amp; B</title><style>p{}</style></head><body><p>x</p></body></html>',
    );
  });

  it('inlines assets without changing the document', () => {
    const doc = parseHtml('<p><img src="asset:img-1" alt=""></p>');
    doc.assets['img-1'] = { id: 'img-1', contentType: 'image/png', base64: 'AAAA' };
    expect(serialize(doc, { inlineAssets: true })).toBe('<p><img src="data:image/png;base64,AAAA" alt=""></p>');
    expect(serialize(doc)).toBe('<p><img src="asset:img-1" alt=""></p>');
  });
});

describe('text index', () => {
  it('gives the visible text with one line per block', () => {
    const { text } = buildTextIndex(parseHtml(sampleHtml()).tree);
    expect(text.split('\n')).toEqual([
      'Field Guide to Node Gardens',
      'Node gardens grow best in well-structured documents.',
      'Getting started',
      'Plant a source node first. Then connect a selector to it.',
      'Pricing',
      'The basic plan costs nothing. The pro plan adds snippets.',
      'Every node does one job well.',
      'Upload a document',
      'Select some text',
      'Apply a snippet',
      'Node', 'Input', 'Output',
      'Source', 'File', 'Document',
      'Selector', 'Document', 'Selection',
    ]);
  });

  it('maps every segment back to its text node and path', () => {
    const doc = parseHtml(sampleHtml());
    const index = buildTextIndex(doc.tree);
    expect(index.segments.length).toBeGreaterThan(10);
    for (const seg of index.segments) {
      expect(index.text.slice(seg.start, seg.end)).toBe(seg.node.value);
      expect(nodeAtPath(doc.tree, seg.path)).toBe(seg.node);
    }
  });

  it('handles inline formatting and <br>', () => {
    const index = buildTextIndex(parseHtml('<p>a <em>bc</em> d<br>e</p><p>f</p>').tree);
    expect(index.text).toBe('a bc d\ne\nf');
    expect(index.segments.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 4], [4, 6], [7, 8], [9, 10]]);
  });

  it('locates offsets, with boundaries going forward or backward', () => {
    const index = buildTextIndex(parseHtml('<p>a <em>bc</em> d</p><p>f</p>').tree);
    // "a bc d\nf": segments "a " [0,2], "bc" [2,4], " d" [4,6], "f" [7,8]
    const at = (offset: number, bias?: 'forward' | 'backward') => {
      const loc = locate(index, offset, bias)!;
      return [loc.segment.node.value, loc.offset];
    };
    expect(at(0)).toEqual(['a ', 0]);
    expect(at(3)).toEqual(['bc', 1]);
    expect(at(2)).toEqual(['bc', 0]);
    expect(at(2, 'backward')).toEqual(['a ', 2]);
    expect(at(6)).toEqual(['f', 0]); // on the block break: snaps forward
    expect(at(7, 'backward')).toEqual([' d', 2]); // start of next block: snaps back
    expect(at(8, 'backward')).toEqual(['f', 1]);
    expect(locate(index, 99)).toBeUndefined();
  });

  it('is empty for an empty document', () => {
    const index = buildTextIndex(parseHtml('').tree);
    expect(index).toEqual({ text: '', segments: [] });
    expect(locate(index, 0)).toBeUndefined();
  });
});
