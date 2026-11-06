// Editor state: the graph, the project's files, the selection and the latest results.
// The graph is evaluated automatically (debounced) whenever the graph or the files change.
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  connect as connectEdge, GraphEvaluator, nodeRegistry, storeFile, type Anchor, type EdgeCandidate, type Graph,
  type GraphNode, type ObjectNodeConfig, type NodeRegistry, type NodeResult, type SelectorConfig, type StoredFile, addVersion, carryParams,
  cleanClassName, customSnippet, latestVersion, moveEdge, removeSnippet, snippetIdFor, type Snippet, type SnippetLibrary, type SnippetNodeConfig,
} from '../engine';
import { sampleHtml, sampleJson, sampleNotesHtml } from '../samples';
import { seedLibrary } from '../snippets/seed';
import { parseProject, projectToJson } from './project';
import { groupOfNode, groupsOf, nextGroupColor, nextGroupId, nextGroupName, pruneGroups, withoutNodes } from './groups';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

/** Every selected node that still exists: the multi-selection, or just the main one. */
export function selectedNodeIds(s: Pick<EditorState, 'graph' | 'selectedId' | 'selectedIds'>): string[] {
  if (!s.selectedId) return [];
  const ids = s.selectedIds?.includes(s.selectedId) ? s.selectedIds : [s.selectedId];
  return ids.filter((id) => s.graph.nodes.some((n) => n.id === id));
}

export interface EditorState {
  graph: Graph;
  files: Record<string, StoredFile>;
  /** The node the inspector and the preview follow (the last one clicked). */
  selectedId?: string;
  /**
   * Every selected node when several are (Shift / Ctrl / Cmd + click, or a selection box). Only counts while it
   * holds `selectedId`: setting `selectedId` to another node alone makes it the only one. Read with `selectedNodeIds`.
   */
  selectedIds?: string[];
  results: Record<string, NodeResult>;
  evaluating: boolean;
  /** Set when evaluating the whole graph failed (individual node problems are in `results`). */
  graphError?: string;
  notice?: Notice;
  /** Increases when the canvas should fit all nodes into view (after loading an example). */
  fitRequest: number;
  /** Reusable snippets, each with its versions. */
  library: SnippetLibrary;
  /** The library snippet open in the inspector (instead of the selected node). */
  openSnippetId?: string;

  addNode(type: string, position?: { x: number; y: number }): string;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;
  /**
   * Copy a node: same settings, its name with " copy", the same incoming connections, placed just below.
   * Its outputs start unconnected. Returns the copy's id.
   */
  duplicateNode(id: string): string | undefined;
  /** Move a connection earlier (-1) or later (+1) among those into the same input (an Output's documents). */
  moveInput(edgeId: string, delta: -1 | 1): void;
  /** Remove nodes and connections together, as one undo step. */
  removeElements(nodeIds: string[], edgeIds: string[]): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  /** Move several nodes as one undo step (dragging a multi-selection). */
  moveNodes(positions: Record<string, { x: number; y: number }>): void;
  /** Replace a node's config, or derive the new config from the old one. */
  updateConfig<C>(id: string, update: C | ((config: C) => C)): void;
  /** Give a node a name (empty: back to its id). */
  renameNode(id: string, name: string): void;
  /** Add a connection. Returns the reason when it is not allowed (and shows it). */
  connect(edge: EdgeCandidate): string | undefined;
  /** Select only this node (or nothing). */
  select(id?: string): void;

