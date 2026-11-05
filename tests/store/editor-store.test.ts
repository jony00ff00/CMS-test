import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/store/editor-store';

const make = () => createEditorStore({ evaluateDelay: 1 });

describe('editor store', () => {
  it('adds nodes with unique ids, default configs and positions left to right', () => {
    const s = make().getState();
    const a = s.addNode('documentSource');
    const b = s.addNode('selector');
    const c = s.addNode('selector');
    expect([a, b, c]).toEqual(['documentSource-1', 'selector-2', 'selector-3']);
    const nodes = make().getState().graph.nodes;
    expect(nodes).toEqual([]);
  });

  it('places new nodes to the right and selects them', () => {
    const store = make();
    const s = store.getState();
    s.addNode('documentSource');
    s.addNode('selector');
    const [n1, n2] = store.getState().graph.nodes;
    expect(n2.position!.x).toBeGreaterThan(n1.position!.x);
    expect(store.getState().selectedId).toBe('selector-2');
  });

  it('rejects bad connections with a notice', () => {
    const store = make();
    const s = store.getState();
    s.addNode('documentSource');
    s.addNode('snippet');
    const error = s.connect({ source: 'documentSource-1', sourcePort: 'document', target: 'snippet-2', targetPort: 'selection' });
    expect(error).toBe('Cannot connect a document output to a selection input');
    expect(store.getState().notice).toMatchObject({ kind: 'error', text: error });
    expect(store.getState().graph.edges).toEqual([]);
  });

  it('removes edges together with their nodes, and clears the selection', () => {
    const store = make();
    store.getState().loadExample('html');
    store.getState().select('selector-2');
    store.getState().removeNodes(['selector-2']);
    const { graph, selectedId } = store.getState();
    expect(graph.nodes.map((n) => n.id)).toEqual(['documentSource-1', 'snippet-3', 'output-4']);
    expect(graph.edges.map((e) => e.id)).toEqual(['e3']);
    expect(selectedId).toBeUndefined();
  });

  it('evaluates the example automatically after changes', async () => {
    const store = make();
    store.getState().loadExample('html');
    await store.getState().whenIdle();
    const { results } = store.getState();
    expect(results['output-4'].status).toBe('ok');
    expect(results['output-4'].outputs.html).toContain('<aside class="callout callout-info"><h2>Pricing</h2></aside>');

    store.getState().updateConfig('selector-2', { mode: 'css', selector: 'h1' });
    await store.getState().whenIdle();
    expect(store.getState().results['selector-2'].info).toEqual({ matches: 1 });
  });

  it('evaluates the JSON example', async () => {
    const store = make();
    store.getState().loadExample('json');
    await store.getState().whenIdle();
    const r = store.getState().results;
    expect(r['selector-2'].info).toEqual({ matches: 2 });
    expect(r['output-4'].outputs.html).toContain('<aside class="callout callout-info"><div data-json-path="$.faq[0].a">');
  });

  it('uses a chosen file in a source node and resets its JSON mapping', async () => {
    const store = make();
    store.getState().loadExample('json');
    store.getState().chooseFile('documentSource-1', 'other.html', '<h2>Only</h2>');
    const config = store.getState().graph.nodes[0].config as Record<string, unknown>;
    expect(config.json).toBeUndefined();
    await store.getState().whenIdle();
    expect(store.getState().results['documentSource-1'].info.file).toBe('other.html');
  });

  it('does not re-evaluate when only positions change', async () => {
    const store = make();
    store.getState().loadExample('html');
    await store.getState().whenIdle();
    const before = store.getState().results;
    store.getState().moveNode('output-4', { x: 900, y: 300 });
    await store.getState().whenIdle();
    expect(store.getState().results).toBe(before);
  });
});
