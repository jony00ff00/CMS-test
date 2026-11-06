import { describe, expect, it } from 'vitest';
import { createEditorStore, selectedNodeIds } from '../../src/store/editor-store';

const make = () => {
  const store = createEditorStore({ evaluateDelay: 1, storage: null, undoGrouping: 0 });
  const s = store.getState();
  const ids = [s.addNode('selector'), s.addNode('snippet'), s.addNode('output')];
  return { store, ids };
};

describe('selecting several nodes', () => {
  it('adds nodes, makes the last added the main one, and takes them out again', () => {
    const { store, ids: [a, b, c] } = make();
    const s = () => store.getState();
    s().select(a);
    s().changeSelection([b], []);
    expect(selectedNodeIds(s())).toEqual([a, b]);
    expect(s().selectedId).toBe(b);
    s().changeSelection([c], []);
    expect(selectedNodeIds(s())).toEqual([a, b, c]);
    // Taking out the main one: the last one left becomes main.
    s().changeSelection([], [c]);
    expect(selectedNodeIds(s())).toEqual([a, b]);
    expect(s().selectedId).toBe(b);
    // Taking out another keeps the main one.
    s().changeSelection([], [a]);
    expect(selectedNodeIds(s())).toEqual([b]);
    expect(s().selectedIds).toBeUndefined();
    s().changeSelection([], [b]);
    expect(selectedNodeIds(s())).toEqual([]);
  });

  it('a plain select, or a new main node set anywhere else, leaves only that node', () => {
    const { store, ids: [a, b, c] } = make();
    const s = () => store.getState();
    s().select(a);
    s().changeSelection([b, c], []);
    s().select(b);
    expect(selectedNodeIds(s())).toEqual([b]);
    s().changeSelection([a], []);
    const d = s().addNode('connector'); // a new node is selected alone
    expect(selectedNodeIds(s())).toEqual([d]);
  });

  it('deleted nodes leave the selection', () => {
    const { store, ids: [a, b, c] } = make();
    const s = () => store.getState();
    s().select(a);
    s().changeSelection([b, c], []);
    s().removeElements([a, b], []);
    expect(selectedNodeIds(s())).toEqual([c]);
  });

  it('moving several nodes is one undo step', () => {
    const { store, ids: [a, b] } = make();
    const s = () => store.getState();
    const before = s().graph.nodes.map((n) => n.position);
    s().moveNodes({ [a]: { x: 500, y: 500 }, [b]: { x: 600, y: 500 } });
    expect(s().graph.nodes.find((n) => n.id === b)?.position).toEqual({ x: 600, y: 500 });
    store.temporal.getState().undo();
    expect(s().graph.nodes.map((n) => n.position)).toEqual(before);
  });
});
