// Editor state: the graph, the project's files, the selection and the latest results.
// The graph is evaluated automatically (debounced) whenever the graph or the files change.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  connect as connectEdge, GraphEvaluator, nodeRegistry, storeFile, type Anchor, type EdgeCandidate, type Graph,
  type GraphNode, type NodeRegistry, type NodeResult, type SelectorConfig, type StoredFile,
} from '../engine';
import { sampleHtml, sampleJson } from '../samples';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

export interface EditorState {
  graph: Graph;
  files: Record<string, StoredFile>;
  selectedId?: string;
  results: Record<string, NodeResult>;
  evaluating: boolean;
  /** Set when evaluating the whole graph failed (individual node problems are in `results`). */
  graphError?: string;
  notice?: Notice;
  /** Increases when the canvas should fit all nodes into view (after loading an example). */
  fitRequest: number;

  addNode(type: string, position?: { x: number; y: number }): string;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  /** Replace a node's config, or derive the new config from the old one. */
  updateConfig<C>(id: string, update: C | ((config: C) => C)): void;
  /** Add a connection. Returns the reason when it is not allowed (and shows it). */
  connect(edge: EdgeCandidate): string | undefined;
  select(id?: string): void;
  addFile(name: string, data: StoredFile['data']): StoredFile;
  /** Add a file and use it in a Document Source node. */
  chooseFile(nodeId: string, name: string, data: StoredFile['data']): void;
  loadExample(kind: 'html' | 'json'): void;
  /** Add a saved selection to a manual Selector node. */
  addAnchor(selectorId: string, anchor: Anchor): void;
  /** Create a manual Selector fed by `from` (a node's document output), holding one saved selection. */
  createManualSelector(from: { nodeId: string; port: string }, anchor: Anchor): string | undefined;
  clear(): void;
  notify(kind: Notice['kind'], text: string): void;
  dismissNotice(): void;
  /** Evaluate now. Resolves when the results are in the store. */
  evaluate(): Promise<void>;
  /** Resolves once no evaluation is scheduled or running (for tests). */
  whenIdle(): Promise<void>;
}

export interface EditorOptions {
  registry?: NodeRegistry;
  /** Milliseconds to wait after a change before evaluating. Default 150. */
  evaluateDelay?: number;
}

const NODE_SPACING = 280;

