import { describe, expect, it } from 'vitest';
import { buildTextIndex, importDocx, parseHtml, serialize } from '../../src/engine';
import { findAll, fixture } from './helpers';

describe('importDocx', () => {
  it('imports headings, inline formatting, lists, tables and quotes', async () => {
    const doc = await importDocx(fixture('sample.docx'), { fileName: 'sample.docx' });
    expect(doc.meta).toMatchObject({ origin: 'docx', fileName: 'sample.docx', title: 'Field Guide to Node Gardens' });
    expect(findAll(doc.tree, 'h1')).toHaveLength(1);
    expect(findAll(doc.tree, 'h2')).toHaveLength(2);
    expect(findAll(doc.tree, 'em')[0].children).toEqual([{ type: 'text', value: 'grow best' }]);
    expect(findAll(doc.tree, 'ol')).toHaveLength(1);
    expect(findAll(doc.tree, 'li')).toHaveLength(3);
    expect(findAll(doc.tree, 'tr')).toHaveLength(3);
    expect(findAll(doc.tree, 'blockquote')).toHaveLength(1);
    expect(doc.meta.warnings).toEqual([]);
  });

  it('extracts images as assets', async () => {
    const doc = await importDocx(fixture('sample.docx'));
    const [img] = findAll(doc.tree, 'img');
    expect(img.properties).toMatchObject({ src: 'asset:img-1', alt: 'Logo' });
    expect(doc.assets['img-1']).toMatchObject({ id: 'img-1', contentType: 'image/png' });
    expect(Buffer.from(doc.assets['img-1'].base64, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(serialize(doc, { inlineAssets: true })).toContain('src="data:image/png;base64,');
  });

  it('gives the same text as the HTML version of the sample', async () => {
    const fromDocx = buildTextIndex((await importDocx(fixture('sample.docx'))).tree).text;
    const fromHtml = buildTextIndex(parseHtml(fixture('sample.html').toString()).tree).text;
    expect(fromDocx).toBe(fromHtml);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const bytes = fixture('sample.docx');
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const doc = await importDocx(arrayBuffer);
    expect(doc.meta.title).toBe('Field Guide to Node Gardens');
  });

  it('applies custom style maps', async () => {
    const doc = await importDocx(fixture('sample.docx'), { styleMap: ["p[style-name='Quote'] => aside.pull-quote:fresh"] });
    expect(findAll(doc.tree, 'aside')[0]?.properties.className).toEqual(['pull-quote']);
    expect(findAll(doc.tree, 'blockquote')).toHaveLength(0);
  });

  it('rejects files that are not .docx with a clear error', async () => {
    await expect(importDocx(new TextEncoder().encode('not a zip'), { fileName: 'bad.docx' })).rejects.toThrow(
      /^Could not read bad\.docx: /,
    );
  });
});
