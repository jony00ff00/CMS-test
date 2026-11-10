import { describe, expect, it } from 'vitest';
import {
  connect, DEFAULT_SNIPPET, downstreamOf, edgeError, GraphEvaluator, hashValue, moveEdge, nodeRegistry, serialize, stableStringify, storeFile,
  topologicalSort, validateGraph, type CmsDocument, type EvalContext, type Graph, type GraphNode, type NodeRegistry,
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
    expect(Object.keys(nodeRegistry)).toEqual(['documentSource', 'selector', 'snippet', 'extractor', 'object', 'replace', 'output', 'connector']);
    const ports = Object.values(nodeRegistry).map((d) => [d.type, d.inputs.map((p) => p.type), d.outputs.map((p) => p.type)]);
    expect(ports).toEqual([
      ['documentSource', [], ['document']],
      ['selector', ['document'], ['selection', 'point']],
      ['snippet', ['any'], ['document']],
      ['extractor', ['document'], ['document']],
      ['object', ['point', 'any'], ['document']],
      ['replace', ['selection', 'any'], ['document']],
      ['output', ['document'], ['html', 'result']],
      ['connector', ['any'], ['document', 'selection', 'html', 'result']],
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
    expect(err({ source: 'sel', sourcePort: 'selection', target: 'out', targetPort: 'document' })).toBe(
      'Cannot connect a selection output to a document input',
    );
    // A Snippet takes a selection or a whole document.
    expect(err({ source: 'src', sourcePort: 'document', target: 'snip', targetPort: 'selection' })).toBeUndefined();
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
    expect(results.src).toMatchObject({ status: 'waiting', message: 'Choose a .html, .docx, .pptx or .json file' });
    expect(results.sel).toMatchObject({ status: 'waiting', message: 'Waiting for the nodes before this one' });
    expect(results.out.status).toBe('waiting');

    const unconnected: Graph = { nodes: [node('snip', 'snippet')], edges: [] };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(unconnected, ctx);
    expect(r.results.snip).toMatchObject({ status: 'waiting', message: 'Connect the Selection or document input' });

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

describe('an Output with several inputs', () => {
  const two = (): Graph => ({
    nodes: [
      node('src', 'documentSource', { fileId: 'html' }),
      node('sel', 'selector', { mode: 'css', selector: 'h1' }),
      node('snip', 'snippet'),
      node('pt', 'selector', { ...{ mode: 'css', selector: 'h1' }, place: 'after' }),
      node('ins', 'object', { content: { kind: 'code', code: '<p>Inserted</p>', render: 'html' } }),
      node('out', 'output', { fullDocument: false, combine: 'append' }),
    ],
    edges: [
      edge('src', 'document', 'sel', 'document'),
      edge('sel', 'selection', 'snip', 'selection'),
      edge('src', 'document', 'pt', 'document'),
      edge('pt', 'point', 'ins', 'point'),
      { id: 'a', source: 'snip', sourcePort: 'document', target: 'out', targetPort: 'document' },
      { id: 'b', source: 'ins', sourcePort: 'document', target: 'out', targetPort: 'document' },
    ],
  });

  it('accepts several connections, but not the same one twice', () => {
    expect(validateGraph(two(), nodeRegistry)).toEqual([]);
    expect(edgeError(two(), { source: 'ins', sourcePort: 'document', target: 'out', targetPort: 'document' }, nodeRegistry)).toBe(
      'These two are already connected',
    );
    expect(nodeRegistry.output.inputs[0].multiple).toBe(true);
    // Other inputs still take one connection.
    expect(edgeError(two(), { source: 'ins', sourcePort: 'document', target: 'sel', targetPort: 'document' }, nodeRegistry)).toBe(
      'Selector input "Document" is already connected',
    );
  });

  it('"one after another" shows the documents in connection order, and they can be reordered', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry);
    const first = await evaluator.evaluate(two(), ctx);
    const html1 = first.results.out.outputs.html as string;
    expect(html1.indexOf('<aside class="callout callout-info"><h1>')).toBeLessThan(html1.indexOf('<p>Inserted</p>'));
    expect(html1.match(/<h1>/g)).toHaveLength(2);
    expect(first.results.out.info).toMatchObject({ documents: 2 });

    const swapped = moveEdge(two(), 'a', 1);
    expect(swapped.edges.filter((e) => e.target === 'out').map((e) => e.id)).toEqual(['b', 'a']);
    const second = await evaluator.evaluate(swapped, ctx);
    expect(second.ran).toEqual(['out']);
    const html2 = second.results.out.outputs.html as string;
    expect(html2.indexOf('<p>Inserted</p>')).toBeLessThan(html2.indexOf('<aside class="callout'));
    expect(moveEdge(swapped, 'a', 1)).toEqual(swapped); // already last
  });

  it('keeps one title, all styles and each snippet asset once', async () => {
    const page = await new GraphEvaluator(nodeRegistry).evaluate(setConfig(two(), 'out', { fullDocument: true, combine: 'append' }), ctx);
    const html = page.results.out.outputs.html as string;
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/\/\* callout@1 \*\//g)).toHaveLength(1);
    expect(html.match(/\/\* cms-insert@1 \*\//g)).toHaveLength(1);
  });

  it('refuses JSON export of documents shown one after another', async () => {
    const r = await new GraphEvaluator(nodeRegistry).evaluate(setConfig(two(), 'out', { format: 'json', combine: 'append' }), ctx);
    expect(r.results.out).toMatchObject({ status: 'error', message: 'JSON export writes one JSON file, so connect only one document to this Output' });
  });
});

describe('combining the changes of several inputs (the default)', () => {
  const insertAfterH1 = { content: { kind: 'code', code: '<p>Inserted</p>', render: 'html' } };
  const graph = (order: ('snip' | 'ins')[] = ['snip', 'ins']): Graph => ({
    nodes: [
      node('src', 'documentSource', { fileId: 'html' }),
      node('sel', 'selector', { mode: 'css', selector: 'h2' }),
      node('snip', 'snippet'),
      node('pt', 'selector', { mode: 'css', selector: 'h1', place: 'after' }),
      node('ins', 'object', insertAfterH1),
      node('out', 'output', { fullDocument: false }),
    ],
    edges: [
      edge('src', 'document', 'sel', 'document'),
      edge('sel', 'selection', 'snip', 'selection'),
      edge('src', 'document', 'pt', 'document'),
      edge('pt', 'point', 'ins', 'point'),
      ...order.map((id) => ({ id: `${id}-out`, source: id, sourcePort: 'document', target: 'out', targetPort: 'document' })),
    ],
  });
  const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

  it('gives one document with every change', async () => {
    const r = await new GraphEvaluator(nodeRegistry).evaluate(graph(), ctx);
    const html = r.results.out.outputs.html as string;
    expect(count(html, /<h1>/g)).toBe(1);
    expect(count(html, /<aside class="callout callout-info"><h2>/g)).toBe(2);
    expect(html).toContain('<h1>Field Guide to Node Gardens</h1><p>Inserted</p>');
    expect(r.results.out.info).toMatchObject({ combined: 2 });
  });

  it('keeps each node’s own result, and hides the copies it ran', async () => {
    const r = await new GraphEvaluator(nodeRegistry).evaluate(graph(), ctx);
    expect(Object.keys(r.results).sort()).toEqual(['ins', 'out', 'pt', 'sel', 'snip', 'src']);
    expect(r.results.ins.outputs.document).toBeDefined();
    const insOnly = (r.results.ins.outputs.document as { tree: unknown }).tree;
    expect(JSON.stringify(insOnly)).not.toContain('callout');
    expect(r.ran.every((id) => !id.includes('~'))).toBe(true);
  });

  it('applies the changes in input order, and caches like any node', async () => {
    const evaluator = new GraphEvaluator(nodeRegistry);
    await evaluator.evaluate(graph(), ctx);
    expect((await evaluator.evaluate(graph(), ctx)).ran).toEqual([]);
    const reversed = await evaluator.evaluate(graph(['ins', 'snip']), ctx);
    const html = reversed.results.out.outputs.html as string;
    expect(count(html, /<h1>/g)).toBe(1);
    expect(html).toContain('<p>Inserted</p>');
    expect(count(html, /<aside class="callout/g)).toBe(2);
  });

  it('re-runs a shared Selector on the changed document', async () => {
    const shared: Graph = {
      nodes: [
        node('src', 'documentSource', { fileId: 'html' }),
        node('sel', 'selector', { mode: 'css', selector: 'h2' }),
        node('a', 'snippet', { snippet: { ...DEFAULT_SNIPPET, id: 'a', template: '<section class="a">{{content}}</section>', params: [], css: undefined } }),
        node('b', 'snippet', { snippet: { ...DEFAULT_SNIPPET, id: 'b', template: '<div class="b">{{content}}</div>', params: [], css: undefined } }),
        node('out', 'output', { fullDocument: false }),
      ],
      edges: [
        edge('src', 'document', 'sel', 'document'),
        edge('sel', 'selection', 'a', 'selection'),
        edge('sel', 'selection', 'b', 'selection'),
        { id: 'x', source: 'a', sourcePort: 'document', target: 'out', targetPort: 'document' },
        { id: 'y', source: 'b', sourcePort: 'document', target: 'out', targetPort: 'document' },
      ],
    };
    const html = (await new GraphEvaluator(nodeRegistry).evaluate(shared, ctx)).results.out.outputs.html as string;
    expect(count(html, /<div class="b"><section class="a"><h2>|<section class="a"><div class="b"><h2>/g)).toBe(2);
  });

  it('shows documents from different sources one after another', async () => {
    const g: Graph = {
      nodes: [node('h', 'documentSource', { fileId: 'html' }), node('j', 'documentSource', { fileId: 'json' }), node('out', 'output', { fullDocument: false })],
      edges: [
        { id: 'a', source: 'h', sourcePort: 'document', target: 'out', targetPort: 'document' },
        { id: 'b', source: 'j', sourcePort: 'document', target: 'out', targetPort: 'document' },
      ],
    };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(r.results.out.info).toMatchObject({ documents: 2 });
    expect(r.results.out.info.combined).toBeUndefined();
  });

  it('can export combined changes of a JSON source as JSON', async () => {
    const g: Graph = {
      nodes: [
        node('src', 'documentSource', { fileId: 'json', json: { mode: 'fields', fields: [{ path: '$.faq[*].a', format: 'markdown' }] } }),
        node('sel', 'selector', { mode: 'jsonField', path: '$.faq[0].a' }),
        node('snip', 'snippet'),
        node('pt', 'selector', { ...{ mode: 'jsonField', path: '$.faq[1].a' }, place: 'end' }),
      node('ins', 'object', { content: { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A' } }),
        node('out', 'output', { format: 'json' }),
      ],
      edges: [
        edge('src', 'document', 'sel', 'document'),
        edge('sel', 'selection', 'snip', 'selection'),
        edge('src', 'document', 'pt', 'document'),
      edge('pt', 'point', 'ins', 'point'),
        { id: 'a', source: 'snip', sourcePort: 'document', target: 'out', targetPort: 'document' },
        { id: 'b', source: 'ins', sourcePort: 'document', target: 'out', targetPort: 'document' },
      ],
    };
    const r = await new GraphEvaluator(nodeRegistry).evaluate(g, ctx);
    expect(r.results.out.status).toBe('ok');
    const data = JSON.parse(r.results.out.outputs.json as string);
    expect(data.faq[0].a).toMatch(/^<aside class="callout callout-info">/);
    expect(data.faq[1].a).toMatch(/<img src="https:\/\/x\.test\/a\.png" alt="A" class="cms-insert" loading="lazy" style="width:100%">$/);
  });
});

describe('connector', () => {
  /** pipeline → Output's Result → Connector → Selector (everything) → Snippet → second Output */
  function chained(): Graph {
    const g = pipeline();
    return {
      nodes: [
        ...g.nodes,
        node('con', 'connector'),
        node('all', 'selector', { mode: 'all' }),
        node('snip2', 'snippet'),
        node('out2', 'output', { fullDocument: true, inlineAssets: false }),
      ],
      edges: [
        ...g.edges,
        edge('out', 'result', 'con', 'input'),
        edge('con', 'document', 'all', 'document'),
        edge('all', 'selection', 'snip2', 'selection'),
        edge('snip2', 'document', 'out2', 'document'),
      ],
    };
  }

  /** `from.port` → Connector, evaluated. */
  async function through(fromNode: string, fromPort: string, config: object = {}) {
    const g = pipeline();
    const graph: Graph = { nodes: [...g.nodes, node('con', 'connector', config)], edges: [...g.edges, edge(fromNode, fromPort, 'con', 'input')] };
    return (await new GraphEvaluator(nodeRegistry).evaluate(graph, ctx)).results;
  }

  it('takes any kind of output, and gives every kind', () => {
    const g = chained();
    const free = { ...g, edges: g.edges.filter((e) => e.target !== 'con') };
    for (const [source, sourcePort] of [['out', 'html'], ['out', 'result'], ['src', 'document'], ['sel', 'selection']]) {
      expect(edgeError(free, { source, sourcePort, target: 'con', targetPort: 'input' }, nodeRegistry), `${source}.${sourcePort}`).toBeUndefined();
    }
    expect(edgeError(g, { source: 'src', sourcePort: 'document', target: 'con', targetPort: 'input' }, nodeRegistry)).toMatch(/already connected/);
    // Its outputs are typed: each goes only where that kind fits.
    expect(edgeError(g, { source: 'con', sourcePort: 'selection', target: 'out2', targetPort: 'document' }, nodeRegistry)).toMatch(/selection output to a document input/);
    // "any" is for inputs: nothing else takes an any-typed value.
    expect(edgeError(free, { source: 'con', sourcePort: 'html', target: 'out2', targetPort: 'document' }, nodeRegistry)).toMatch(/html output/);
  });

  it("passes an Output's document on to more nodes, keeping the earlier changes", async () => {
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(chained(), ctx);
    expect(results.con.status).toBe('ok');
    expect(results.con.info.from).toBe('document');
    expect(results.con.outputs.document).toBe(results.out.outputs.document);
    expect(results.all.info.matches).toBe(1);
    const page = results.out2.outputs.html as string;
    // The first Snippet's callouts are inside the second Snippet's callout around everything.
    expect(page.match(/class="callout/g)!.length).toBe(3);
    expect(page.indexOf('callout')).toBeLessThan(page.indexOf('<h2'));
  });

  it('turns a document into a selection (all of it, or each block) and HTML', async () => {
    const r = await through('src', 'document');
    expect((r.con.outputs.selection as { matches: unknown[] }).matches).toHaveLength(1);
    expect(r.con.outputs.html as string).toMatch(/^<!doctype html>/);
    expect(r.con.outputs.result).toBe(r.src.outputs.document);
    const blocks = await through('src', 'document', { documentToSelection: 'blocks', fullPage: false });
    expect((blocks.con.outputs.selection as { matches: unknown[] }).matches.length).toBeGreaterThan(5);
    expect(blocks.con.outputs.html as string).toMatch(/^<h1>/);
  });

  it('turns a selection into a document of what it selected, or the whole document', async () => {
    const r = await through('sel', 'selection');
    expect(r.con.info.from).toBe('selection');
    expect(serialize(r.con.outputs.document as CmsDocument)).toBe('<h2>Getting started</h2><h2>Pricing</h2>');
    expect(r.con.outputs.selection).toBe(r.sel.outputs.selection);
    const whole = await through('sel', 'selection', { selectionToDocument: 'document' });
    expect(whole.con.outputs.document).toBe(whole.src.outputs.document);
  });

  it('reads HTML into a document (scripts removed) and passes the HTML on as it was', async () => {
    const r = await through('out', 'html');
    expect(r.con.info.from).toBe('html');
    expect(r.con.outputs.html).toBe(r.out.outputs.html);
    const doc = r.con.outputs.document as CmsDocument;
    expect(serialize(doc)).toContain('Field Guide to Node Gardens');
    expect(serialize(doc)).not.toContain('<script');
  });
});
