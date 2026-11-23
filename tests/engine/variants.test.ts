import { describe, expect, it } from 'vitest';
import {
  GraphEvaluator, nodeRegistry, planVariants, storeFile, variantConfig, variantDifference, variantNames, variantsFor, withVariantSettings,
  cleanVariantName, type Graph, type GraphEdge, type GraphNode,
} from '../../src/engine';

const files = { html: storeFile('a.html', '<h1>Title</h1><h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>', 'html') };
const node = (id: string, type: string, config?: unknown, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, config: config ?? nodeRegistry[type].defaultConfig(), ...extra,
});
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({
  id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort,
});
const custom = (className: string) => ({ snippet: undefined, custom: { className, wrap: 'none' } });

/** Source → Selector (h2) → Snippet (class "plain"; "fancy" for variant b) → Output (no variant) and Output (b). */
function twoPages(): Graph {
  return {
    nodes: [
      node('src', 'documentSource', { fileId: 'html' }),
      node('sel', 'selector', { mode: 'css', selector: 'h2' }),
      node('snip', 'snippet', custom('plain'), { variants: { b: { custom: { className: 'fancy', wrap: 'none' } } } }),
      node('outA', 'output', { format: 'html', fullDocument: false, inlineAssets: true }),
      node('outB', 'output', { format: 'html', fullDocument: false, inlineAssets: true, variant: 'b' }),
    ],
    edges: [
      edge('src', 'document', 'sel', 'document'),
      edge('sel', 'selection', 'snip', 'selection'),
      edge('snip', 'document', 'outA', 'document'),
      edge('snip', 'document', 'outB', 'document'),
    ],
  };
}

describe('variant settings', () => {
  it('merges a variant\'s settings into the node\'s own, and removes keys set to null', () => {
    const n = node('x', 'selector', { mode: 'css', selector: 'h2', place: 'after' }, { variants: { b: { selector: 'p', place: null } } });
    expect(variantConfig(n, 'b')).toEqual({ mode: 'css', selector: 'p' });
    expect(variantConfig(n, undefined)).toBe(n.config);
    expect(variantConfig(n, 'other')).toBe(n.config);
  });

  it('stores only what differs', () => {
    const base = { mode: 'css', selector: 'h2', place: 'after', deep: { a: 1 } };
    expect(variantDifference(base, { ...base })).toBeUndefined();
    expect(variantDifference(base, { ...base, selector: 'p', deep: { a: 1 } })).toEqual({ selector: 'p' });
    const { place: _p, ...noPlace } = base;
    expect(variantDifference(base, noPlace)).toEqual({ place: null });
    const n = withVariantSettings(node('x', 'selector', base), 'b', { selector: 'p' });
    expect(n.variants).toEqual({ b: { selector: 'p' } });
    expect(withVariantSettings(n, 'b', undefined).variants).toBeUndefined();
  });

  it('lists the variants of the Outputs after a node', () => {
    const g = twoPages();
    g.nodes.push(node('outC', 'output', { variant: 'c' }));
    g.edges.push(edge('src', 'document', 'outC', 'document'));
    expect(variantNames(g)).toEqual(['b', 'c']);
    expect(variantsFor(g, 'snip')).toEqual(['b']);
    expect(variantsFor(g, 'src')).toEqual(['b', 'c']);
    expect(variantsFor(g, 'outC')).toEqual(['c']);
    expect(cleanVariantName('  inter~active!  page ')).toBe('interactive page');
  });
});

describe('planVariants', () => {
  it('copies only the nodes whose settings differ and the nodes after them', () => {
    const plan = planVariants(twoPages());
    expect([...plan.copies.values()].map((c) => c.nodeId)).toEqual(['snip']);
    const into = plan.graph.edges.filter((e) => e.target === 'outB');
    expect(into.map((e) => e.source)).toEqual(['variant~b~snip']);
    // The copy reads from the shared Selector.
    expect(plan.graph.edges.find((e) => e.target === 'variant~b~snip')?.source).toBe('sel');
  });

  it('leaves the graph alone without variants', () => {
    const g = twoPages();
    g.nodes[2] = { ...g.nodes[2], variants: undefined };
    expect(planVariants(g).graph).toBe(g);
  });
});

describe('evaluating variants', () => {
  it('makes each page with its own settings and shares the rest', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry);
    const first = await evaluator.evaluate(twoPages(), { files });
    expect(first.results.outA.outputs.html).toContain('<h2 class="plain">One</h2>');
    expect(first.results.outB.outputs.html).toContain('<h2 class="fancy">One</h2>');
    expect(first.results.outB.info.variant).toBe('b');
    // The user's nodes keep their own results; the variant's are separate, under the node ids.
    expect(Object.keys(first.results).sort()).toEqual(['outA', 'outB', 'sel', 'snip', 'src']);
    expect(Object.keys(first.variants.b)).toEqual(['snip']);
    expect(first.variants.b.snip.status).toBe('ok');
    // Nothing changed: nothing runs again.
    const again = await evaluator.evaluate(twoPages(), { files });
    expect(again.ran).toEqual([]);
  });

  it('copies the nodes between the changed one and the Output', async () => {
    const g = twoPages();
    // Settings for b on the Selector: the Snippet after it must be copied too.
    g.nodes[1] = { ...g.nodes[1], variants: { b: { selector: 'h1' } } };
    g.nodes[2] = { ...g.nodes[2], variants: undefined };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(g, { files });
    expect(r.results.outA.outputs.html).toContain('<h2 class="plain">One</h2>');
    expect(r.results.outB.outputs.html).toContain('<h1 class="plain">Title</h1>');
    expect(r.results.outB.outputs.html).toContain('<h2>One</h2>');
    expect(Object.keys(r.variants.b).sort()).toEqual(['sel', 'snip']);
  });

  it('works with an Output that merges two inputs', async () => {
    const g = twoPages();
    g.nodes.push(node('sel2', 'selector', { mode: 'css', selector: 'p' }), node('snip2', 'snippet', custom('para')));
    g.edges.push(edge('src', 'document', 'sel2', 'document'), edge('sel2', 'selection', 'snip2', 'selection'), edge('snip2', 'document', 'outB', 'document'));
    const r = await new GraphEvaluator(nodeRegistry).evaluate(g, { files });
    const html = r.results.outB.outputs.html as string;
    expect(html).toContain('<h2 class="fancy">One</h2>');
    expect(html).toContain('<p class="para">First</p>');
    expect(r.results.outB.info.combined).toBe(2);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('shares copies between Outputs of the same variant', async () => {
    const g = twoPages();
    g.nodes.push(node('outB2', 'output', { fullDocument: false, variant: 'b' }));
    g.edges.push(edge('snip', 'document', 'outB2', 'document'));
    const plan = planVariants(g);
    expect(plan.copies.size).toBe(1);
    const r = await new GraphEvaluator(nodeRegistry).evaluate(g, { files });
    expect(r.results.outB2.outputs.html).toContain('class="fancy"');
  });
});
