import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, storeFile, type Graph, type GraphEdge, type GraphNode } from '../../src/engine';

const files = {
  html: storeFile('a.html', '<h1>Title</h1><h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>', 'html'),
  parts: storeFile('b.html', '<p>A</p><p>B</p><p>C</p>', 'parts'),
};
const node = (id: string, type: string, config?: unknown, extra: Partial<GraphNode> = {}): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig(), ...extra });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files }));

const custom = { custom: { className: 'x', wrap: 'none' } };

describe('problems', () => {
  it('a Selector with an expected number of matches reports a problem when it finds another number', async () => {
    const g: Graph = {
      nodes: [node('src', 'documentSource', { fileId: 'html' }), node('sel', 'selector', { mode: 'css', selector: 'h2', expect: { min: 3 } }), node('snip', 'snippet', custom), node('out', 'output')],
      edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'snip', 'selection'), edge('snip', 'document', 'out', 'document')],
    };
    let r = (await run(g)).results;
    expect(r.sel.status).toBe('ok'); // still runs: the page is made
    expect(r.sel.problems).toEqual(['Found 2 matches, expected at least 3']);
    expect(r.out.status).toBe('ok');
    expect(r.out.upstreamProblems).toEqual([{ nodeId: 'sel', problem: 'Found 2 matches, expected at least 3' }]);
    g.nodes[1] = node('sel', 'selector', { mode: 'css', selector: 'h2', expect: { min: 1, max: 2 } });
    r = (await run(g)).results;
    expect(r.sel.problems).toBeUndefined();
    expect(r.out.upstreamProblems).toBeUndefined();
  });

  it('a Replace match by match with a different number of parts is a problem', async () => {
    const g: Graph = {
      nodes: [
        node('src', 'documentSource', { fileId: 'html' }), node('parts', 'documentSource', { fileId: 'parts' }),
        node('sel', 'selector', { mode: 'css', selector: 'h2' }), node('rep', 'replace', { target: 'inside', pairs: true }), node('out', 'output'),
      ],
      edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'rep', 'selection'), edge('parts', 'document', 'rep', 'content'), edge('rep', 'document', 'out', 'document')],
    };
    const r = (await run(g)).results;
    expect(r.rep.problems).toEqual(['The content has 3 parts for 2 matches: the last 1 is left out']);
    expect(r.rep.warnings).not.toContain(r.rep.problems![0]);
    expect(r.out.upstreamProblems?.map((p) => p.nodeId)).toEqual(['rep']);
  });

  it('a saved selection that cannot be found is a problem', async () => {
    const g: Graph = {
      nodes: [node('src', 'documentSource', { fileId: 'html' }), node('sel', 'selector', { mode: 'point', point: { anchor: { id: 'a', quote: { exact: 'Not in the text at all', prefix: '', suffix: '' } }, place: 'after' } }), node('out', 'output')],
      edges: [edge('src', 'document', 'sel', 'document'), edge('src', 'document', 'out', 'document')],
    };
    const r = (await run(g)).results;
    expect(r.sel.problems?.[0]).toMatch(/could not be found/);
  });

  it('an Output of a page variant lists the problems of that page\'s nodes', async () => {
    const g: Graph = {
      nodes: [
        node('src', 'documentSource', { fileId: 'html' }),
        node('sel', 'selector', { mode: 'css', selector: 'h2' }, { variants: { b: { selector: 'h3', expect: { min: 1 } } } }),
        node('snip', 'snippet', custom),
        node('outA', 'output'),
        node('outB', 'output', { variant: 'b' }),
      ],
      edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'snip', 'selection'), edge('snip', 'document', 'outA', 'document'), edge('snip', 'document', 'outB', 'document')],
    };
    const { results, variants } = await run(g);
    expect(results.outA.upstreamProblems).toBeUndefined();
    expect(results.outB.upstreamProblems).toEqual([{ nodeId: 'sel', problem: 'Found 0 matches, expected at least 1' }]);
    expect(variants.b.sel.problems).toEqual(['Found 0 matches, expected at least 1']);
  });
});
