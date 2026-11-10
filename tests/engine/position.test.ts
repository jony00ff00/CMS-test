import { describe, expect, it } from 'vitest';
import { GraphEvaluator, insertionPointAt, nodeRegistry, parseHtml, serialize, storeFile, type CmsDocument, type GraphEdge, type GraphNode } from '../../src/engine';
import { groupLayers, raise } from '../../src/ui/canvas/group-layout';

const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const guideHtml = '<h1>Guide</h1><p>Hello world</p><h2>End</h2>';
const files = {
  guide: storeFile('guide.html', guideHtml, 'guide'),
  notes: storeFile('notes.html', '<style>.tip{color:green}</style><h2>Tip</h2><p class="tip">Water.</p>', 'notes'),
};
const run = async (nodes: GraphNode[], edges: GraphEdge[]) => (await new GraphEvaluator(nodeRegistry).evaluate({ nodes, edges }, { files })).results;
const guide = parseHtml(guideHtml);

describe('the Position node', () => {
  const graph = (config: Record<string, unknown>) => ({
    nodes: [
      node('g', 'documentSource', { fileId: 'guide' }),
      node('n', 'documentSource', { fileId: 'notes' }),
      node('pos', 'position', config),
    ],
    edges: [edge('g', 'document', 'pos', 'document'), edge('n', 'document', 'pos', 'content')],
  });

  it('waits for a point, then puts the content there with the source’s styles', async () => {
    const g = graph({});
    expect((await run(g.nodes, g.edges)).pos.status).toBe('waiting');

    const point = insertionPointAt(guide, 'Guide\nHello world'.length, 'after')!;
    const h = graph({ point, headings: 'fit' });
    const r = await run(h.nodes, h.edges);
    expect(r.pos.status).toBe('ok');
    const out = r.pos.outputs.document as CmsDocument;
    expect(serialize(out)).toBe('<h1>Guide</h1><p>Hello world</p><h2>Tip</h2><p class="tip">Water.</p><h2>End</h2>');
    expect(out.meta.styles.join()).toContain('.tip');
    expect(r.pos.info).toMatchObject({ inserted: 1, from: 'notes.html' });
  });

  it('at the cursor, inline content goes inside the paragraph; an Object’s text works as content', async () => {
    const point = insertionPointAt(guide, 'Guide\nHello'.length, 'cursor')!;
    const r = await run(
      [node('g', 'documentSource', { fileId: 'guide' }), node('t', 'object', { content: { kind: 'text', text: ',', as: 'inline' } }), node('pos', 'position', { point })],
      [edge('g', 'document', 'pos', 'document'), edge('t', 'document', 'pos', 'content')],
    );
    expect(serialize(r.pos.outputs.document as CmsDocument)).toBe('<h1>Guide</h1><p>Hello, world</p><h2>End</h2>');
  });

  it('reports when the point is gone', async () => {
    const other = parseHtml('<p>Something quite different here</p>');
    const point = insertionPointAt(other, 5, 'after')!;
    const g = graph({ point });
    const r = await run(g.nodes, g.edges);
    expect(r.pos.info.needsAttention).toBe(1);
  });
});

describe('group stacking', () => {
  const groups = [
    { id: 'a', name: 'A', nodeIds: ['1'] },
    { id: 'b', name: 'B', nodeIds: ['2'] },
    { id: 'c', name: 'C', nodeIds: ['3'], collapsed: true },
  ];
  it('groups lie above other nodes, the most recently raised on top', () => {
    expect([...groupLayers(groups, [])]).toEqual([['a', 10], ['b', 12], ['c', 14]]);
    expect([...groupLayers(groups, raise(['b'], 'a'))]).toEqual([['c', 10], ['b', 12], ['a', 14]]);
    expect(raise(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });
});
