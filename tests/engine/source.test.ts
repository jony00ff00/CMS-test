import { describe, expect, it } from 'vitest';
import { ACCEPTED_EXTENSIONS, buildTextIndex, detectFormat, importSource } from '../../src/engine';
import { fixture } from './helpers';

describe('importSource', () => {
  it('detects formats by extension', () => {
    expect(detectFormat('a.HTML')).toBe('html');
    expect(detectFormat('a.htm')).toBe('html');
    expect(detectFormat('report.final.docx')).toBe('docx');
    expect(detectFormat('data.json')).toBe('json');
    expect(detectFormat('notes.txt')).toBeUndefined();
    expect(detectFormat('README')).toBeUndefined();
    expect(ACCEPTED_EXTENSIONS).toContain('.json');
  });

  it('imports all three sample files', async () => {
    for (const name of ['sample.html', 'sample.docx', 'sample.json']) {
      const doc = await importSource({ name, data: fixture(name) });
      expect(doc.meta.fileName).toBe(name);
      expect(doc.meta.title).toBe('Field Guide to Node Gardens');
      expect(buildTextIndex(doc.tree).text.length).toBeGreaterThan(50);
    }
  });

  it('passes the JSON mapping through', async () => {
    const doc = await importSource(
      { name: 'sample.json', data: fixture('sample.json') },
      { json: { mode: 'fields', fields: [{ path: '$.meta.id', format: 'text' }] } },
    );
    expect(buildTextIndex(doc.tree).text).toBe('guide-001');
  });

  it('rejects unsupported and wrongly read files', async () => {
    await expect(importSource({ name: 'notes.txt', data: 'hi' })).rejects.toThrow(
      'notes.txt: unsupported file type. Use one of .html, .htm, .xhtml, .docx, .json',
    );
    await expect(importSource({ name: 'a.docx', data: 'text' })).rejects.toThrow(/must be read as binary/);
    await expect(importSource({ name: 'bad.json', data: '{' })).rejects.toThrow(/^bad\.json is not valid JSON/);
  });
});
