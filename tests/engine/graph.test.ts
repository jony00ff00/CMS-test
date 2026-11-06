import { describe, expect, it } from 'vitest';
import {
  connect, DEFAULT_SNIPPET, downstreamOf, edgeError, GraphEvaluator, hashValue, nodeRegistry, stableStringify, storeFile,
  topologicalSort, validateGraph, type EvalContext, type Graph, type GraphNode, type NodeRegistry,
} from '../../src/engine';
import { fixture } from './helpers';

const html = storeFile('sample.html', fixture('sample.html'), 'html');
const json = storeFile('sample.json', fixture('sample.json'), 'json');
const ctx: EvalContext = { files: { html, json } };

const node = (id: string, type: string, config?: unknown): GraphNode => ({
  id, type, config: config ?? nodeRegistry[type].defaultConfig(),
});
const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({
  id: `${source}-${target}`, source, sourcePort, target, targetPort,
});

/** source → selector → snippet → output */
function pipeline(): Graph {
  return {
    nodes: [
      node('src', 'documentSource', { fileId: 'html' }),
      node('sel', 'selector', { mode: 'css', selector: 'h2' }),
      node('snip', 'snippet'),
      node('out', 'output', { fullDocument: false }),
    ],
    edges: [
      edge('src', 'document', 'sel', 'document'),
      edge('sel', 'selection', 'snip', 'selection'),
      edge('snip', 'document', 'out', 'document'),
    ],
  };
}

const setConfig = (graph: Graph, id: string, config: unknown): Graph => ({
  ...graph,
  nodes: graph.nodes.map((n) => (n.id === id ? { ...n, config } : n)),
});

describe('hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });

  it('hashes file contents', () => {
    expect(storeFile('a.html', '<p>x</p>').hash).toBe(storeFile('b.html', '<p>x</p>').hash);
    expect(storeFile('a.html', '<p>x</p>').hash).not.toBe(storeFile('a.html', '<p>y</p>').hash);
    expect(storeFile('a.docx', new Uint8Array(100_000).fill(7)).hash).toMatch(/^[0-9a-z]+$/);
  });
});

describe('node registry', () => {
  it('has the node types with typed ports', () => {
    expect(Object.keys(nodeRegistry)).toEqual(['documentSource', 'selector', 'snippet', 'insert', 'output']);
    const ports = Object.values(nodeRegistry).map((d) => [d.type, d.inputs.map((p) => p.type), d.outputs.map((p) => p.type)]);
    expect(ports).toEqual([
      ['documentSource', [], ['document']],
      ['selector', ['document'], ['selection']],
      ['snippet', ['selection'], ['document']],
      ['insert', ['document'], ['document']],
      ['output', ['document'], ['html']],
    ]);
  });

  it('gives fresh default configs', () => {
    const a = nodeRegistry.snippet.defaultConfig() as { snippet: { name: string } };
    a.snippet.name = 'changed';
    expect(DEFAULT_SNIPPET.name).toBe('Callout');
  });
});