export function createEditorStore(options: EditorOptions = {}) {
  const registry = options.registry ?? nodeRegistry;
  const delay = options.evaluateDelay ?? 150;
  const evaluator = new GraphEvaluator(registry);
  let runId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let noticeId = 0;

  const nextId = (graph: Graph, type: string) => {
    const used = new Set(graph.nodes.map((n) => n.id));
    let i = graph.nodes.length + 1;
    while (used.has(`${type}-${i}`)) i++;
    return `${type}-${i}`;
  };

  const store = createStore<EditorState>()((set, get) => ({
    graph: { nodes: [], edges: [] },
    files: {},
    results: {},
    evaluating: false,
    fitRequest: 0,

    addNode(type, position) {
      const def = registry[type];
      if (!def) throw new Error(`Unknown node type "${type}"`);
      const { graph } = get();
      const id = nextId(graph, type);
      const rightmost = graph.nodes.reduce((max, n) => Math.max(max, n.position?.x ?? 0), -NODE_SPACING + 40);
      const node: GraphNode = { id, type, config: def.defaultConfig(), position: position ?? { x: rightmost + NODE_SPACING, y: 120 } };
      set({ graph: { ...graph, nodes: [...graph.nodes, node] }, selectedId: id });
      return id;
    },

    removeNodes(ids) {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const { graph, selectedId } = get();
      set({
        graph: {
          nodes: graph.nodes.filter((n) => !gone.has(n.id)),
          edges: graph.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        },
        selectedId: selectedId && gone.has(selectedId) ? undefined : selectedId,
      });
    },

    removeEdges(ids) {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const { graph } = get();
      set({ graph: { ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) } });
    },

    moveNode(id, position) {
      const { graph } = get();
      // Moving changes nothing the engine looks at, but positions are part of the saved graph.
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) } });
    },

    updateConfig(id, update) {
      const { graph } = get();
      set({
        graph: {
          ...graph,
          nodes: graph.nodes.map((n) =>
            n.id === id ? { ...n, config: typeof update === 'function' ? (update as (c: unknown) => unknown)(n.config) : update } : n,
          ),
        },
      });
    },

    connect(edge) {
      const result = connectEdge(get().graph, edge, registry);
      if ('error' in result) {
        get().notify('error', result.error);
        return result.error;
      }
      set({ graph: result.graph });
      return undefined;
    },

    select(id) {
      if (get().selectedId !== id) set({ selectedId: id });
    },

    addFile(name, data) {
      const file = storeFile(name, data);
      set({ files: { ...get().files, [file.id]: file } });
      return file;
    },

    chooseFile(nodeId, name, data) {
      const file = get().addFile(name, data);
      // A new file means a new JSON structure, so an old JSON mapping no longer applies.
      get().updateConfig<Record<string, unknown>>(nodeId, (c) => ({ ...c, fileId: file.id, json: undefined }));
    },

    loadExample(kind) {
      const file =
        kind === 'json' ? storeFile('example.json', sampleJson()) : storeFile('example.html', sampleHtml());
      const at = (i: number) => ({ x: 40 + i * NODE_SPACING, y: 120 });
      const nodes: GraphNode[] = [
        {
          id: 'documentSource-1',
          type: 'documentSource',
          position: at(0),
          config:
            kind === 'json'
              ? {
                  fileId: file.id,
                  json: {
                    mode: 'fields',
                    fields: [
                      { path: '$.title', format: 'text', blockTag: 'h1' },
                      { path: '$.articles[*].body', format: 'html' },
                      { path: '$.faq[*].a', format: 'markdown' },
                    ],
                  },
                }
              : { fileId: file.id },
        },
        {
          id: 'selector-2',
          type: 'selector',
          position: at(1),
          config: kind === 'json' ? { mode: 'jsonField', path: '$.faq[*].a' } : { mode: 'css', selector: 'h2' },
        },
        { id: 'snippet-3', type: 'snippet', position: at(2), config: registry.snippet.defaultConfig() },
        { id: 'output-4', type: 'output', position: at(3), config: registry.output.defaultConfig() },
      ];
      const edges = [
        { id: 'e1', source: 'documentSource-1', sourcePort: 'document', target: 'selector-2', targetPort: 'document' },
        { id: 'e2', source: 'selector-2', sourcePort: 'selection', target: 'snippet-3', targetPort: 'selection' },
        { id: 'e3', source: 'snippet-3', sourcePort: 'document', target: 'output-4', targetPort: 'document' },
      ];
      set({
        graph: { nodes, edges },
        files: { ...get().files, [file.id]: file },
        selectedId: 'output-4',
        fitRequest: get().fitRequest + 1,
      });
    },

    addAnchor(selectorId, anchor) {
      get().updateConfig<SelectorConfig>(selectorId, (c) =>
        c.mode === 'manual' ? { ...c, anchors: [...c.anchors, anchor] } : { mode: 'manual', anchors: [anchor] },
      );
    },

    createManualSelector(from, anchor) {
      const source = get().graph.nodes.find((n) => n.id === from.nodeId);
      const base = source?.position ?? { x: 40, y: 120 };
      // Below the source, moving further down while that spot is taken.
      let position = { x: base.x + NODE_SPACING, y: base.y + 170 };
      while (get().graph.nodes.some((n) => n.position && Math.abs(n.position.x - position.x) < 120 && Math.abs(n.position.y - position.y) < 90)) {
        position = { x: position.x, y: position.y + 140 };
      }
      const id = get().addNode('selector', position);
      get().updateConfig<SelectorConfig>(id, { mode: 'manual', anchors: [anchor] });
      const error = get().connect({ source: from.nodeId, sourcePort: from.port, target: id, targetPort: 'document' });
      if (error) {
        get().removeNodes([id]);
        return undefined;
      }
      get().select(id);
      return id;
    },

    clear() {
      set({ graph: { nodes: [], edges: [] }, selectedId: undefined, results: {} });
    },

    notify(kind, text) {
      set({ notice: { id: ++noticeId, kind, text } });
    },

    dismissNotice() {
      set({ notice: undefined });
    },

    evaluate() {
      clearTimeout(timer);
      timer = undefined;
      const id = ++runId;
      const { graph, files } = get();
      set({ evaluating: true });
      running = evaluator
        .evaluate(graph, { files })
        .then(({ results }) => {
          // A newer evaluation started while this one ran: its results win.
          if (id === runId) set({ results, evaluating: false, graphError: undefined });
        })
        .catch((err: Error) => {
          if (id === runId) set({ evaluating: false, graphError: err.message });
        });
      return running;
    },

    async whenIdle() {
      while (timer !== undefined || get().evaluating) {
        if (timer !== undefined) await get().evaluate();
        else await running;
      }
    },
  }));

  store.subscribe((state, prev) => {
    if (state.graph === prev.graph && state.files === prev.files) return;
    // Only positions changed: nothing to re-run.
    if (state.files === prev.files && sameExceptPositions(state.graph, prev.graph)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void store.getState().evaluate();
    }, delay);
  });

  return store;
}

function sameExceptPositions(a: Graph, b: Graph) {
  return (
    a.edges === b.edges &&
    a.nodes.length === b.nodes.length &&
    a.nodes.every((n, i) => n.id === b.nodes[i].id && n.type === b.nodes[i].type && n.config === b.nodes[i].config)
  );
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export const editorStore = createEditorStore();

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