  /** The group whose settings the inspector shows (its nodes are selected too). */
  selectedGroupId?: string;
  /** Asks the canvas to fit these nodes into view (`n` increases each time). */
  fitTo?: { nodeIds: string[]; groupId?: string; n: number };
  /** Group nodes (taken out of other groups). Returns the group's id. */
  groupNodes(ids: string[], name?: string): string | undefined;
  ungroup(groupId: string): void;
  renameGroup(groupId: string, name: string): void;
  setGroupColor(groupId: string, color: string): void;
  setGroupCollapsed(groupId: string, collapsed: boolean): void;
  addToGroup(groupId: string, ids: string[]): void;
  removeFromGroup(ids: string[]): void;
  /** Select a group: all its nodes, and the group in the inspector. */
  selectGroup(groupId: string): void;
  /** Select a group and fit the canvas to it. */
  focusGroup(groupId: string): void;
  /** Copy a group: its nodes, the connections between them and those coming in; placed below. */
  duplicateGroup(groupId: string): string | undefined;
  /** Delete a group and all its nodes. */
  deleteGroupAndNodes(groupId: string): void;
  /** Add nodes to the selection and take some out; the last one added becomes the main one. */
  changeSelection(added: string[], removed: string[]): void;

  openSnippet(id?: string): void;
  /** Save a snippet as the next version of its id. Returns the saved version. */
  saveSnippet(snippet: Snippet): Snippet;
  /** A new, simple snippet in the library, opened for editing. */
  createSnippet(): string;
  duplicateSnippet(id: string): string | undefined;
  deleteSnippet(id: string): void;
  /** Make a Snippet node use a library snippet (the latest version unless one is given). */
  useLibrarySnippet(nodeId: string, id: string, version?: number): void;
  /** Move a Snippet node to the latest version of its library snippet, keeping parameter values that still fit. */
  updateNodeSnippet(nodeId: string): void;
  /** Turn a Snippet node's library snippet into its own copy that can be edited in the node. */
  detachSnippet(nodeId: string): void;
  /** Make a Snippet node a simple custom one: a class name, an optional wrapper, and its own CSS and JavaScript. */
  makeCustomSnippet(nodeId: string): void;
  /** Save a Snippet node's own snippet into the library (as a new snippet, or a new version of its linked one). */
  saveNodeSnippetToLibrary(nodeId: string): Snippet | undefined;
  /** Add a Snippet node that uses a library snippet. */
  addSnippetNode(id: string, position?: { x: number; y: number }): string;
  addFile(name: string, data: StoredFile['data']): StoredFile;
  /** Add a file and use it in a Document Source node. */
  chooseFile(nodeId: string, name: string, data: StoredFile['data']): void;
  /** Load an example graph; "two": a section of a second document copied into the first. */
  loadExample(kind: 'html' | 'json' | 'two'): void;
  /** Add an image or video file and use it in an Object node. */
  chooseMediaFile(nodeId: string, name: string, data: Uint8Array): void;
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

  /** When the project was last saved in this browser. */
  savedAt?: Date;
  /** The project as a project file (JSON). */
  exportProject(): string;
  /** Replace the project with one from a project file. Returns the reason when it cannot be opened. */
  importProject(text: string): string | undefined;
  undo(): void;
  redo(): void;
}

/** The part of localStorage the store uses. */
export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface EditorOptions {
  registry?: NodeRegistry;
  /** Milliseconds to wait after a change before evaluating. Default 150. */
  evaluateDelay?: number;
  /** Where to autosave the project. Default: localStorage when there is one; null for none. */
  storage?: ProjectStorage | null;
  /** Milliseconds to wait after a change before autosaving. Default 600. */
  autosaveDelay?: number;
  /** Edits to the same node's settings closer together than this become one undo step (typing). Default 1000. */
  undoGrouping?: number;
}

export const STORAGE_KEY = 'node-cms:project';

