import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSource, storeFile, type Graph } from '../../src/engine';
import { createEditorStore, STORAGE_KEY, type ProjectStorage } from '../../src/store/editor-store';
import { fromBase64, parseProject, projectToJson, toBase64, toProjectFile } from '../../src/store/project';
import { seedLibrary } from '../../src/snippets/seed';

const docx = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sample.docx'));
const memory = (): ProjectStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('project files', () => {
  it('opens projects saved when the Connector only took a result (its input was called "result")', () => {
    const graph: Graph = {
      nodes: [
        { id: 'output-1', type: 'output', config: {} },
        { id: 'connector-2', type: 'connector', config: {} },
      ],
      edges: [{ id: 'e1', source: 'output-1', sourcePort: 'result', target: 'connector-2', targetPort: 'result' }],
    };
    const { project, warnings } = parseProject(projectToJson({ graph, files: {}, library: {} }));
    expect(warnings).toEqual([]);
    expect(project.graph.edges).toEqual([{ ...graph.edges[0], targetPort: 'input' }]);
  });

  it('round-trips the graph, text and binary files, and the library', async () => {
    const html = storeFile('a.html', '<h2>Hi</h2>');
    const word = storeFile('b.docx', new Uint8Array(docx));
    const graph: Graph = {
      nodes: [
        { id: 'documentSource-1', type: 'documentSource', config: { fileId: html.id }, position: { x: 1, y: 2 } },
        { id: 'documentSource-2', type: 'documentSource', config: { fileId: word.id } },
        { id: 'selector-3', type: 'selector', config: { mode: 'css', selector: 'h2' } },
      ],
      edges: [{ id: 'e1', source: 'documentSource-1', sourcePort: 'document', target: 'selector-3', targetPort: 'document' }],
    };
    const unused = storeFile('old.html', '<p>old</p>');
    const text = projectToJson({ graph, files: { [html.id]: html, [word.id]: word, [unused.id]: unused }, library: seedLibrary() });
    const { project, warnings } = parseProject(text);
    expect(warnings).toEqual([]);
    expect(project.graph).toEqual(graph);
    expect(Object.keys(project.files).sort()).toEqual([html.id, word.id].sort());
    expect(project.files[word.id].hash).toBe(word.hash);
    const doc = await importSource(project.files[word.id]);
    expect(doc.meta.title).toBe('Field Guide to Node Gardens');
    expect(Object.keys(project.library)).toEqual(Object.keys(seedLibrary()));
    expect(toProjectFile({ graph, files: {}, library: {} }).format).toBe('node-cms-project');
  });

  it('refuses files that are not projects', () => {
    expect(() => parseProject('{oops')).toThrow('not a project file (it is not valid JSON)');
    expect(() => parseProject('{"title":"x"}')).toThrow('not a Node CMS project file');
    expect(() => parseProject('{"format":"node-cms-project","version":9}')).toThrow('newer version of the app (format 9)');
  });

  it('drops broken parts with a warning', () => {
    const text = JSON.stringify({
      format: 'node-cms-project',
      version: 1,
      graph: {
        nodes: [
          { id: 'a', type: 'documentSource', config: {} },
          { id: 'b', type: 'teleporter', config: {} },
          { id: 'a', type: 'selector', config: {} },
          { id: 'c', type: 'snippet', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'a', sourcePort: 'document', target: 'c', targetPort: 'selection' },
          { id: 'e2', source: 'a', sourcePort: 'document', target: 'gone', targetPort: 'document' },
        ],
      },
      files: [{ id: 'f', name: 'x.docx', encoding: 'base64', data: '***' }],
      library: { ok: [{ kind: 'snippet', id: 'ok', name: 'Ok', version: 1, mode: 'wrap', template: '{{content}}', params: [] }], bad: [{}] },
    });
    const { project, warnings } = parseProject(text);
    expect(project.graph.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(project.graph.edges).toEqual([]);
    expect(Object.keys(project.library)).toEqual(['ok']);
    expect(warnings).toEqual([
      'A file (x.docx) could not be read and was left out',
      'A node of unknown type "teleporter" was left out',
      'A second node "a" was left out',
      'A connection was left out: Cannot connect a document output to a selection input',
      'A connection was left out: Both ends of a connection must be nodes in the graph',
      'The snippet "bad" could not be read and was left out',
    ]);
  });

  it('uses the starter snippets when a project has no library', () => {
    const { project } = parseProject('{"format":"node-cms-project","version":1}');
    expect(Object.keys(project.library)).toHaveLength(5);
  });

  it('encodes base64', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('autosave', () => {
  it('saves to storage after changes and opens it again on start', async () => {
    const storage = memory();
    const a = createEditorStore({ storage, autosaveDelay: 5, evaluateDelay: 1 });
    a.getState().loadExample('html');
    await wait(30);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(a.getState().savedAt).toBeInstanceOf(Date);

    const b = createEditorStore({ storage, autosaveDelay: 5, evaluateDelay: 1 });
    expect(b.getState().graph).toEqual(a.getState().graph);
    expect(b.temporal.getState().pastStates).toEqual([]);
    await wait(10);
    await b.getState().whenIdle();
    expect(b.getState().results['output-4']?.status).toBe('ok');
  });

  it('says so when the saved project cannot be opened, and when storage is full', async () => {
    const storage = memory();
    storage.data.set(STORAGE_KEY, 'garbage');
    const store = createEditorStore({ storage, autosaveDelay: 5 });
    expect(store.getState().notice?.text).toMatch(/^The saved project could not be opened: /);

    const full: ProjectStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    const s2 = createEditorStore({ storage: full, autosaveDelay: 5 });
    s2.getState().addNode('selector');
    await wait(30);
    expect(s2.getState().notice?.text).toMatch(/too large to keep in this browser/);
  });
});

describe('import and export', () => {
  it('opens an exported project in another editor', async () => {
    const a = createEditorStore({ storage: null, evaluateDelay: 1 });
    a.getState().loadExample('json');
    const text = a.getState().exportProject();
    const b = createEditorStore({ storage: null, evaluateDelay: 1 });
    expect(b.getState().importProject(text)).toBeUndefined();
    expect(b.getState().graph).toEqual(a.getState().graph);
    expect(b.getState().notice).toMatchObject({ kind: 'info', text: 'Project opened.' });
    await b.getState().whenIdle();
    expect(b.getState().results['output-4'].status).toBe('ok');
    expect(b.getState().importProject('nope')).toBe('This is not a project file (it is not valid JSON)');
  });
});

describe('undo and redo', () => {
  const make = (undoGrouping = 0) => createEditorStore({ storage: null, evaluateDelay: 1, undoGrouping });

  it('undoes and redoes graph, file and library changes', () => {
    const store = make();
    store.getState().addNode('documentSource');
    store.getState().addNode('selector');
    store.getState().saveSnippet({ ...store.getState().library.callout[0] });
    expect(store.getState().library.callout).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().library.callout).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().graph.nodes.map((n) => n.id)).toEqual(['documentSource-1']);
    store.getState().redo();
    expect(store.getState().graph.nodes).toHaveLength(2);
  });

  it('does not record selection or results', () => {
    const store = make();
    store.getState().addNode('selector');
    store.getState().select(undefined);
    store.getState().notify('info', 'x');
    expect(store.temporal.getState().pastStates).toHaveLength(1);
  });

  it('groups typing into one node into one step, but keeps other changes separate', () => {
    const store = make(1000);
    store.getState().addNode('selector');
    for (const selector of ['h', 'h2', 'h2,', 'h2, p']) store.getState().updateConfig('selector-1', { mode: 'css', selector });
    store.getState().addNode('output');
    expect(store.temporal.getState().pastStates).toHaveLength(3);
    store.getState().undo();
    expect(store.getState().graph.nodes).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().graph.nodes[0].config).toEqual({ mode: 'css', selector: 'h2' });
    store.getState().undo();
    expect(store.getState().graph.nodes).toEqual([]);
  });

  it('does not group edits of different nodes', () => {
    const store = make(1000);
    store.getState().loadExample('html');
    store.temporal.getState().clear();
    store.getState().updateConfig('selector-2', { mode: 'css', selector: 'h1' });
    store.getState().updateConfig('output-4', { fullDocument: false });
    expect(store.temporal.getState().pastStates).toHaveLength(2);
  });

  it('undoes a whole "create selector from selection" as one step', () => {
    const store = make(1000);
    store.getState().loadExample('html');
    store.temporal.getState().clear();
    store.getState().createManualSelector({ nodeId: 'documentSource-1', port: 'document' }, { id: 'a1', target: 'text', textQuote: { exact: 'x', prefix: '', suffix: '' } });
    expect(store.getState().graph.nodes).toHaveLength(5);
    store.getState().undo();
    expect(store.getState().graph.nodes).toHaveLength(4);
    expect(store.getState().graph.edges).toHaveLength(3);
  });
});

describe('deleting', () => {
  it('removes a node and its connections as one undo step', () => {
    const store = createEditorStore({ storage: null, undoGrouping: 0 });
    store.getState().loadExample('html');
    store.temporal.getState().clear();
    store.getState().removeElements(['selector-2'], ['e1', 'e2']);
    expect(store.getState().graph.edges.map((e) => e.id)).toEqual(['e3']);
    store.getState().undo();
    expect(store.getState().graph.nodes).toHaveLength(4);
    expect(store.getState().graph.edges).toHaveLength(3);
  });
});

describe('project files and Object nodes', () => {
  it('keeps the image or video an Object node uses', () => {
    const img = storeFile('logo.png', new Uint8Array([137, 80, 78, 71]));
    const graph: Graph = {
      nodes: [{ id: 'object-1', type: 'object', config: { content: { kind: 'image', fileId: img.id, alt: '' } } }],
      edges: [],
    };
    const { project } = parseProject(projectToJson({ graph, files: { [img.id]: img }, library: {} }));
    expect(project.files[img.id]?.hash).toBe(img.hash);
  });

  it('turns Insert nodes from older projects into a Selector (where) and an Object (what)', () => {
    const anchor = { id: 'a1', target: 'text', textQuote: { exact: 'x', prefix: '', suffix: '' } };
    const old = {
      nodes: [
        { id: 'src', type: 'documentSource', config: {} },
        { id: 'insert-2', type: 'insert', name: 'Logo', position: { x: 400, y: 100 }, config: { content: { kind: 'imageUrl', url: 'https://x.test/a.png', alt: 'A' }, where: { mode: 'selector', selector: { mode: 'css', selector: 'h2' }, place: 'before' } } },
        { id: 'insert-3', type: 'insert', config: { content: { kind: 'code', code: 'x', render: 'block' }, where: { mode: 'point', point: { anchor, place: 'after' } } } },
        { id: 'out', type: 'output', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'document', target: 'insert-2', targetPort: 'document' },
        { id: 'e2', source: 'insert-2', sourcePort: 'document', target: 'insert-3', targetPort: 'document' },
        { id: 'e3', source: 'insert-3', sourcePort: 'document', target: 'out', targetPort: 'document' },
      ],
    };
    const { project, warnings } = parseProject(JSON.stringify({ format: 'node-cms-project', version: 1, graph: old, files: [], library: {} }));
    expect(warnings).toEqual(['2 Insert nodes are now Object nodes: where they go is set by a new Selector (its Point output)']);
    const byId = Object.fromEntries(project.graph.nodes.map((n) => [n.id, n]));
    expect(byId['insert-2']).toMatchObject({ type: 'object', name: 'Logo', config: { content: { kind: 'imageUrl' } } });
    expect(byId['insert-2'].config).not.toHaveProperty('where');
    expect(byId['insert-2-point']).toMatchObject({ type: 'selector', name: 'Logo (point)', position: { x: 140, y: 240 }, config: { mode: 'css', selector: 'h2', place: 'before' } });
    expect(byId['insert-3-point']).toMatchObject({ type: 'selector', config: { mode: 'point', point: { anchor, place: 'after' } } });
    const edges = project.graph.edges.map((e) => `${e.source}.${e.sourcePort}>${e.target}.${e.targetPort}`).sort();
    expect(edges).toEqual([
      'insert-2-point.point>insert-2.point',
      'insert-2.document>insert-3-point.document',
      'insert-3-point.point>insert-3.point',
      'insert-3.document>out.document',
      'src.document>insert-2-point.document',
    ]);
  });
});

describe('naming nodes', () => {
  it('renames a node without re-running anything, as one undo step', async () => {
    const store = createEditorStore({ storage: null, evaluateDelay: 1, undoGrouping: 1000 });
    store.getState().loadExample('html');
    await store.getState().whenIdle();
    const results = store.getState().results;
    store.temporal.getState().clear();
    for (const name of ['P', 'Pr', 'Pricing callouts']) store.getState().renameNode('snippet-3', name);
    expect(store.getState().graph.nodes.find((n) => n.id === 'snippet-3')?.name).toBe('Pricing callouts');
    await store.getState().whenIdle();
    expect(store.getState().results).toBe(results);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().graph.nodes.find((n) => n.id === 'snippet-3')?.name).toBeUndefined();
  });

  it('an empty name goes back to the id; names are saved in project files', () => {
    const store = createEditorStore({ storage: null });
    store.getState().addNode('selector');
    store.getState().renameNode('selector-1', 'Headings');
    const { project } = parseProject(store.getState().exportProject());
    expect(project.graph.nodes[0].name).toBe('Headings');
    store.getState().renameNode('selector-1', '   ');
    expect(store.getState().graph.nodes[0].name).toBeUndefined();
  });

  it('drops names that are not text from project files', () => {
    const text = JSON.stringify({ format: 'node-cms-project', version: 1, graph: { nodes: [{ id: 'a', type: 'selector', name: 42, config: {} }], edges: [] } });
    expect(parseProject(text).project.graph.nodes[0].name).toBeUndefined();
  });
});

