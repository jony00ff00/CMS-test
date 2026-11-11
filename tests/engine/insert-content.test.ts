import { describe, expect, it } from 'vitest';
import {
  copyContent, exportJson, fitHeadings, GraphEvaluator, importJson, insertContent, nodeRegistry, parseHtml, runSelector, serialize,
  storeFile, toSlideDeck, type CmsDocument, type Graph, type GraphEdge, type GraphNode, type InsertWhere,
} from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { createEditorStore } from '../../src/store/editor-store';
import { twoDocumentsProject } from '../two-documents';

const guideHtml = '<h1>Guide</h1><h2>Pricing</h2><p>Free.</p><blockquote><p>Quote</p></blockquote>';
const notesHtml = '<style>.tip { color: green; }</style><h1>Notes</h1><h2>Watering</h2><p class="tip">Once.</p><h3>Winter</h3><p>Less.</p><h2>Pests</h2><p>Loops.</p>';
const files = { guide: storeFile('guide.html', guideHtml, 'guide'), notes: storeFile('notes.html', notesHtml, 'notes') };

const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files })).results;
const before = (selector: string): InsertWhere => ({ mode: 'selector', selector: { mode: 'css', selector }, place: 'before' });

/** Guide ← (before the quote) the Watering section of the notes, through an Extractor. */
const twoDocuments = (content: Record<string, unknown>): Graph => ({
  nodes: [
    node('guide', 'documentSource', { fileId: 'guide' }),
    node('notes', 'documentSource', { fileId: 'notes' }),
    node('pt', 'selector', { mode: 'css', selector: 'blockquote', place: 'before' }),
    node('x', 'extractor', { mode: 'heading', text: 'Watering', includeHeading: true }),
    node('obj', 'object', { content: { kind: 'selection', ...content } }),
  ],
  edges: [
    edge('guide', 'document', 'pt', 'document'),
    edge('notes', 'document', 'x', 'document'),
    edge('pt', 'point', 'obj', 'point'),
    edge('x', 'document', 'obj', 'content'),
  ],
});