describe('connections', () => {
  const graph = (): Graph => ({ nodes: pipeline().nodes, edges: [] });

  it('accepts matching port types', () => {
    const r = connect(graph(), { source: 'src', sourcePort: 'document', target: 'sel', targetPort: 'document' }, nodeRegistry);
    expect('graph' in r && r.graph.edges).toHaveLength(1);
  });

  it('rejects mismatched types, unknown ports and nodes, self-loops and double inputs', () => {
    const g = graph();
    const err = (e: Parameters<typeof edgeError>[1], gr = g) => edgeError(gr, e, nodeRegistry);
    expect(err({ source: 'src', sourcePort: 'document', target: 'snip', targetPort: 'selection' })).toBe(
      'Cannot connect a document output to a selection input',
    );
    expect(err({ source: 'src', sourcePort: 'nope', target: 'sel', targetPort: 'document' })).toBe('Document Source has no output "nope"');
    expect(err({ source: 'src', sourcePort: 'document', target: 'sel', targetPort: 'nope' })).toBe('Selector has no input "nope"');
    expect(err({ source: 'ghost', sourcePort: 'document', target: 'sel', targetPort: 'document' })).toBe(
      'Both ends of a connection must be nodes in the graph',
    );
    expect(err({ source: 'sel', sourcePort: 'selection', target: 'sel', targetPort: 'document' })).toBe('A node cannot connect to itself');
    const one = pipeline();
    expect(err({ source: 'snip', sourcePort: 'document', target: 'sel', targetPort: 'document' }, one)).toBe(
      'Selector input "Document" is already connected',
    );
  });

  it('rejects connections that would create a loop', () => {
    const g: Graph = {
      nodes: [...pipeline().nodes, node('sel2', 'selector'), node('snip2', 'snippet')],
      edges: [...pipeline().edges, edge('snip', 'document', 'sel2', 'document'), edge('sel2', 'selection', 'snip2', 'selection')],
    };
    // snip2 → sel would be fine type-wise, but sel already has an input; free it first.
    const freed = { ...g, edges: g.edges.filter((e) => e.id !== 'src-sel') };
    expect(edgeError(freed, { source: 'snip2', sourcePort: 'document', target: 'sel', targetPort: 'document' }, nodeRegistry)).toBe(
      'This connection would create a loop',
    );
  });

  it('never changes the graph it is given', () => {
    const g = graph();
    connect(g, { source: 'src', sourcePort: 'document', target: 'sel', targetPort: 'document' }, nodeRegistry);
    expect(g.edges).toEqual([]);
  });
});

describe('graph structure', () => {
  it('sorts nodes after the nodes they depend on, keeping the given order otherwise', () => {
    const g = pipeline();
    expect(topologicalSort({ ...g, nodes: [...g.nodes].reverse() })).toEqual(['src', 'sel', 'snip', 'out']);
    const branches: Graph = { nodes: [node('b', 'documentSource'), node('a', 'documentSource')], edges: [] };
    expect(topologicalSort(branches)).toEqual(['b', 'a']);
  });

  it('reports loops in graphs loaded from files', () => {
    const g = pipeline();
    const looped = { ...g, edges: [...g.edges, edge('snip', 'document', 'sel', 'document')] };
    expect(() => topologicalSort(looped)).toThrow('The graph has a loop through sel, snip, out');
    expect(validateGraph(looped, nodeRegistry).map((i) => i.message)).toEqual(['Selector input "Document" is already connected']);
    expect(validateGraph({ nodes: [node('x', 'selector'), { id: 'x', type: 'mystery', config: {} }], edges: [] }, nodeRegistry)).toEqual([
      { nodeId: 'x', message: 'Duplicate node id "x"' },
      { nodeId: 'x', message: 'Unknown node type "mystery"' },
    ]);
  });

  it('finds downstream nodes', () => {
    expect(downstreamOf(pipeline(), 'sel').sort()).toEqual(['out', 'snip']);
    expect(downstreamOf(pipeline(), 'out')).toEqual([]);
  });
});

