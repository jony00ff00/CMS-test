import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', name));

describe('generated fixtures', () => {
  it('sample.html has headings, list, table and inline formatting', () => {
    const html = fixture('sample.html').toString();
    for (const tag of ['<h1>', '<h2>', '<ol>', '<table>', '<strong>', '<em>']) expect(html).toContain(tag);
  });

  it('sample.docx is a Word zip package', () => {
    const buf = fixture('sample.docx');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.includes('word/document.xml')).toBe(true);
  });

  it('sample.json parses with text, html and markdown fields', () => {
    const data = JSON.parse(fixture('sample.json').toString());
    expect(data.summary).toContain('\n\n');
    expect(data.articles[0].body).toMatch(/^<p>/);
    expect(data.faq[0].a).toContain('**');
  });

  it('sample-invalid.json does not parse', () => {
    expect(() => JSON.parse(fixture('sample-invalid.json').toString())).toThrow();
  });
});
