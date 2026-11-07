import { describe, expect, it } from 'vitest';
import {
  createAnchor, GraphEvaluator, importJson, nodeRegistry, runSelector, serialize, storeFile, type CmsDocument, type Graph, type GraphEdge, type GraphNode,
} from '../../src/engine';

const page = '<style>.tip { color: green; }</style><h1>Notes</h1><aside class="callout"><h2>Watering</h2><p class="tip">Water once, then wait.</p></aside><table><tr><td>Cell text here</td></tr></table>';
const files = { notes: storeFile('notes.html', page, 'notes') };
const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph, extra = {}) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files: { ...files, ...extra } })).results;
const html = (v: unknown) => serialize(v as CmsDocument);
const wrapIn = (cls: string) => ({ ...nodeRegistry.snippet.defaultConfig() as object, custom: { className: cls, wrap: 'div' } });

describe('Snippet with a document as input', () => {
  it('applies to the whole document, or to each top-level block', async () => {
    const src = storeFile('a.html', '<h1>A</h1><p>B</p>', 'a');
    const r = await run(
      {
        nodes: [node('src', 'documentSource', { fileId: 'a' }), node('whole', 'snippet', wrapIn('box')), node('each', 'snippet', { ...wrapIn('box'), documentScope: 'blocks' })],
        edges: [edge('src', 'document', 'whole', 'selection'), edge('src', 'document', 'each', 'selection')],
      },
      { a: src },
    );
    expect(html(r.whole.outputs.document)).toBe('<div class="box"><h1>A</h1><p>B</p></div>');
    expect(r.whole.info).toMatchObject({ applied: 1, input: 'whole document' });
    expect(html(r.each.outputs.document)).toBe('<div class="box"><h1>A</h1></div><div class="box"><p>B</p></div>');
    expect(r.each.info).toMatchObject({ applied: 2, input: 'each block' });
  });

  it('takes an Extractor’s document, and an Output’s HTML', async () => {
    const r = await run({
      nodes: [
        node('src', 'documentSource', { fileId: 'notes' }),
        node('x', 'extractor', { mode: 'css', selector: 'h2' }),
        node('snip', 'snippet', wrapIn('picked')),
        node('out', 'output'),
        node('fromHtml', 'snippet', wrapIn('page')),
      ],
      edges: [edge('src', 'document', 'x', 'document'), edge('x', 'document', 'snip', 'selection'), edge('snip', 'document', 'out', 'document'), edge('out', 'html', 'fromHtml', 'selection')],
    });
    expect(html(r.snip.outputs.document)).toBe('<div class="picked"><aside class="callout"><h2>Watering</h2></aside></div>');
    expect(r.fromHtml.status).toBe('ok');
    expect(r.fromHtml.info.input).toBe('HTML');
    expect(html(r.fromHtml.outputs.document)).toContain('<div class="page"><div class="picked">');
  });

  it('a selection still works as before', async () => {
    const r = await run({
      nodes: [node('src', 'documentSource', { fileId: 'notes' }), node('sel', 'selector', { mode: 'css', selector: 'h1' }), node('snip', 'snippet', wrapIn('t'))],
      edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'snip', 'selection')],
    });
    expect(html(r.snip.outputs.document)).toMatch(/^<div class="t"><h1>Notes<\/h1><\/div><aside/);
    expect(r.snip.info.input).toBeUndefined();
  });
});

describe('Extractor keeps the elements around what it picks', () => {
  const pick = async (config: Record<string, unknown>) => {
    const r = await run({ nodes: [node('src', 'documentSource', { fileId: 'notes' }), node('x', 'extractor', config)], edges: [edge('src', 'document', 'x', 'document')] });
    return r.x;
  };

  it('text from inside a styled element stays in it, wrappers included, and the page’s styles come along', async () => {
    const r = await pick({ mode: 'regex', pattern: 'Water once' });
    const doc = r.outputs.document as CmsDocument;
    expect(html(doc)).toBe('<aside class="callout"><p class="tip">Water once</p></aside>');
    expect(doc.meta.styles.join()).toContain('.tip');
  });

  it('by hand too, and parts of one element share it', async () => {
    const src = (await run({ nodes: [node('src', 'documentSource', { fileId: 'notes' })], edges: [] })).src.outputs.document as CmsDocument;
    const anchor = (pattern: string, id: string) => createAnchor(src, runSelector(src, { mode: 'regex', pattern }).matches[0].match, { id });
    const r = await pick({ mode: 'manual', anchors: [anchor('Water once', 'a'), anchor('then wait', 'b'), anchor('Cell text', 'c')] });
    expect(html(r.outputs.document)).toBe(
      '<aside class="callout"><p class="tip">Water oncethen wait</p></aside><table><tbody><tr><td>Cell text</td></tr></tbody></table>',
    );
  });

  it('can leave them out, as before', async () => {
    const r = await pick({ mode: 'regex', pattern: 'Water once', keepContext: false });
    expect(html(r.outputs.document)).toBe('Water once');
  });

  it('JSON field blocks around the content lose their data-json-path', async () => {
    const doc = await importJson(JSON.stringify({ body: '<p class="tip">Hello there</p>' }), { mode: 'fields', fields: [{ path: '$.body', format: 'html' }] });
    const json = storeFile('d.json', JSON.stringify({ body: '<p class="tip">Hello there</p>' }), 'json');
    const r = await run(
      {
        nodes: [node('src', 'documentSource', { fileId: 'json', json: { mode: 'fields', fields: [{ path: '$.body', format: 'html' }] } }), node('x', 'extractor', { mode: 'regex', pattern: 'Hello' })],
        edges: [edge('src', 'document', 'x', 'document')],
      },
      { json },
    );
    expect(serialize(doc)).toContain('data-json-path');
    expect(html(r.x.outputs.document)).not.toContain('data-json-path');
    expect(html(r.x.outputs.document)).toContain('<p class="tip">Hello</p>');
  });
});