describe('duplicating nodes', () => {
  it('copies the settings, the name and the incoming connections, as one undo step', async () => {
    const store = createEditorStore({ storage: null, evaluateDelay: 1, undoGrouping: 1000 });
    store.getState().loadExample('html');
    store.getState().renameNode('snippet-3', 'Callouts');
    store.temporal.getState().clear();
    const copy = store.getState().duplicateNode('snippet-3')!;
    const { graph, selectedId } = store.getState();
    const a = graph.nodes.find((n) => n.id === 'snippet-3')!;
    const b = graph.nodes.find((n) => n.id === copy)!;
    expect(copy).toBe('snippet-5');
    expect(selectedId).toBe(copy);
    expect(b).toMatchObject({ type: 'snippet', name: 'Callouts copy', config: a.config });
    expect(b.config).not.toBe(a.config);
    expect(b.position).not.toEqual(a.position);
    expect(graph.edges.filter((e) => e.target === copy).map((e) => e.source)).toEqual(['selector-2']);
    expect(graph.edges.filter((e) => e.source === copy)).toEqual([]);
    await store.getState().whenIdle();
    expect(store.getState().results[copy].info).toMatchObject({ applied: 2 });

    store.getState().undo();
    expect(store.getState().graph.nodes.map((n) => n.id)).toEqual(['documentSource-1', 'selector-2', 'snippet-3', 'output-4']);
    expect(store.getState().graph.edges).toHaveLength(3);
  });

  it('places further copies so they do not cover each other', () => {
    const store = createEditorStore({ storage: null });
    store.getState().addNode('selector', { x: 0, y: 0 });
    const one = store.getState().duplicateNode('selector-1')!;
    const two = store.getState().duplicateNode('selector-1')!;
    const pos = (id: string) => store.getState().graph.nodes.find((n) => n.id === id)!.position!;
    expect(pos(one)).not.toEqual(pos(two));
    expect(store.getState().duplicateNode('nope')).toBeUndefined();
  });
});
