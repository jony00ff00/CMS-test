import { describe, expect, it } from 'vitest';
import { createEditorStore, selectedNodeIds } from '../../src/store/editor-store';
import { parseProject, projectToJson } from '../../src/store/project';
import { collapsedPorts, frameBox, portHandle, resolveHandle } from '../../src/ui/canvas/group-layout';

const make = () => {
  const store = createEditorStore({ evaluateDelay: 1, storage: null, undoGrouping: 0 });
  store.getState().loadExample('html'); // documentSource-1 → selector-2 → snippet-3 → output-4
  return { store, s: () => store.getState() };
};
const groups = (s: ReturnType<ReturnType<typeof make>['s']>) => s.graph.groups ?? [];

describe('groups', () => {
  it('groups nodes with a name and colour, selects the group, and is one undo step', () => {
    const { store, s } = make();
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    expect(groups(s())).toEqual([{ id, name: 'Group 1', nodeIds: ['selector-2', 'snippet-3'], color: '#2563eb' }]);
    expect(s().selectedGroupId).toBe(id);
    expect(selectedNodeIds(s())).toEqual(['selector-2', 'snippet-3']);
    // The next group gets the next name and colour.
    s().groupNodes(['output-4']);
    expect(groups(s()).map((g) => [g.name, g.color])).toEqual([['Group 1', '#2563eb'], ['Group 2', '#059669']]);
    store.temporal.getState().undo();
    expect(groups(s())).toHaveLength(1);
  });

  it('a node is in one group: grouping it again moves it, and a group left empty is gone', () => {
    const { s } = make();
    const a = s().groupNodes(['selector-2'])!;
    const b = s().groupNodes(['selector-2', 'snippet-3'])!;
    expect(groups(s()).map((g) => g.id)).toEqual([b]);
    expect(a).not.toBe(b);
    s().addToGroup(b, ['output-4']);
    s().removeFromGroup(['selector-2']);
    expect(groups(s())[0].nodeIds).toEqual(['snippet-3', 'output-4']);
  });

  it('renames, recolours, collapses and ungroups; none of it re-runs the graph', async () => {
    const { s } = make();
    await s().whenIdle();
    const before = s().results;
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    s().renameGroup(id, 'Headings');
    s().setGroupColor(id, '#db2777');
    s().setGroupCollapsed(id, true);
    expect(groups(s())[0]).toMatchObject({ name: 'Headings', color: '#db2777', collapsed: true });
    await s().whenIdle();
    expect(s().results).toBe(before);
    s().ungroup(id);
    expect(groups(s())).toEqual([]);
    expect(s().selectedGroupId).toBeUndefined();
  });

  it('deleting nodes takes them out of their group; deleting a group with its nodes removes them', () => {
    const { s } = make();
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    s().removeElements(['selector-2'], []);
    expect(groups(s())[0].nodeIds).toEqual(['snippet-3']);
    s().deleteGroupAndNodes(id);
    expect(groups(s())).toEqual([]);
    expect(s().graph.nodes.map((n) => n.id)).toEqual(['documentSource-1', 'output-4']);
  });

  it('a duplicated node joins its group; a duplicated group copies its nodes and connections', () => {
    const { s } = make();
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    s().renameGroup(id, 'Headings');
    const copy = s().duplicateNode('snippet-3')!;
    expect(groups(s())[0].nodeIds).toContain(copy);
    s().removeElements([copy], []);

    const dup = s().duplicateGroup(id)!;
    const g = groups(s()).find((x) => x.id === dup)!;
    expect(g.name).toBe('Headings copy');
    expect(g.nodeIds).toHaveLength(2);
    const [sel, snip] = g.nodeIds;
    const edges = s().graph.edges.map((e) => `${e.source}.${e.sourcePort}>${e.target}.${e.targetPort}`);
    // The copy's own connection, and the one coming in from outside; nothing goes out of it yet.
    expect(edges).toContain(`${sel}.selection>${snip}.selection`);
    expect(edges).toContain(`documentSource-1.document>${sel}.document`);
    expect(edges.filter((e) => e.startsWith(`${snip}.`))).toEqual([]);
    // Placed below the original.
    const y = (nid: string) => s().graph.nodes.find((n) => n.id === nid)!.position!.y;
    expect(y(sel)).toBeGreaterThan(y('selector-2'));
  });

  it('focusGroup selects the group and asks the canvas to fit it', () => {
    const { s } = make();
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    s().select('output-4');
    expect(s().selectedGroupId).toBeUndefined();
    s().focusGroup(id);
    expect(s().selectedGroupId).toBe(id);
    expect(s().fitTo).toMatchObject({ groupId: id, nodeIds: ['selector-2', 'snippet-3'], n: 1 });
  });

  it('are saved in project files and read back; broken parts are left out with warnings', () => {
    const { s } = make();
    s().groupNodes(['selector-2', 'snippet-3'], 'Headings');
    const json = projectToJson({ graph: s().graph, files: s().files, library: s().library });
    expect(parseProject(json).project.graph.groups).toEqual(s().graph.groups);

    const raw = JSON.parse(json);
    raw.graph.groups = [
      { id: 'a', name: 'A', nodeIds: ['selector-2', 'gone'], color: 'red', collapsed: true },
      { id: 'b', name: 'B', nodeIds: ['selector-2', 'snippet-3'] },
      { id: 'c', name: 'C', nodeIds: ['gone'] },
      { nodeIds: [] },
    ];
    const { project, warnings } = parseProject(JSON.stringify(raw));
    expect(project.graph.groups).toEqual([
      { id: 'a', name: 'A', nodeIds: ['selector-2'], collapsed: true },
      { id: 'b', name: 'B', nodeIds: ['snippet-3'] },
    ]);
    expect(warnings).toEqual([
      'The node "selector-2" was in two groups; it stays in the first',
      'The group "C" has no nodes left and was left out',
      'A group could not be read and was left out',
    ]);
    // Projects without groups still open, with none.
    delete raw.graph.groups;
    expect(parseProject(JSON.stringify(raw)).project.graph.groups).toBeUndefined();
  });
});

describe('group layout', () => {
  it('the frame goes around the nodes with room for its header', () => {
    expect(frameBox([{ position: { x: 100, y: 200 }, measured: { width: 200, height: 80 } }, { position: { x: 400, y: 260 } }])).toEqual({
      x: 84, y: 150, width: 552, height: 216,
    });
  });

  it('a collapsed group shows its outside connections and its unconnected ports', () => {
    const { s } = make();
    const id = s().groupNodes(['selector-2', 'snippet-3'])!;
    const ports = collapsedPorts(s().graph, groups(s()).find((g) => g.id === id)!);
    expect(ports.inputs.map((p) => p.handle)).toEqual([portHandle('in', 'selector-2', 'document')]);
    // The Selector's Selection goes only to the Snippet (inside): not shown. Its Point is unconnected: shown.
    expect(ports.outputs.map((p) => p.handle)).toEqual([portHandle('out', 'selector-2', 'point'), portHandle('out', 'snippet-3', 'document')]);
    expect(ports.outputs[1].label).toBe('snippet-3 · Document');
    expect(resolveHandle('group:x', portHandle('out', 'snippet-3', 'document'))).toEqual({ node: 'snippet-3', port: 'document' });
    expect(resolveHandle('snippet-3', 'document')).toEqual({ node: 'snippet-3', port: 'document' });
  });
});