describe('Extractor → Object: content from another document', () => {
  it('puts all the Extractor keeps at the point, with the source’s styles', async () => {
    const r = await run(twoDocuments({}));
    expect(r.obj.status).toBe('ok');
    const out = r.obj.outputs.document as CmsDocument;
    expect(serialize(out)).toBe('<h1>Guide</h1><h2>Pricing</h2><p>Free.</p><h2>Watering</h2><p class="tip">Once.</p><h3>Winter</h3><p>Less.</p><blockquote><p>Quote</p></blockquote>');
    expect(out.meta.styles.join()).toContain('.tip');
    expect(r.obj.info.from).toBe('notes.html');
    // The preview's "Content" view: just what is added.
    expect(serialize(r.obj.outputs.content as CmsDocument)).toBe('<h2>Watering</h2><p class="tip">Once.</p><h3>Winter</h3><p>Less.</p>');
  });

  it('can leave the source’s styles behind', async () => {
    const r = await run(twoDocuments({ styles: false }));
    expect((r.obj.outputs.document as CmsDocument).meta.styles.join()).not.toContain('.tip');
  });

  it('puts the content in a box with a class, or a section labelled with where it came from', async () => {
    const box = await run(twoDocuments({ wrap: 'div', className: 'from notes!' }));
    expect(serialize(box.obj.outputs.document as CmsDocument)).toContain('<div class="from-notes"><h2>Watering</h2>');
    const plain = await run(twoDocuments({ wrap: 'div' }));
    expect(serialize(plain.obj.outputs.document as CmsDocument)).toContain('<div class="inserted"><h2>Watering</h2>');

    const section = await run(twoDocuments({ wrap: 'section' }));
    const out = section.obj.outputs.document as CmsDocument;
    expect(serialize(out)).toContain('<section class="cms-from" data-from="notes.html"><p class="cms-from-label">From notes.html</p><h2>Watering</h2>');
    expect(out.meta.styles.join()).toContain('.cms-from-label');
  });

  it('fits the headings under the heading before the point, keeping the steps between them', async () => {
    const r = await run(twoDocuments({ headings: 'fit' }));
    expect(serialize(r.obj.outputs.document as CmsDocument)).toContain('<p>Free.</p><h3>Watering</h3><p class="tip">Once.</p><h4>Winter</h4>');
    expect(r.obj.warnings).toEqual([]);
  });

  it('fits headings per place, and keeps them past level 6 as <h6> with a warning', () => {
    const nodes = parseHtml('<h2>A</h2><h4>B</h4>').tree.children as Parameters<typeof fitHeadings>[0];
    const deep: string[] = [];
    fitHeadings(nodes, 4, deep);
    expect(serialize({ ...parseHtml(''), tree: { type: 'root', children: nodes } })).toBe('<h5>A</h5><h6>B</h6>');
    expect(deep).toEqual(['“B”']);
  });

  it('without a heading before the point, the headings keep their levels', async () => {
    const target = parseHtml('<p>Top</p><p>End</p>');
    const notes = parseHtml(notesHtml, { fileName: 'notes.html' });
    const sel = runSelector(notes, { mode: 'heading', text: 'Pests' });
    const r = await insertContent(target, { mode: 'selector', selector: { mode: 'css', selector: 'p' }, place: 'after' }, { kind: 'selection', headings: 'fit' }, {}, sel);
    // At every match: once after each paragraph.
    expect(serialize(r.document)).toBe('<p>Top</p><h2>Pests</h2><p>Loops.</p><p>End</p><h2>Pests</h2><p>Loops.</p>');
    expect(r.inserted).toBe(2);
  });

  it('takes a document, a selection or HTML into the Content input', async () => {
    const g = twoDocuments({});
    // A Selector's selection instead of the Extractor's document.
    g.nodes.push(node('sel', 'selector', { mode: 'css', selector: '.tip' }));
    g.edges = g.edges.filter((e) => e.target !== 'obj' || e.targetPort !== 'content');
    g.edges.push(edge('notes', 'document', 'sel', 'document'), edge('sel', 'selection', 'obj', 'content'));
    const r = await run(g);
    expect(serialize(r.obj.outputs.document as CmsDocument)).toContain('<p>Free.</p><p class="tip">Once.</p><blockquote>');

    // An Output's HTML through the Content input: its body is the content.
    const h = twoDocuments({});
    h.nodes.push(node('out', 'output'));
    h.edges = h.edges.filter((e) => e.target !== 'obj' || e.targetPort !== 'content');
    h.edges.push(edge('x', 'document', 'out', 'document'), edge('out', 'html', 'obj', 'content'));
    const viaHtml = await run(h);
    expect(serialize(viaHtml.obj.outputs.document as CmsDocument)).toContain('<p>Free.</p><h2>Watering</h2>');
  });

  it('never puts block content inside a paragraph: it goes next to it, with a warning', async () => {
    const target = parseHtml('<p>Hello world</p>');
    const notes = parseHtml(notesHtml);
    const point = { mode: 'selector', selector: { mode: 'regex', pattern: 'Hello' }, place: 'after' } as InsertWhere;
    const r = await insertContent(target, point, { kind: 'selection', wrap: 'div' }, {}, runSelector(notes, { mode: 'css', selector: '.tip' }));
    expect(serialize(r.document)).toBe('<p>Hello world</p><div class="inserted"><p class="tip">Once.</p></div>');
    expect(r.warnings.join()).toMatch(/cannot go inside a paragraph/);
  });

  it('content put inside a JSON field goes back into that field', async () => {
    const data = { title: 'T', body: '<p>Body</p>' };
    const doc = await importJson(JSON.stringify(data), { mode: 'fields', fields: [{ path: '$.body', format: 'html' }] });
    const notes = parseHtml(notesHtml);
    const where: InsertWhere = { mode: 'selector', selector: { mode: 'jsonField', path: '$.body' }, place: 'end' };
    const r = await insertContent(doc, where, { kind: 'selection' }, {}, runSelector(notes, { mode: 'css', selector: '.tip' }));
    const exported = await exportJson(r.document);
    expect(JSON.parse(exported.json)).toEqual({ title: 'T', body: '<p>Body</p><p class="tip">Once.</p>' });
    expect(exported.changed).toEqual(['$.body']);
  });

  it('slides copied into a deck become slides of it', async () => {
    const deck = (n: number) => Array.from({ length: n }, (_, i) => `<section class="slide" data-slide="${i + 1}"><h2>S${i + 1}</h2></section>`).join('');
    const target = parseHtml(deck(2));
    const other = parseHtml(deck(3));
    const r = await insertContent(target, before('section[data-slide="2"]'), { kind: 'selection' }, {}, runSelector(other, { mode: 'slide', slides: '2-3' }));
    expect(toSlideDeck(r.document).slides).toBe(4);
    expect(serialize(r.document).match(/<h2>S\d<\/h2>/g)).toEqual(['<h2>S1</h2>', '<h2>S2</h2>', '<h2>S3</h2>', '<h2>S2</h2>']);
  });

  it('copyContent leaves out empty styles and does not wrap nothing', async () => {
    const empty = runSelector(parseHtml(notesHtml), { mode: 'css', selector: 'table' });
    const c = await copyContent(empty, { kind: 'selection', wrap: 'section' });
    expect(c.nodes).toEqual([]);
  });
});

describe('the Content input in projects and the store', () => {
  it('old projects: an Object’s "selection" connection becomes "content"', () => {
    const graph = twoDocuments({});
    graph.edges = graph.edges.map((e) => (e.targetPort === 'content' ? { ...e, targetPort: 'selection' } : e));
    const project = { format: 'node-cms-project', version: 1, graph, files: {} };
    const { project: { graph: loaded }, warnings } = parseProject(JSON.stringify(project));
    expect(warnings.filter((w) => /connection/.test(w))).toEqual([]);
    expect(loaded.edges.find((e) => e.target === 'obj' && e.source === 'x')?.targetPort).toBe('content');
  });

  it('connecting an Extractor to an Object’s Content switches it to content from another node', () => {
    const store = createEditorStore({ storage: null });
    const s = store.getState();
    const x = s.addNode('extractor');
    const obj = s.addNode('object');
    expect(s.connect({ source: x, sourcePort: 'document', target: obj, targetPort: 'content' })).toBeUndefined();
    const config = store.getState().graph.nodes.find((n) => n.id === obj)!.config as { content: { kind: string } };
    expect(config.content.kind).toBe('selection');
  });

  it('the old "Two documents" graph runs (tests open it as a project file)', async () => {
    const store = createEditorStore({ storage: null });
    expect(store.getState().importProject(JSON.stringify(twoDocumentsProject()))).toBeUndefined();
    await store.getState().whenIdle();
    const { results } = store.getState();
    expect(results['object-5'].status).toBe('ok');
    const html = results['output-6'].outputs.html as string;
    expect(html).toContain('From notes.html');
    expect(html).toMatch(/<h3>Watering<\/h3>[\s\S]*<h4>In winter<\/h4>[\s\S]*<blockquote>/);
    expect(html).toContain('.tip');
  });
});
