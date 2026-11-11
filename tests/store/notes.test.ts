import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/store/editor-store';
import { parseProject, projectToJson } from '../../src/store/project';

const make = () => {
  const store = createEditorStore({ evaluateDelay: 1, storage: null, undoGrouping: 1000 });
  store.getState().loadExample('html'); // documentSource-1 → selector-2 → snippet-3 → output-4
  return { store, s: () => store.getState() };
};

describe('notes on the canvas', () => {
  it('adds, edits, colours and deletes notes; typing is one undo step', () => {
    const { store, s } = make();
    const id = s().addNote({ x: 10, y: 20 });
    expect(s().graph.notes).toEqual([{ id: 'note-1', text: '', position: { x: 10, y: 20 } }]);
    s().updateNote(id, { text: 'T' });
    s().updateNote(id, { text: 'Th' });
    s().updateNote(id, { text: 'This part picks the headings' });
    s().updateNote(id, { color: 'blue', width: 300 });
    expect(s().graph.notes![0]).toMatchObject({ text: 'This part picks the headings', color: 'blue', width: 300 });
    // A second note gets the next id; one without a place goes above the top-left node.
    expect(s().addNote()).toBe('note-2');
    expect(s().graph.notes![1].position.y).toBeLessThan(Math.min(...s().graph.nodes.map((n) => n.position!.y)));
    store.temporal.getState().undo(); // the second note
    store.temporal.getState().undo(); // colour and width
    store.temporal.getState().undo(); // the typing, all at once
    expect(s().graph.notes).toEqual([{ id: 'note-1', text: '', position: { x: 10, y: 20 } }]);
    s().removeElements([], [], ['note-1']);
    expect(s().graph.notes).toBeUndefined();
  });

  it('never re-runs the graph, and survives deleting nodes', async () => {
    const { s } = make();
    await s().whenIdle();
    const before = s().results;
    const id = s().addNote({ x: 0, y: 0 }, 'Hello');
    s().updateNote(id, { text: 'Hello there', position: { x: 5, y: 5 } });
    await s().whenIdle();
    expect(s().results).toBe(before);
    s().removeElements(['selector-2'], []);
    s().removeNodes(['snippet-3']);
    expect(s().graph.notes).toHaveLength(1);
    // Deleting a node and a note together.
    s().removeElements(['output-4'], [], [id]);
    expect(s().graph.notes).toBeUndefined();
    expect(s().graph.nodes.map((n) => n.id)).toEqual(['documentSource-1']);
  });

  it('are saved in project files; broken ones are left out with a warning', () => {
    const { s } = make();
    const id = s().addNote({ x: 1, y: 2 }, 'Explains the flow');
    s().updateNote(id, { color: 'green' });
    const json = projectToJson({ graph: s().graph, files: s().files, library: s().library });
    const { project, warnings } = parseProject(json);
    expect(warnings).toEqual([]);
    expect(project.graph.notes).toEqual([{ id, text: 'Explains the flow', position: { x: 1, y: 2 }, color: 'green' }]);

    const raw = JSON.parse(json);
    raw.graph.notes.push({ id: 'x', text: 3 }, { id: 'y', text: 'ok', position: { x: 0, y: 0 }, color: 'purple', width: -5 });
    const broken = parseProject(JSON.stringify(raw));
    expect(broken.warnings).toEqual(['A note could not be read and was left out']);
    expect(broken.project.graph.notes![1]).toEqual({ id: 'y', text: 'ok', position: { x: 0, y: 0 } });
  });
});
