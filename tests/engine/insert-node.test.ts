import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, serialize, storeFile, type CmsDocument, type Graph, type GraphEdge, type GraphNode } from '../../src/engine';
import { parseProject } from '../../src/store/project';

const files = {
  doc: storeFile('doc.html', '<h1>Title</h1><p>Intro</p><h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>', 'doc'),
  pic: storeFile('pic.png', new Uint8Array([137, 80, 78, 71]), 'pic'),
};
const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files })).results;
const html = (v: unknown) => serialize(v as CmsDocument);
const text = (t: string) => ({ kind: 'text' as const, text: t });

/** Source → Selector (h2) → Insert, connected by `port` (selection or point). */
const graph = (port: 'selection' | 'point', config: object): Graph => ({
  nodes: [node('src', 'documentSource', { fileId: 'doc' }), node('sel', 'selector', { mode: 'css', selector: 'h2', place: 'after' }), node('ins', 'object', config)],
  edges: [edge('src', 'document', 'sel', 'document'), edge('sel', port, 'ins', 'where')],
});

describe('the Insert node', () => {
  it('at a Point: the Point\'s place, or its own', async () => {
    let r = await run(graph('point', { content: text('New') }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><h2>One</h2><p>New</p><p>First</p><h2>Two</h2><p>New</p><p>Second</p>');
    r = await run(graph('point', { content: text('New'), place: 'before' }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><p>New</p><h2>One</h2><p>First</p><p>New</p><h2>Two</h2><p>Second</p>');
    // In place of what the Point's Selector matched.
    r = await run(graph('point', { content: text('Gone'), place: 'replace' }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><p>Gone</p><p>First</p><p>Gone</p><p>Second</p>');
  });

  it('with a Selection: replaces by default, or goes next to or inside each match', async () => {
    let r = await run(graph('selection', { content: text('New') }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><p>New</p><p>First</p><p>New</p><p>Second</p>');
    expect(r.ins.info.replaced).toBe(2);
    r = await run(graph('selection', { content: { kind: 'text', text: 'Part ', as: 'inline' }, place: 'start' }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><h2>Part One</h2><p>First</p><h2>Part Two</h2><p>Second</p>');
    r = await run(graph('selection', { content: { kind: 'text', text: 'Chapter', as: 'inline' }, place: 'inside' }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><h2>Chapter</h2><p>First</p><h2>Chapter</h2><p>Second</p>');
    r = await run(graph('selection', { content: { kind: 'image', fileId: 'pic', alt: 'A picture' }, place: 'after' }));
    expect((html(r.ins.outputs.document).match(/<img/g) ?? []).length).toBe(2);
  });

  it('with a Selection and "content from another node" but nothing connected: removes the matches', async () => {
    const r = await run(graph('selection', { content: { kind: 'selection' } }));
    expect(html(r.ins.outputs.document)).toBe('<h1>Title</h1><p>Intro</p><p>First</p><p>Second</p>');
    expect(r.ins.info.removed).toBe(true);
  });

  it('several items, each at its own place; a place not found is a problem', async () => {
    const g: Graph = {
      nodes: [
        node('src', 'documentSource', { fileId: 'doc' }),
        node('ins', 'object', {
          content: text('unused'),
          items: [
            { id: 'a', label: 'After intro', selector: { mode: 'css', selector: 'h1 + p' }, place: 'after', content: { kind: 'image', fileId: 'pic', alt: 'One' } },
            { id: 'b', label: 'Before two', selector: { mode: 'heading', text: 'Two', includeHeading: true }, place: 'before', content: text('Note') },
            { id: 'c', label: 'Nowhere', selector: { mode: 'css', selector: '.missing' }, place: 'after', content: text('Lost') },
            { id: 'd', selector: { mode: 'css', selector: 'h1' }, place: 'after', content: { kind: 'image', alt: 'No file yet' } },
          ],
        }),
      ],
      edges: [edge('src', 'document', 'ins', 'where')],
    };
    const r = (await run(g)).ins;
    const out = html(r.outputs.document);
    expect(out).toMatch(/^<h1>Title<\/h1><p>Intro<\/p><figure|^<h1>Title<\/h1><p>Intro<\/p><img/);
    expect(out).toContain('<p>Note</p><h2>Two</h2>');
    expect(out).not.toContain('Lost');
    expect(r.problems).toEqual(['Item 3 (Nowhere): its place was not found']);
    expect(r.warnings.join()).toMatch(/Item 4: /);
    expect(r.info).toMatchObject({ items: 4, inserted: 2 });
    // Items need a document at Where.
    expect((await run({ nodes: [g.nodes[1]], edges: [] })).ins.status).toBe('waiting');
  });

  it('a document at Where needs a point picked in the preview', async () => {
    const r = await run({ nodes: [node('src', 'documentSource', { fileId: 'doc' }), node('ins', 'object', { content: text('x') })], edges: [edge('src', 'document', 'ins', 'where')] });
    expect(r.ins.status).toBe('waiting');
    expect(r.ins.message).toMatch(/click in the preview/);
  });
});

describe('older projects: Object, Replace and Position nodes become Insert nodes', () => {
  it('keeps ids and connections, and moves the settings', async () => {
    const file = {
      format: 'node-cms-project',
      version: 1,
      graph: {
        nodes: [
          { id: 'src', type: 'documentSource', config: { fileId: 'doc' } },
          { id: 'sel', type: 'selector', config: { mode: 'css', selector: 'h2' } },
          { id: 'obj', type: 'object', config: { content: { kind: 'text', text: 'Hi' } } },
          { id: 'rep', type: 'replace', name: 'Fill', config: { target: 'inside', pairs: true, styles: false } },
          { id: 'pos', type: 'position', config: { headings: 'fit', point: { anchor: { id: 'a' }, place: 'after' } } },
        ],
        edges: [
          { id: 'e1', source: 'src', sourcePort: 'document', target: 'sel', targetPort: 'document' },
          { id: 'e2', source: 'sel', sourcePort: 'point', target: 'obj', targetPort: 'point' },
          { id: 'e3', source: 'sel', sourcePort: 'selection', target: 'rep', targetPort: 'selection' },
          { id: 'e4', source: 'obj', sourcePort: 'document', target: 'rep', targetPort: 'content' },
          { id: 'e5', source: 'rep', sourcePort: 'document', target: 'pos', targetPort: 'document' },
        ],
      },
      files: [],
    };
    const { project, warnings } = parseProject(JSON.stringify(file));
    expect(warnings).toEqual([]);
    const byId = Object.fromEntries(project.graph.nodes.map((n) => [n.id, n]));
    expect(['obj', 'rep', 'pos'].map((id) => byId[id].type)).toEqual(['object', 'object', 'object']);
    expect(byId.rep).toMatchObject({ name: 'Fill', config: { content: { kind: 'selection', styles: false }, place: 'inside', pairs: true } });
    expect(byId.pos.config).toEqual({ content: { kind: 'selection', headings: 'fit' }, point: { anchor: { id: 'a' }, place: 'after' } });
    expect(project.graph.edges.map((e) => `${e.id}:${e.targetPort}`)).toEqual(['e1:document', 'e2:where', 'e3:where', 'e4:content', 'e5:where']);
  });
});