function defaultStorage(): ProjectStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked by the browser
  }
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

  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const grouping = options.undoGrouping ?? 1000;
  /** Set while one store action changes several things, so they become one undo step. */
  let batchDepth = 0;
  /** Set by updateConfig, so typing into one node's settings becomes one undo step. */
  let groupKey: string | undefined;
  const batch = <T,>(fn: () => T): T => {
    const t = store.temporal.getState();
    if (batchDepth === 0) {
      const { graph, files, library } = store.getState();
      store.temporal.setState({ pastStates: [...t.pastStates, { graph, files, library }].slice(-100), futureStates: [] });
      t.pause();
    }
    batchDepth++;
    try {
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        groupKey = undefined;
        store.temporal.getState().resume();
      }
    }
  };

  const store = createStore<EditorState>()(temporal((set, get) => ({
    graph: { nodes: [], edges: [] },
    files: {},
    results: {},
    evaluating: false,
    fitRequest: 0,
    library: seedLibrary(),

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
      const nodes = graph.nodes.filter((n) => !gone.has(n.id));
      set({
        graph: {
          nodes,
          edges: graph.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
          ...(graph.groups && { groups: pruneGroups(graph.groups, new Set(nodes.map((n) => n.id))) }),
        },
        selectedId: selectedId && gone.has(selectedId) ? undefined : selectedId,
      });
    },

    removeElements(nodeIds, edgeIds) {
      if (nodeIds.length === 0 && edgeIds.length === 0) return;
      const nodes = new Set(nodeIds);
      const edges = new Set(edgeIds);
      const { graph, selectedId } = get();
      const kept = graph.nodes.filter((n) => !nodes.has(n.id));
      set({
        graph: {
          nodes: kept,
          edges: graph.edges.filter((e) => !edges.has(e.id) && !nodes.has(e.source) && !nodes.has(e.target)),
          ...(graph.groups && { groups: pruneGroups(graph.groups, new Set(kept.map((n) => n.id))) }),
        },
        selectedId: selectedId && nodes.has(selectedId) ? undefined : selectedId,
      });
    },

    duplicateNode(id) {
      const original = get().graph.nodes.find((n) => n.id === id);
      if (!original) return undefined;
      return batch(() => {
        const base = original.position ?? { x: 40, y: 120 };
        let position = { x: base.x + 30, y: base.y + 110 };
        const taken = (p: { x: number; y: number }) =>
          get().graph.nodes.some((n) => n.position && Math.abs(n.position.x - p.x) < 60 && Math.abs(n.position.y - p.y) < 60);
        while (taken(position)) position = { x: position.x + 30, y: position.y + 60 };
        const copyId = get().addNode(original.type, position);
        get().updateConfig(copyId, structuredClone(original.config));
        if (original.name?.trim()) get().renameNode(copyId, `${original.name.trim()} copy`);
        const group = groupOfNode(get().graph, id);
        if (group) get().addToGroup(group.id, [copyId]);
        for (const e of get().graph.edges.filter((x) => x.target === id)) {
          get().connect({ source: e.source, sourcePort: e.sourcePort, target: copyId, targetPort: e.targetPort });
        }
        get().select(copyId);
        return copyId;
      });
    },

    moveInput(edgeId, delta) {
      const graph = moveEdge(get().graph, edgeId, delta);
      if (graph !== get().graph) set({ graph });
    },

    removeEdges(ids) {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const { graph } = get();
      set({ graph: { ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) } });
    },

    moveNodes(positions) {
      const { graph } = get();
      if (!Object.keys(positions).length) return;
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)) } });
    },

    moveNode(id, position) {
      const { graph } = get();
      // Moving changes nothing the engine looks at, but positions are part of the saved graph.
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) } });
    },

    renameNode(id, name) {
      const { graph } = get();
      const node = graph.nodes.find((n) => n.id === id);
      const next = name.trim() ? name : undefined;
      if (!node || node.name === next) return;
      groupKey = `name:${id}`; // typing a name is one undo step
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, name: next } : n)) } });
    },

    updateConfig(id, update) {
      const { graph } = get();
      groupKey = `config:${id}`;
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
      // Connecting a selection to an Object node means "insert this": switch it to selected content (same undo step).
      const target = result.graph.nodes.find((n) => n.id === edge.target);
      let graph = result.graph;
      if (target?.type === 'object' && edge.targetPort === 'content' && (target.config as ObjectNodeConfig).content.kind !== 'selection') {
        graph = { ...graph, nodes: graph.nodes.map((n) => (n === target ? { ...n, config: { ...(n.config as ObjectNodeConfig), content: { kind: 'selection' } } } : n)) };
      }
      set({ graph });
      return undefined;
    },

    select(id) {
      const { selectedId, selectedIds, openSnippetId } = get();
      if (selectedId !== id || openSnippetId || (selectedIds?.length ?? 0) > 1 || get().selectedGroupId) {
        set({ selectedId: id, selectedIds: undefined, openSnippetId: undefined, selectedGroupId: undefined });
      }
    },

    changeSelection(added, removed) {
      const state = get();
      const gone = new Set(removed);
      const ids = [...selectedNodeIds(state).filter((id) => !gone.has(id) && !added.includes(id)), ...added.filter((id) => !gone.has(id))];
      const main = added.filter((id) => !gone.has(id)).at(-1) ?? (state.selectedId && ids.includes(state.selectedId) ? state.selectedId : ids.at(-1));
      set({ selectedId: main, selectedIds: ids.length > 1 ? ids : undefined, selectedGroupId: undefined, ...(main !== state.selectedId && { openSnippetId: undefined }) });
    },

    groupNodes(ids, name) {
      const { graph } = get();
      const real = ids.filter((id) => graph.nodes.some((n) => n.id === id));
      if (!real.length) return undefined;
      const others = withoutNodes(groupsOf(graph), real);
      const group = { id: nextGroupId(groupsOf(graph)), name: name?.trim() || nextGroupName(others), nodeIds: real, color: nextGroupColor(others) };
      set({ graph: { ...graph, groups: [...others, group] } });
      get().selectGroup(group.id);
      return group.id;
    },

    ungroup(groupId) {
      const { graph, selectedGroupId } = get();
      if (!groupsOf(graph).some((g) => g.id === groupId)) return;
      set({ graph: { ...graph, groups: groupsOf(graph).filter((g) => g.id !== groupId) }, ...(selectedGroupId === groupId && { selectedGroupId: undefined }) });
    },

    renameGroup(groupId, name) {
      const { graph } = get();
      const group = groupsOf(graph).find((g) => g.id === groupId);
      if (!group || group.name === name) return;
      groupKey = `group-name:${groupId}`; // typing a name is one undo step
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, name } : g)) } });
    },

    setGroupColor(groupId, color) {
      const { graph } = get();
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, color } : g)) } });
    },

    setGroupCollapsed(groupId, collapsed) {
      const { graph } = get();
      const group = groupsOf(graph).find((g) => g.id === groupId);
      if (!group || !!group.collapsed === collapsed) return;
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, collapsed: collapsed || undefined } : g)) } });
    },

    addToGroup(groupId, ids) {
      const { graph } = get();
      const target = groupsOf(graph).find((g) => g.id === groupId);
      if (!target) return;
      const add = ids.filter((id) => !target.nodeIds.includes(id) && graph.nodes.some((n) => n.id === id));
      if (!add.length) return;
      const groups = withoutNodes(groupsOf(graph), add).map((g) => (g.id === groupId ? { ...g, nodeIds: [...g.nodeIds, ...add] } : g));
      // The target group may only have held nodes that were added again: keep it in any case.
      set({ graph: { ...graph, groups: groups.some((g) => g.id === groupId) ? groups : [...groups, { ...target, nodeIds: [...target.nodeIds, ...add] }] } });
    },

    removeFromGroup(ids) {
      const { graph, selectedGroupId } = get();
      const groups = withoutNodes(groupsOf(graph), ids);
      set({ graph: { ...graph, groups }, ...(selectedGroupId && !groups.some((g) => g.id === selectedGroupId) && { selectedGroupId: undefined }) });
    },

    selectGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      set({
        selectedGroupId: groupId,
        selectedId: group.nodeIds.at(-1),
        selectedIds: group.nodeIds.length > 1 ? [...group.nodeIds] : undefined,
        openSnippetId: undefined,
      });
    },

    focusGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      get().selectGroup(groupId);
      set({ fitTo: { nodeIds: [...group.nodeIds], groupId, n: (get().fitTo?.n ?? 0) + 1 } });
    },

    duplicateGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return undefined;
      return batch(() => {
        const members = get().graph.nodes.filter((n) => group.nodeIds.includes(n.id));
        const ys = members.map((n) => n.position?.y ?? 0);
        // Below the group: its height, plus room for the frame's header and the nodes' own height.
        const dy = Math.max(...ys) - Math.min(...ys) + 220;
        const copies = new Map<string, string>();
        for (const n of members) {
          const p = n.position ?? { x: 40, y: 120 };
          const id = get().addNode(n.type, { x: p.x, y: p.y + dy });
          get().updateConfig(id, structuredClone(n.config));
          if (n.name?.trim()) get().renameNode(id, `${n.name.trim()} copy`);
          copies.set(n.id, id);
        }
        // Connections between members, and those coming in from outside, in their order.
        for (const e of get().graph.edges.filter((x) => copies.has(x.target))) {
          get().connect({ source: copies.get(e.source) ?? e.source, sourcePort: e.sourcePort, target: copies.get(e.target)!, targetPort: e.targetPort });
        }
        const copyId = get().groupNodes([...copies.values()], `${group.name} copy`);
        if (copyId && group.collapsed) get().setGroupCollapsed(copyId, true);
        return copyId;
      });
    },

    deleteGroupAndNodes(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      get().removeElements(group.nodeIds, []);
      set({ selectedGroupId: undefined, selectedId: undefined, selectedIds: undefined });
    },

    openSnippet(id) {
      set({ openSnippetId: id });
    },

    saveSnippet(snippet) {
      const { library, snippet: saved } = addVersion(get().library, snippet);
      set({ library });
      return saved;
    },

    createSnippet() {
      const id = snippetIdFor(get().library, 'New snippet');
      get().saveSnippet({
        kind: 'snippet',
        id,
        name: 'New snippet',
        description: '',
        version: 0,
        mode: 'wrap',
        template: '<div class="box">{{content}}</div>',
        params: [],
        css: '.box{border:1px solid #ccc;padding:1rem}',
      });
      set({ openSnippetId: id });
      return id;
    },

    duplicateSnippet(id) {
      const source = latestVersion(get().library, id);
      if (!source) return undefined;
      const name = `${source.name} copy`;
      const copyId = snippetIdFor(get().library, name);
      get().saveSnippet({ ...structuredClone(source), id: copyId, name, version: 0 });
      set({ openSnippetId: copyId });
      return copyId;
    },

    deleteSnippet(id) {
      // Nodes keep their own copy, so they keep working; they just show that the library entry is gone.
      set({ library: removeSnippet(get().library, id), openSnippetId: get().openSnippetId === id ? undefined : get().openSnippetId });
    },

    useLibrarySnippet(nodeId, id, version) {
      const versions = get().library[id];
      const snippet = version === undefined ? versions?.[versions.length - 1] : versions?.find((v) => v.version === version);
      if (!snippet) return;
      get().updateConfig<SnippetNodeConfig>(nodeId, (c) => ({
        ...c,
        snippet: structuredClone(snippet),
        ref: { id, version: snippet.version },
        params: c.ref?.id === id ? carryParams(c.params, snippet.params) : undefined,
        custom: undefined,
      }));
    },

    updateNodeSnippet(nodeId) {
      const node = get().graph.nodes.find((n) => n.id === nodeId);
      const ref = (node?.config as SnippetNodeConfig | undefined)?.ref;
      if (ref) get().useLibrarySnippet(nodeId, ref.id);
    },

    detachSnippet(nodeId) {
      get().updateConfig<SnippetNodeConfig>(nodeId, (c) => ({
        ...c,
        ref: undefined,
        custom: undefined,
        // Its own id, so its CSS is never mixed up with the library version's.
        snippet: { ...c.snippet, id: `${c.snippet.id}-${nodeId}`, name: c.snippet.name },
      }));
    },

    makeCustomSnippet(nodeId) {
      get().updateConfig<SnippetNodeConfig>(nodeId, (c) => ({
        ...c,
        ref: undefined,
        params: undefined,
        custom: c.custom ?? { className: cleanClassName(`custom-${nodeId}`), wrap: 'none' },
      }));
    },

    saveNodeSnippetToLibrary(nodeId) {
      const node = get().graph.nodes.find((n) => n.id === nodeId);
      if (!node) return undefined;
      return batch(() => {
      const config = node.config as SnippetNodeConfig;
      // A custom snippet goes to the library with its CSS and JavaScript (which then leave the node).
      const own = config.custom ? { ...customSnippet(config.custom), css: config.css?.trim() || undefined, js: config.js?.trim() || undefined } : config.snippet;
      const name = config.custom ? cleanClassName(config.custom.className) : own.name;
      const id = config.ref && get().library[config.ref.id] ? config.ref.id : snippetIdFor(get().library, name);
      const saved = get().saveSnippet({ ...own, id, name });
      get().updateConfig<SnippetNodeConfig>(nodeId, (c) => ({
        ...c,
        snippet: structuredClone(saved),
        ref: { id, version: saved.version },
        ...(c.custom && { custom: undefined, css: undefined, js: undefined }),
      }));
      return saved;
      });
    },

    addSnippetNode(id, position) {
      return batch(() => {
        const nodeId = get().addNode('snippet', position);
        get().useLibrarySnippet(nodeId, id);
        return nodeId;
      });
    },

    addFile(name, data) {
      const file = storeFile(name, data);
      set({ files: { ...get().files, [file.id]: file } });
      return file;
    },

    chooseFile(nodeId, name, data) {
      batch(() => {
        const file = get().addFile(name, data);
        // A new file means a new JSON structure, so an old JSON mapping no longer applies.
        get().updateConfig<Record<string, unknown>>(nodeId, (c) => ({ ...c, fileId: file.id, json: undefined }));
      });
    },

    chooseMediaFile(nodeId, name, data) {
      batch(() => {
        const file = get().addFile(name, data);
        get().updateConfig<{ content: Record<string, unknown> }>(nodeId, (c) => ({ ...c, content: { ...c.content, fileId: file.id } }));
      });
      if (data.byteLength > 2 * 1024 * 1024) {
        get().notify(
          'info',
          `${name} is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB. Large files make the project big and may not fit in this browser's storage; a linked image or video keeps it small.`,
        );
      }
    },

    loadExample(kind) {
      if (kind === 'two') {
        // The guide gets the "Watering" section of the notes, before its quote, in a labelled section whose
        // headings fit under the guide's "Pricing" heading.
        const guide = storeFile('example.html', sampleHtml());
        const notes = storeFile('notes.html', sampleNotesHtml());
        const at = (col: number, row: number) => ({ x: 40 + col * NODE_SPACING, y: 60 + row * 200 });
        const nodes: GraphNode[] = [
          { id: 'documentSource-1', type: 'documentSource', name: 'Guide', position: at(0, 0), config: { fileId: guide.id } },
          { id: 'documentSource-2', type: 'documentSource', name: 'Notes', position: at(0, 1), config: { fileId: notes.id } },
          { id: 'selector-3', type: 'selector', name: 'Before the quote', position: at(1, 0), config: { mode: 'css', selector: 'blockquote', place: 'before' } },
          { id: 'extractor-4', type: 'extractor', name: 'Watering section', position: at(1, 1), config: { mode: 'heading', text: 'Watering', includeHeading: true } },
          {
            id: 'object-5',
            type: 'object',
            position: at(2, 0),
            config: { content: { kind: 'selection', wrap: 'section', headings: 'fit' } } satisfies ObjectNodeConfig,
          },
          { id: 'output-6', type: 'output', position: at(3, 0), config: registry.output.defaultConfig() },
        ];
        const edges = [
          { id: 'e1', source: 'documentSource-1', sourcePort: 'document', target: 'selector-3', targetPort: 'document' },
          { id: 'e2', source: 'documentSource-2', sourcePort: 'document', target: 'extractor-4', targetPort: 'document' },
          { id: 'e3', source: 'selector-3', sourcePort: 'point', target: 'object-5', targetPort: 'point' },
          { id: 'e4', source: 'extractor-4', sourcePort: 'document', target: 'object-5', targetPort: 'content' },
          { id: 'e5', source: 'object-5', sourcePort: 'document', target: 'output-6', targetPort: 'document' },
        ];
        set({
          graph: { nodes, edges },
          files: { ...get().files, [guide.id]: guide, [notes.id]: notes },
          selectedId: 'output-6',
          fitRequest: get().fitRequest + 1,
        });
        return;
      }
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
      return batch(() => {
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
      });
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
    exportProject() {
      const { graph, files, library } = get();
      return projectToJson({ graph, files, library });
    },

    importProject(text) {
      try {
        const { project, warnings } = parseProject(text, registry);
        set({ ...project, selectedId: undefined, openSnippetId: undefined, results: {}, fitRequest: get().fitRequest + 1 });
        get().notify('info', warnings.length ? `Project opened. ${warnings.join('. ')}.` : 'Project opened.');
        return undefined;
      } catch (err) {
        const message = (err as Error).message;
        get().notify('error', message);
        return message;
      }
    },

    undo() {
      store.temporal.getState().undo();
    },

    redo() {
      store.temporal.getState().redo();
    },
  }), {
    // Only the project itself is undoable; selection, results and notices are not.
    partialize: (s) => ({ graph: s.graph, files: s.files, library: s.library }),
    equality: (a, b) => a.graph === b.graph && a.files === b.files && a.library === b.library,
    limit: 100,
    // Typing into one node's settings becomes one undo step; every other change is its own step.
    // (Actions that change several things at once use batch(), which records one step itself.)
    handleSet: (handleSet) => {
      let last = -Infinity;
      let lastKey: string | undefined;
      return (...args: Parameters<typeof handleSet>) => {
        const key = groupKey;
        groupKey = undefined;
        const now = Date.now();
        const sameGroup = key !== undefined && key === lastKey && now - last < grouping;
        if (!sameGroup) handleSet(...args);
        last = now;
        lastKey = key;
      };
    },
  }));

  // Open the project saved in this browser, if there is one.
  const saved = (() => {
    try {
      return storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (saved) {
    try {
      const { project, warnings } = parseProject(saved, registry);
      store.setState({ ...project, fitRequest: 1 });
      if (warnings.length) store.getState().notify('info', `Parts of the saved project could not be restored. ${warnings.join('. ')}.`);
    } catch (err) {
      store.getState().notify('error', `The saved project could not be opened: ${(err as Error).message}`);
    }
    store.temporal.getState().clear();
    if (store.getState().graph.nodes.length) setTimeout(() => void store.getState().evaluate(), 0);
  }

  // Autosave.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let warnedFull = false;
  store.subscribe((state, prev) => {
    if (!storage || (state.graph === prev.graph && state.files === prev.files && state.library === prev.library)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { graph, files, library } = store.getState();
      try {
        storage.setItem(STORAGE_KEY, projectToJson({ graph, files, library }));
        store.setState({ savedAt: new Date() });
      } catch {
        if (!warnedFull) store.getState().notify('error', 'The project is too large to keep in this browser. Use “Save project file” to keep it.');
        warnedFull = true;
      }
    }, options.autosaveDelay ?? 600);
  });

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