describe('evaluation', () => {
  it('runs the whole pipeline', async () => {
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(pipeline(), ctx);
    expect(Object.values(results).map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(results.src.info).toEqual({ file: 'sample.html', format: 'html', title: 'Field Guide to Node Gardens' });
    expect(results.sel.info).toEqual({ matches: 2 });
    expect(results.snip.info).toEqual({ applied: 2 });
    const out = results.out.outputs.html as string;
    expect(out).toContain('<aside class="callout callout-info"><h2>Getting started</h2></aside>');
    expect(out).toContain('<aside class="callout callout-info"><h2>Pricing</h2></aside>');
  });

  it('writes a full page with the snippet CSS', async () => {
    const g = setConfig(pipeline(), 'out', { fullDocument: true });
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(results.out.outputs.html).toMatch(/^<!doctype html><html><head><meta charset="utf-8"><title>Field Guide to Node Gardens<\/title><style>\/\* callout@1 \*\/\n\.callout\{/);
  });

  it('re-runs only the changed node and the nodes after it', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry);
    const first = await evaluator.evaluate(pipeline(), ctx);
    expect(first.ran).toEqual(['src', 'sel', 'snip', 'out']);

    const again = await evaluator.evaluate(pipeline(), ctx);
    expect(again.ran).toEqual([]);
    expect(Object.values(again.results).every((r) => r.cached)).toBe(true);

    const snippetChanged = setConfig(pipeline(), 'snip', { snippet: DEFAULT_SNIPPET, params: { variant: 'warning' } });
    const third = await evaluator.evaluate(snippetChanged, ctx);
    expect(third.ran).toEqual(['snip', 'out']);
    expect(third.results.out.outputs.html).toContain('callout-warning');

    const selectorChanged = setConfig(snippetChanged, 'sel', { mode: 'css', selector: 'h1' });
    expect((await evaluator.evaluate(selectorChanged, ctx)).ran).toEqual(['sel', 'snip', 'out']);

    // Back to an earlier state: everything is still in the cache.
    expect((await evaluator.evaluate(pipeline(), ctx)).ran).toEqual([]);
  });

  it('re-runs everything when the source file changes, but not when an unused file does', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry);
    await evaluator.evaluate(pipeline(), ctx);
    const otherUnused = { files: { ...ctx.files, json: storeFile('x.json', '{"a":"b"}', 'json') } };
    expect((await evaluator.evaluate(pipeline(), otherUnused)).ran).toEqual([]);
    const edited = { files: { ...ctx.files, html: storeFile('sample.html', '<h2>Only one</h2>', 'html') } };
    const r = await evaluator.evaluate(pipeline(), edited);
    expect(r.ran).toEqual(['src', 'sel', 'snip', 'out']);
    expect(r.results.sel.info).toEqual({ matches: 1 });
  });

  it('runs independent branches separately: changing one leaves the other cached', async () => {
    const base = pipeline();
    const g: Graph = {
      nodes: [...base.nodes, node('src2', 'documentSource', { fileId: 'json' }), node('sel2', 'selector', { mode: 'regex', pattern: 'node' }), node('snip2', 'snippet'), node('out2', 'output')],
      edges: [...base.edges, edge('src2', 'document', 'sel2', 'document'), edge('sel2', 'selection', 'snip2', 'selection'), edge('snip2', 'document', 'out2', 'document')],
    };
    const evaluator = new GraphEvaluator(nodeRegistry);
    expect((await evaluator.evaluate(g, ctx)).ran.sort()).toEqual(['out', 'out2', 'sel', 'sel2', 'snip', 'snip2', 'src', 'src2']);
    const changed = setConfig(g, 'sel2', { mode: 'regex', pattern: 'plan' });
    expect((await evaluator.evaluate(changed, ctx)).ran).toEqual(['sel2', 'snip2', 'out2']);
  });

  it('shares an upstream node between two branches', async () => {
    const base = pipeline();
    const g: Graph = {
      nodes: [...base.nodes, node('sel2', 'selector', { mode: 'heading', text: 'Pricing' }), node('snip2', 'snippet'), node('out2', 'output', { fullDocument: false })],
      edges: [...base.edges, edge('src', 'document', 'sel2', 'document'), edge('sel2', 'selection', 'snip2', 'selection'), edge('snip2', 'document', 'out2', 'document')],
    };
    const { results, ran } = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(ran.filter((id) => id === 'src')).toHaveLength(1);
    expect(results.out2.outputs.html).toMatch(/^<h1>.*<aside class="callout callout-info"><h2>Pricing<\/h2>/);
  });

  it('chains selectors and snippets', async () => {
    const base = pipeline();
    const g: Graph = {
      nodes: [...base.nodes.filter((n) => n.id !== 'out'), node('sel2', 'selector', { mode: 'css', selector: 'aside' }), node('snip2', 'snippet', {
        snippet: { ...DEFAULT_SNIPPET, id: 'section', name: 'Section', template: '<section>{{content}}</section>', params: [], css: undefined },
      }), node('out', 'output', { fullDocument: false })],
      edges: [base.edges[0], base.edges[1], edge('snip', 'document', 'sel2', 'document'), edge('sel2', 'selection', 'snip2', 'selection'), edge('snip2', 'document', 'out', 'document')],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(results.out.outputs.html).toContain('<section><aside class="callout callout-info"><h2>Pricing</h2></aside></section>');
  });

  it('waits for a file or a connection instead of failing', async () => {
    const noFile = setConfig(pipeline(), 'src', {});
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(noFile, ctx);
    expect(results.src).toMatchObject({ status: 'waiting', message: 'Choose a .html, .docx or .json file' });
    expect(results.sel).toMatchObject({ status: 'waiting', message: 'Waiting for the nodes before this one' });
    expect(results.out.status).toBe('waiting');

    const unconnected: Graph = { nodes: [node('snip', 'snippet')], edges: [] };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(unconnected, ctx);
    expect(r.results.snip).toMatchObject({ status: 'waiting', message: 'Connect the Selection input' });

    const missingFile = setConfig(pipeline(), 'src', { fileId: 'deleted' });
    expect((await new GraphEvaluator(nodeRegistry).evaluate(missingFile, ctx)).results.src.message).toMatch(/no longer in the project/);
  });

  it('reports errors and blocks the nodes after them', async () => {
    const broken = { files: { html: storeFile('broken.json', '{"a": [1,]}', 'html') } };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(pipeline(), broken);
    expect(results.src).toMatchObject({ status: 'error', message: "broken.json is not valid JSON (line 1, column 9): Trailing comma before ']'" });
    expect(results.sel).toMatchObject({ status: 'blocked' });
    expect(results.out).toMatchObject({ status: 'blocked' });
  });

  it('passes warnings through and does not cache failures', async () => {
    let calls = 0;
    const registry: NodeRegistry = {
      ...nodeRegistry,
      flaky: {
        type: 'flaky', label: 'Flaky', description: '', inputs: [], outputs: [{ name: 'document', type: 'document', label: 'Document' }],
        defaultConfig: () => ({}),
        async evaluate() {
          calls++;
          throw new Error('network down');
        },
      },
    };
    const g: Graph = { nodes: [node('f', 'selector', {}), { id: 'x', type: 'flaky', config: {} }], edges: [] };
    const evaluator = new GraphEvaluator(registry);
    expect((await evaluator.evaluate(g, ctx)).results.x).toMatchObject({ status: 'error', message: 'network down' });
    await evaluator.evaluate(g, ctx);
    expect(calls).toBe(2);

    const sel = setConfig(pipeline(), 'sel', { mode: 'css', selector: 'video' });
    const r = await new GraphEvaluator(nodeRegistry).evaluate(sel, ctx);
    expect(r.results.sel.warnings).toEqual(['"video" matched nothing']);
  });

  it('keeps the cache within its size limit', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry, { cacheSize: 5 });
    for (const tag of ['h1', 'h2', 'p', 'li', 'td']) await evaluator.evaluate(setConfig(pipeline(), 'sel', { mode: 'css', selector: tag }), ctx);
    expect(evaluator.cachedCount).toBe(5);
  });

  it('runs a JSON source through a JSON field selector', async () => {
    const g = setConfig(setConfig(pipeline(), 'src', { fileId: 'json', json: { mode: 'fields', fields: [{ path: '$.faq[*].a', format: 'markdown' }] } }), 'sel', {
      mode: 'jsonField', path: '$.faq[1].a',
    });
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(results.out.outputs.html).toContain('<aside class="callout callout-info"><div data-json-path="$.faq[1].a"><p>No. Nodes never change');
  });

  it('never changes the graph or the file store', async () => {
    const g = pipeline();
    const before = JSON.stringify(g);
    const files = JSON.stringify(Object.keys(ctx.files));
    await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(JSON.stringify(g)).toBe(before);
    expect(JSON.stringify(Object.keys(ctx.files))).toBe(files);
  });
});
