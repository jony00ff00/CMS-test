import { describe, expect, it } from 'vitest';
import {
  exportJson, GraphEvaluator, importJson, nodeRegistry, parseHtml, replaceSelection, runSelector, serialize, storeFile,
  type CmsDocument, type GraphEdge, type GraphNode,
} from '../../src/engine';
import { parseProject } from '../../src/store/project';

const notesHtml = '<style>.tip { color: green; }</style><h1>Notes</h1><h2>Watering</h2><p class="tip">Once a <em>week</em>.</p><h3>Winter</h3><p>Less.</p>';
const notes = () => parseHtml(notesHtml, { fileName: 'notes.html' });

describe('replaceSelection', () => {
  it('replaces every matched block with a copy of the content, bringing its styles', async () => {
    const target = parseHtml('<h2>Old</h2><p>Keep</p><blockquote>A</blockquote><blockquote>B</blockquote>');
    const content = runSelector(notes(), { mode: 'heading', text: 'Watering' });
    const r = await replaceSelection(runSelector(target, { mode: 'css', selector: 'blockquote' }), content);
    const once = '<h2>Watering</h2><p class="tip">Once a <em>week</em>.</p><h3>Winter</h3><p>Less.</p>';
    expect(serialize(r.document)).toBe(`<h2>Old</h2><p>Keep</p>${once}${once}`);
    expect(r.replaced).toBe(2);
    expect(r.document.meta.styles.join()).toContain('.tip');
    // The input is unchanged.
    expect(serialize(target)).toContain('<blockquote>A</blockquote>');
  });

  it('selected text takes the content of one paragraph, without its <p>', async () => {
    const target = parseHtml('<p>Water it daily, please.</p>');
    const r = await replaceSelection(runSelector(target, { mode: 'regex', pattern: 'daily' }), runSelector(notes(), { mode: 'css', selector: '.tip' }));
    expect(serialize(r.document)).toBe('<p>Water it Once a <em>week</em>., please.</p>');
    expect(r.warnings).toEqual([]);
  });

  it('block content in place of selected text replaces the whole paragraph, with a warning', async () => {
    const target = parseHtml('<p>Water it daily.</p><p>End</p>');
    const r = await replaceSelection(runSelector(target, { mode: 'regex', pattern: 'daily' }), runSelector(notes(), { mode: 'heading', text: 'Winter' }));
    expect(serialize(r.document)).toBe('<h3>Winter</h3><p>Less.</p><p>End</p>');
    expect(r.warnings.join()).toMatch(/replaces the whole paragraph/);
  });

  it('a text match across two paragraphs gets the content once', async () => {
    const target = parseHtml('<p>one two</p><p>three four</p>');
    const r = await replaceSelection(runSelector(target, { mode: 'regex', pattern: 'two\\nthree' }), runSelector(parseHtml('<p>X</p>'), { mode: 'css', selector: 'p' }));
    expect(serialize(r.document)).toBe('<p>one X</p><p> four</p>');
    expect(r.replaced).toBe(1);
  });

  it('wraps, fits headings and can leave styles behind', async () => {
    const target = parseHtml('<h2>Guide</h2><p>Old</p>');
    const content = runSelector(notes(), { mode: 'heading', text: 'Watering' });
    const r = await replaceSelection(runSelector(target, { mode: 'css', selector: 'p' }), content, { wrap: 'div', className: 'from-notes', headings: 'fit', styles: false });
    expect(serialize(r.document)).toBe('<h2>Guide</h2><div class="from-notes"><h3>Watering</h3><p class="tip">Once a <em>week</em>.</p><h4>Winter</h4><p>Less.</p></div>');
    expect(r.document.meta.styles.join()).not.toContain('.tip');
  });

  it('nothing selected or no content: the document stays as it was, with a warning', async () => {
    const target = parseHtml('<p>A</p>');
    const none = await replaceSelection(runSelector(target, { mode: 'css', selector: 'table' }), runSelector(notes(), { mode: 'css', selector: 'p' }));
    expect(none.document).toBe(target);
    expect(none.warnings.join()).toMatch(/matched nothing/);
    const empty = await replaceSelection(runSelector(target, { mode: 'css', selector: 'p' }), runSelector(notes(), { mode: 'css', selector: 'table' }));
    expect(serialize(empty.document)).toBe('<p>A</p>');
    expect(empty.warnings.join()).toMatch(/nothing was replaced/);
  });

  it('replacing a JSON field block replaces what is inside it, so write-back still works', async () => {
    const doc = await importJson(JSON.stringify({ title: 'T', body: '<p>Body</p>' }), { mode: 'fields', fields: [{ path: '$.body', format: 'html' }] });
    const r = await replaceSelection(runSelector(doc, { mode: 'jsonField', path: '$.body' }), runSelector(parseHtml('<p>New</p>'), { mode: 'css', selector: 'p' }));
    expect(JSON.parse((await exportJson(r.document)).json)).toEqual({ title: 'T', body: '<p>New</p>' });
  });
});

describe('the Replace node', () => {
  const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
  const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  const files = { guide: storeFile('guide.html', '<h1>Guide</h1><blockquote><p>Quote</p></blockquote>', 'guide'), notes: storeFile('notes.html', notesHtml, 'notes') };

  it('takes a Selection and any Content, and gives a document', async () => {
    const graph = {
      nodes: [
        node('guide', 'documentSource', { fileId: 'guide' }),
        node('notes', 'documentSource', { fileId: 'notes' }),
        node('sel', 'selector', { mode: 'css', selector: 'blockquote' }),
        node('x', 'extractor', { mode: 'heading', text: 'Winter' }),
        node('rep', 'replace'),
      ],
      edges: [
        edge('guide', 'document', 'sel', 'document'),
        edge('notes', 'document', 'x', 'document'),
        edge('sel', 'selection', 'rep', 'selection'),
        edge('x', 'document', 'rep', 'content'),
      ],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files });
    expect(results.rep.status).toBe('ok');
    expect(serialize(results.rep.outputs.document as CmsDocument)).toBe('<h1>Guide</h1><h3>Winter</h3><p>Less.</p>');
    expect(results.rep.info).toEqual({ replaced: 1, from: 'notes.html' });

    // Without content it waits.
    const waiting = await new GraphEvaluator(nodeRegistry).evaluate({ ...graph, edges: graph.edges.slice(0, 3) }, { files });
    expect(waiting.results.rep.status).not.toBe('ok');
  });

  it('old projects: Combinator nodes are left out with a plain warning', () => {
    const project = { format: 'node-cms-project', version: 1, graph: { nodes: [{ id: 'combinator-1', type: 'combinator', config: {} }], edges: [] }, files: {} };
    const { project: p, warnings } = parseProject(JSON.stringify(project));
    expect(p.graph.nodes).toEqual([]);
    expect(warnings.join()).toMatch(/Combinators are no longer available/);
  });
});
