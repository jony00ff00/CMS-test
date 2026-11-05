import { describe, expect, it } from 'vitest';
import {
  buildTextIndex, discoverPaths, findJsonError, formatJsonPath, guessFormat, importJson, JsonParseError, mapJsonToDocument,
  parseJson, serialize, type JsonMapping,
} from '../../src/engine';
import { findAll, fixture } from './helpers';

const sample = () => parseJson(fixture('sample.json').toString()) as Record<string, any>;

const blocks = (doc: Awaited<ReturnType<typeof mapJsonToDocument>>) =>
  doc.tree.children.map((c) => (c.type === 'element' ? c.properties.dataJsonPath : undefined));

describe('parseJson', () => {
  it('reports invalid JSON with file name, line and column', async () => {
    const run = () => parseJson(fixture('sample-invalid.json').toString(), 'sample-invalid.json');
    expect(run).toThrow(JsonParseError);
    try {
      run();
    } catch (err) {
      const e = err as JsonParseError;
      expect(e.message).toMatch(/^sample-invalid\.json is not valid JSON \(line 1, column \d+\): /);
      expect(e.line).toBe(1);
      expect(e.column).toBeGreaterThan(1);
    }
  });

  it('explains common mistakes with a position', () => {
    const problem = (text: string) => {
      try {
        parseJson(text, 'f.json');
      } catch (err) {
        return (err as Error).message.replace('f.json is not valid JSON ', '');
      }
    };
    expect(problem('{ "title": "Broken, "articles": [1, 2,] \n')).toBe(
      "(line 1, column 22): Expected ',' or '}' after a property value, found 'a'",
    );
    expect(problem('{"a": [1, 2,]}')).toBe("(line 1, column 12): Trailing comma before ']'");
    expect(problem('{"a": 1,}')).toBe("(line 1, column 8): Trailing comma before '}'");
    expect(problem("{'a': 1}")).toBe("(line 1, column 2): Expected a property name in double quotes, found '''");
    expect(problem('{"a": \'x\'}')).toBe('(line 1, column 7): Strings must use double quotes');
    expect(problem('{"a": "x')).toBe('(line 1, column 7): String is never closed');
    expect(problem('{"a": "x\ny"}')).toBe('(line 1, column 9): Line break inside a string (missing closing quote?)');
    expect(problem('{"a": [1, 2')).toBe("(line 1, column 12): Expected ',' or ']' after an array item, found the end of the file");
    expect(problem('{"a": 01}')).toBe("(line 1, column 8): Expected ',' or '}' after a property value, found '1'");
    expect(problem('{} x')).toBe("(line 1, column 4): Unexpected 'x' after the end of the data");
    expect(problem('')).toBe('(line 1, column 1): Unexpected the end of the file, expected a value');
  });

  it('agrees with JSON.parse on valid input', () => {
    for (const text of ['{}', '[]', '"x"', '-1.5e+3', 'true', 'null', ' {"a":[1,{"b":"\\u00e9\\n"}],"c":false} ']) {
      expect(findJsonError(text), text).toBeUndefined();
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  it('counts lines and columns across line breaks', async () => {
    try {
      parseJson('{\n  "a": 1,\n  oops\n}');
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ line: 3, column: 3 });
    }
  });
});

describe('discoverPaths', () => {
  it('lists every string in file order with a suggested format', async () => {
    expect(discoverPaths(sample()).map((p) => [p.path, p.suggestedFormat])).toEqual([
      ['$.title', 'text'],
      ['$.summary', 'text'],
      ['$.articles[0].title', 'text'],
      ['$.articles[0].body', 'html'],
      ['$.articles[1].title', 'text'],
      ['$.articles[1].body', 'html'],
      ['$.faq[0].q', 'text'],
      ['$.faq[0].a', 'markdown'],
      ['$.faq[1].q', 'text'],
      ['$.faq[1].a', 'markdown'],
      ['$.meta.id', 'text'],
      ['$.meta.tags[0]', 'text'],
      ['$.meta.tags[1]', 'text'],
    ]);
  });

  it('quotes keys that are not identifiers, and discovered paths can be used as mappings', async () => {
    const data = { 'odd key': 'a', "it's": ['b'], 'back\\slash': 'c', 'résumé': 'd' };
    const paths = discoverPaths(data).map((p) => p.path);
    expect(paths).toEqual(["$['odd key']", "$['it\\'s'][0]", "$['back\\\\slash']", "$['résumé']"]);
    const doc = await mapJsonToDocument(data, { mode: 'fields', fields: paths.map((path) => ({ path, format: 'text' })) });
    expect(blocks(doc)).toEqual(paths);
    expect(buildTextIndex(doc.tree).text).toBe('a\nb\nc\nd');
    expect(doc.meta.warnings).toEqual([]);
  });

  it('formats paths', async () => {
    expect(formatJsonPath([])).toBe('$');
    expect(formatJsonPath(['a', 0, 'b-c', '_ok'])).toBe("$.a[0]['b-c']._ok");
  });

  it('guesses formats', async () => {
    expect(guessFormat('Plain words, 3 < 4.')).toBe('text');
    expect(guessFormat('<p>Hi</p>')).toBe('html');
    expect(guessFormat('line<br>break')).toBe('html');
    expect(guessFormat('# Heading')).toBe('markdown');
    expect(guessFormat('see [docs](https://x.y)')).toBe('markdown');
  });
});

describe('mapJsonToDocument: field mode', () => {
  it('imports every string as text when there is no mapping', async () => {
    const doc = await mapJsonToDocument(sample(), undefined, { fileName: 'sample.json' });
    expect(doc.meta).toMatchObject({ origin: 'json', fileName: 'sample.json', title: 'Field Guide to Node Gardens' });
    expect(blocks(doc)).toEqual(discoverPaths(sample()).map((p) => p.path));
    // HTML in a text field stays visible text, it is not parsed.
    expect(serialize(doc)).toContain('<div data-json-path="$.articles[0].body"><p>&#x3C;p>Plant a source');
    expect(doc.meta.warnings).toEqual([]);
  });

  it('reads text, html and markdown fields', async () => {
    const mapping: JsonMapping = {
      mode: 'fields',
      fields: [
        { path: '$.title', format: 'text', blockTag: 'h1' },
        { path: '$.summary', format: 'text' },
        { path: '$.articles[*].body', format: 'html' },
        { path: '$.faq[*].a', format: 'markdown' },
      ],
    };
    const doc = await mapJsonToDocument(sample(), mapping);
    expect(blocks(doc)).toEqual([
      '$.title', '$.summary', '$.articles[0].body', '$.articles[1].body', '$.faq[0].a', '$.faq[1].a',
    ]);
    expect(serialize(doc)).toBe(
      '<h1 data-json-path="$.title">Field Guide to Node Gardens</h1>' +
        '<div data-json-path="$.summary"><p>Node gardens grow best in well-structured documents.</p><p>Each node does one job.</p></div>' +
        '<div data-json-path="$.articles[0].body"><p>Plant a source node first. Then connect a selector to it.</p></div>' +
        '<div data-json-path="$.articles[1].body"><p>The basic plan costs nothing. The pro plan adds snippets.</p></div>' +
        '<div data-json-path="$.faq[0].a"><p>Yes. Map <strong>string fields</strong> with JSONPath.</p></div>' +
        '<div data-json-path="$.faq[1].a"><p>No. Nodes never change their inputs.</p><ul><li>Sources stay intact</li><li>Output is new</li></ul></div>',
    );
    expect(doc.meta.json?.fields.map((f) => [f.path, f.segments, f.format])).toEqual([
      ['$.title', ['title'], 'text'],
      ['$.summary', ['summary'], 'text'],
      ['$.articles[0].body', ['articles', 0, 'body'], 'html'],
      ['$.articles[1].body', ['articles', 1, 'body'], 'html'],
      ['$.faq[0].a', ['faq', 0, 'a'], 'markdown'],
      ['$.faq[1].a', ['faq', 1, 'a'], 'markdown'],
    ]);
    expect(doc.meta.warnings).toEqual([]);
  });

  it('gives a readable text index for selectors', async () => {
    const doc = await mapJsonToDocument(sample(), { mode: 'fields', fields: [{ path: '$.faq[*].q', format: 'text' }] });
    expect(buildTextIndex(doc.tree).text).toBe('Can I use JSON?\nIs the source changed?');
  });

  it('warns instead of failing for paths that match nothing, non-strings and duplicates', async () => {
    const data = { a: 'x', n: 42, flag: true, obj: { b: 1 }, list: [1], nothing: null };
    const doc = await mapJsonToDocument(data, {
      mode: 'fields',
      fields: [
        { path: '$.missing', format: 'text' },
        { path: '$.a', format: 'text' },
        { path: '$.a', format: 'html' },
        { path: '$.n', format: 'text' },
        { path: '$.flag', format: 'text' },
        { path: '$.obj', format: 'text' },
        { path: '$.list', format: 'text' },
        { path: '$.nothing', format: 'text' },
        { path: '$', format: 'text' },
      ],
    });
    expect(buildTextIndex(doc.tree).text).toBe('x\n42\ntrue');
    expect(doc.meta.warnings).toEqual([
      '$.missing: matched nothing',
      '$.a: mapped more than once, kept the first',
      '$.obj: skipped, not a string (object)',
      '$.list: skipped, not a string (array)',
      '$.nothing: skipped, not a string (null)',
      '$: the whole file cannot be a field',
    ]);
  });

  it('cleans html fields and reports where the problem was', async () => {
    const doc = await mapJsonToDocument(
      { body: '<p onclick="x()">Hi</p><script>alert(1)</script>' },
      { mode: 'fields', fields: [{ path: '$.body', format: 'html' }] },
    );
    expect(serialize(doc)).toBe('<div data-json-path="$.body"><p>Hi</p></div>');
    expect(doc.meta.warnings).toEqual(['$.body: Removed onclick attribute from <p>', '$.body: Removed <script> element']);
  });

  it('drops raw HTML inside markdown', async () => {
    const doc = await mapJsonToDocument({ a: 'Hi <script>alert(1)</script> **there**' }, {
      mode: 'fields', fields: [{ path: '$.a', format: 'markdown' }],
    });
    expect(serialize(doc)).toBe('<div data-json-path="$.a"><p>Hi alert(1) <strong>there</strong></p></div>');
  });

  it('turns single line breaks in text into <br>', async () => {
    const doc = await mapJsonToDocument({ a: 'one\ntwo\n\nthree' }, { mode: 'fields', fields: [{ path: '$.a', format: 'text' }] });
    expect(serialize(doc)).toBe('<div data-json-path="$.a"><p>one<br>two</p><p>three</p></div>');
  });

  it('falls back to <div> when an inline wrapper is asked to hold html', async () => {
    const doc = await mapJsonToDocument({ a: '<p>x</p>' }, { mode: 'fields', fields: [{ path: '$.a', format: 'html', blockTag: 'p' }] });
    expect(serialize(doc)).toBe('<div data-json-path="$.a"><p>x</p></div>');
    expect(doc.meta.warnings).toEqual(['$.a: <p> cannot hold html content, used <div>']);
  });

  it('supports JSONPath filters and recursive descent', async () => {
    const data = { items: [{ type: 'note', text: 'a' }, { type: 'tip', text: 'b' }, { type: 'note', text: 'c' }] };
    const filtered = await mapJsonToDocument(data, { mode: 'fields', fields: [{ path: "$.items[?(@.type==='note')].text", format: 'text' }] });
    expect(blocks(filtered)).toEqual(['$.items[0].text', '$.items[2].text']);
    const recursive = await mapJsonToDocument(data, { mode: 'fields', fields: [{ path: '$..text', format: 'text' }] });
    expect(blocks(recursive)).toEqual(['$.items[0].text', '$.items[1].text', '$.items[2].text']);
  });

  it('never changes the input and keeps its own copy for write-back', async () => {
    const data = sample();
    const before = JSON.stringify(data);
    const doc = await mapJsonToDocument(data, { mode: 'fields', fields: [{ path: '$.articles[*].body', format: 'html' }] });
    expect(JSON.stringify(data)).toBe(before);
    expect(doc.meta.json?.data).toEqual(data);
    expect(doc.meta.json?.data).not.toBe(data);
    expect(doc.meta.json?.mapping).toEqual({ mode: 'fields', fields: [{ path: '$.articles[*].body', format: 'html' }] });
  });

  it('stores the default mapping when none is given', async () => {
    const doc = await mapJsonToDocument({ a: 'x' });
    expect(doc.meta.json?.mapping).toEqual({ mode: 'fields', fields: [{ path: '$.a', format: 'text' }] });
  });
});

describe('mapJsonToDocument: template mode', () => {
  const template = `<h1>{{title}}</h1>{{#each articles}}<article><h2>{{title}}</h2>{{{body}}}</article>{{/each}}
    <dl>{{#each faq}}<dt>{{q}}</dt><dd>{{markdown a}}</dd>{{/each}}</dl>`;

  it('renders the whole file with Handlebars', async () => {
    const doc = await mapJsonToDocument(sample(), { mode: 'template', template });
    expect(findAll(doc.tree, 'article')).toHaveLength(2);
    expect(findAll(doc.tree, 'dd')[0].children).toEqual([
      expect.objectContaining({ tagName: 'p' }),
    ]);
    expect(serialize(doc)).toContain('<dd><p>Yes. Map <strong>string fields</strong> with JSONPath.</p></dd>');
    expect(doc.meta.title).toBe('Field Guide to Node Gardens');
    expect(doc.meta.json?.fields).toEqual([]);
    expect(doc.meta.json?.mapping).toEqual({ mode: 'template', template });
  });

  it('escapes {{values}} and still cleans {{{raw}}} HTML', async () => {
    const doc = await mapJsonToDocument({ a: '<b>x</b>', b: '<img src=x onerror="steal()">' }, {
      mode: 'template', template: '<p>{{a}}</p><p>{{{b}}}</p>',
    });
    expect(serialize(doc)).toBe('<p>&#x3C;b>x&#x3C;/b></p><p><img src="x"></p>');
    expect(doc.meta.warnings).toEqual(['Removed onerror attribute from <img>']);
  });

  it('reports template errors', async () => {
    await expect(mapJsonToDocument({}, { mode: 'template', template: '{{#each x}}' })).rejects.toThrow(/^JSON template error: /);
  });
});

describe('importJson', () => {
  it('parses bytes and strings, including a byte order mark', async () => {
    const bytes = fixture('sample.json');
    expect((await importJson(bytes)).meta.title).toBe('Field Guide to Node Gardens');
    expect((await importJson('\uFEFF{"title":"BOM"}')).meta.title).toBe('BOM');
  });

  it('throws a JsonParseError for broken files', async () => {
    await expect(importJson(fixture('sample-invalid.json'), undefined, { fileName: 'sample-invalid.json' })).rejects.toThrow(
      JsonParseError,
    );
  });
});
