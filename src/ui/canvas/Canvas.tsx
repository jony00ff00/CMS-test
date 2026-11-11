import {
  applyNodeChanges, Background, Controls, MiniMap, Panel, ReactFlow, useReactFlow, type Connection, type Edge,
  type EdgeChange, type FinalConnectionState, type IsValidConnection, type NodeChange, useNodesInitialized,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { edgeError, nodeRegistry, type EdgeCandidate } from '../../engine';
import { editorStore, selectedNodeIds, useEditor } from '../../store/editor-store';
import { CmsNode, type CmsFlowNode } from './CmsNode';
import { DeletableEdge } from './DeletableEdge';
import { MiniMapNode } from './MiniMapNode';
import { GroupFrame, type GroupFlowNode } from './GroupFrame';
import { collapsedPorts, collapsedSize, frameBox, frameId, groupIdOfFrame, groupLayers, isFrameId, portHandle, raise, resolveHandle } from './group-layout';
import { NODE_COLORS, UNKNOWN_NODE_COLOR } from '../node-colors';
import { ProjectToolbar } from './ProjectToolbar';
import { DRAG_TYPE } from './Palette';

const nodeTypes = { cms: CmsNode, cmsGroup: GroupFrame };
type FlowNode = CmsFlowNode | GroupFlowNode;
/** Hold one of these and click to add a node to the selection (or take it out). */
const MULTI_SELECT_KEYS = ['Shift', 'Control', 'Meta'];
const edgeTypes = { deletable: DeletableEdge };

/** A connection on the canvas as the graph has it: a collapsed group's handles stand for its nodes' ports. */
const toCandidate = (c: Connection | Edge): EdgeCandidate => {
  const from = resolveHandle(c.source, c.sourceHandle);
  const to = resolveHandle(c.target, c.targetHandle);
  return { source: from.node, sourcePort: from.port, target: to.node, targetPort: to.port };
};

export function Canvas() {
  const graph = useEditor((s) => s.graph);
  // A string, so the selector gives the same value until the selection really changes.
  const selection = useEditor((s) => selectedNodeIds(s).join(' '));
  const evaluating = useEditor((s) => s.evaluating);
  const fitRequest = useEditor((s) => s.fitRequest);
  const fitTo = useEditor((s) => s.fitTo);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const initialized = useNodesInitialized();

  // React Flow keeps measured sizes on its node objects, so nodes live in local state,
  // synced from the store whenever the graph changes.
  const [nodes, setNodes] = useState<CmsFlowNode[]>([]);
  useEffect(() => {
    const selected = new Set(selection.split(' '));
    setNodes((prev) =>
      graph.nodes.map((n) => {
        const old = prev.find((p) => p.id === n.id);
        return { ...old, id: n.id, type: 'cms', data: {}, position: n.position ?? { x: 0, y: 0 }, selected: selected.has(n.id) };
      }),
    );
  }, [graph.nodes, selection]);

  // Fit the view once nodes are measured after loading an example (not when nodes are added one by one:
  // moving the view then would get in the way of dragging).
  const fitted = useRef(0);
  useEffect(() => {
    if (!initialized || fitRequest === fitted.current) return;
    fitted.current = fitRequest;
    void fitView({ padding: 0.15, maxZoom: 1 });
  }, [initialized, fitRequest, fitView]);

  // Fit the view to a group (from the Groups list).
  const fittedTo = useRef(0);
  useEffect(() => {
    if (!fitTo || fitTo.n === fittedTo.current) return;
    fittedTo.current = fitTo.n;
    const group = graph.groups?.find((g) => g.id === fitTo.groupId);
    const ids = group?.collapsed ? [frameId(group.id)] : [...fitTo.nodeIds, ...(group ? [frameId(group.id)] : [])];
    void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, maxZoom: 1, duration: 250 });
  }, [fitTo, graph.groups, fitView]);

  // Expanded groups lie above other nodes; the one last expanded, selected or dragged (or with a node selected) on top.
  const [raised, setRaised] = useState<string[]>([]);
  const selectedGroupId = useEditor((s) => s.selectedGroupId);
  const mainNode = useEditor((s) => s.selectedId);
  const wasCollapsed = useRef(new Set<string>());
  useEffect(() => {
    const groups = graph.groups ?? [];
    // Collapsed or expanded since last time.
    const changed = groups.filter((g) => !!g.collapsed !== wasCollapsed.current.has(g.id)).map((g) => g.id);
    wasCollapsed.current = new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
    if (changed.length) setRaised((r) => changed.reduce(raise, r));
  }, [graph.groups]);
  useEffect(() => {
    if (selectedGroupId) setRaised((r) => raise(r, selectedGroupId));
  }, [selectedGroupId]);
  const groupOfMain = useEditor((s) => (s.selectedId ? s.graph.groups?.find((g) => g.nodeIds.includes(s.selectedId!))?.id : undefined));
  useEffect(() => {
    if (groupOfMain) setRaised((r) => raise(r, groupOfMain));
  }, [groupOfMain, mainNode]);
  const layers = useMemo(() => groupLayers(graph.groups ?? [], raised), [graph.groups, raised]);
  /** The z-index of a node in an expanded group (above its frame), or undefined. */
  const memberZ = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of graph.groups ?? []) {
      const z = layers.get(g.id);
      if (z !== undefined && !g.collapsed) for (const id of g.nodeIds) map.set(id, z + 1);
    }
    return map;
  }, [graph.groups, layers]);

  // Nodes in a collapsed group are hidden; the group shows as one box instead.
  const collapsedOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of graph.groups ?? []) if (g.collapsed) for (const id of g.nodeIds) map.set(id, g.id);
    return map;
  }, [graph.groups]);

  // Each group's frame, around its nodes as they are now (also while they are dragged).
  const frames = useMemo<GroupFlowNode[]>(
    () =>
      (graph.groups ?? []).flatMap((g): GroupFlowNode[] => {
        const members = nodes.filter((n) => g.nodeIds.includes(n.id));
        if (!members.length) return [];
        const box = frameBox(members);
        if (g.collapsed) {
          const ports = collapsedPorts(graph, g);
          const size = collapsedSize(Math.max(ports.inputs.length, ports.outputs.length));
          // `measured` too: React Flow keeps a node's measured handles only when the new node object has it.
          return [{ id: frameId(g.id), type: 'cmsGroup', position: { x: box.x, y: box.y }, ...size, measured: size, data: { groupId: g.id, ports }, selectable: false, className: 'is-collapsed', zIndex: layers.get(g.id) ?? 0 }];
        }
        return [{
          id: frameId(g.id), type: 'cmsGroup', position: { x: box.x, y: box.y }, width: box.width, height: box.height,
          measured: { width: box.width, height: box.height },
          data: { groupId: g.id }, selectable: false, dragHandle: '.group-frame-head', zIndex: layers.get(g.id) ?? 0,
        }];
      }),
    [graph, nodes, layers],
  );
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const flowNodes = useMemo<FlowNode[]>(
    () => [...frames, ...nodes.map((n) => (collapsedOf.has(n.id) ? { ...n, hidden: true } : memberZ.has(n.id) ? { ...n, zIndex: memberZ.get(n.id) } : n))],
    [frames, nodes, collapsedOf, memberZ],
  );

  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.flatMap((e) => {
        const source = graph.nodes.find((n) => n.id === e.source);
        const type = source && nodeRegistry[source.type]?.outputs.find((p) => p.name === e.sourcePort)?.type;
        const from = collapsedOf.get(e.source);
        const to = collapsedOf.get(e.target);
        // Inside one collapsed group: not shown. Into or out of one: drawn to the group's box.
        if (from && from === to) return [];
        return [{
          id: e.id,
          source: from ? frameId(from) : e.source,
          sourceHandle: from ? portHandle('out', e.source, e.sourcePort) : e.sourcePort,
          target: to ? frameId(to) : e.target,
          targetHandle: to ? portHandle('in', e.target, e.targetPort) : e.targetPort,
          type: 'deletable',
          className: `edge-${type ?? 'unknown'}`,
          selected: selectedEdges.has(e.id),
          // Inside an expanded group: above its frame (under its nodes). Others stay below all nodes, so they never
          // cover a node's handles or block clicks on it.
          zIndex: memberZ.get(e.source) !== undefined && memberZ.get(e.source) === memberZ.get(e.target) ? memberZ.get(e.source) : undefined,
        }];
      }),
    [graph, selectedEdges, collapsedOf, memberZ],
  );

  // The minimap shows each node in its type's colour, and each group in its own (a light frame when expanded).
  const nodeColor = useCallback(
    (n: FlowNode) => {
      if (n.type === 'cmsGroup') {
        const color = graph.groups?.find((g) => g.id === n.data.groupId)?.color ?? '#64748b';
        return n.className === 'is-collapsed' ? color : `${color}22`;
      }
      return NODE_COLORS[graph.nodes.find((g) => g.id === n.id)?.type ?? ''] ?? UNKNOWN_NODE_COLOR;
    },
    [graph.nodes, graph.groups],
  );
  const nodeStroke = useCallback(
    (n: FlowNode) => (n.type === 'cmsGroup' ? (graph.groups?.find((g) => g.id === n.data.groupId)?.color ?? '#64748b') : nodeColor(n)),
    [graph.groups, nodeColor],
  );

  /** While a group's frame is dragged: where it and its nodes started. */
  const frameDrag = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> }>(undefined);

  const onNodesChange = useCallback((all: NodeChange<FlowNode>[]) => {
    const state = editorStore.getState();
    // A frame being dragged moves its group's nodes by as much as it moved (one undo step when dropped).
    for (const c of all) {
      if (c.type !== 'position' || !isFrameId(c.id) || !c.position) continue;
      const frame = framesRef.current.find((f) => f.id === c.id);
      const group = state.graph.groups?.find((g) => g.id === groupIdOfFrame(c.id));
      if (!frame || !group) continue;
      let drag = frameDrag.current;
      if (!drag || drag.id !== c.id) {
        const members = new Map(state.graph.nodes.filter((n) => group.nodeIds.includes(n.id)).map((n) => [n.id, n.position ?? { x: 0, y: 0 }]));
        drag = frameDrag.current = { id: c.id, start: frame.position, members };
        setRaised((r) => raise(r, group.id));
      }
      const dx = c.position.x - drag.start.x;
      const dy = c.position.y - drag.start.y;
      const moved = Object.fromEntries([...drag.members].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]));
      setNodes((ns) => ns.map((n) => (moved[n.id] ? { ...n, position: moved[n.id] } : n)));
      if (!c.dragging) {
        frameDrag.current = undefined;
        if (dx || dy) state.moveNodes(moved);
      }
    }
    const changes = all.filter((c) => !('id' in c) || !isFrameId(c.id)) as NodeChange<CmsFlowNode>[];
    setNodes((ns) => applyNodeChanges(changes, ns));
    // Dragging several selected nodes moves them all: one undo step when they are dropped.
    const moved: Record<string, { x: number; y: number }> = {};
    const added: string[] = [];
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type === 'position' && c.position && !c.dragging) moved[c.id] = c.position;
      if (c.type === 'select') (c.selected ? added : removed).push(c.id);
    }
    state.moveNodes(moved);
    // React Flow decides what a click (with or without Shift / Ctrl / Cmd) or a selection box selects.
    if (added.length || removed.length) state.changeSelection(added, removed);
    // Removals are handled in onDelete, all at once.
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        if (c.type === 'remove') next.delete(c.id);
      }
      return next;
    });
  }, []);

  const isValidConnection = useCallback<IsValidConnection>(
    (c) => !edgeError(editorStore.getState().graph, toCandidate(c), nodeRegistry),
    [],
  );

  const onConnect = useCallback((c: Connection) => {
    editorStore.getState().connect(toCandidate(c));
  }, []);

  // Dropping on a handle that does not fit: say why.
  const onConnectEnd = useCallback((_e: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (!s.fromHandle || !s.toHandle || s.isValid !== false) return;
    const [from, to] = s.fromHandle.type === 'source' ? [s.fromHandle, s.toHandle] : [s.toHandle, s.fromHandle];
    const a = resolveHandle(from.nodeId, from.id);
    const b = resolveHandle(to.nodeId, to.id);
    const candidate = { source: a.node, sourcePort: a.port, target: b.node, targetPort: b.port };
    const state = editorStore.getState();
    const reason =
      from.type === to.type
        ? `Connect an output (right side) to an input (left side)`
        : edgeError(state.graph, candidate, nodeRegistry);
    if (reason) state.notify('error', reason);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(DRAG_TYPE);
      if (!type) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const at = { x: p.x - 110, y: p.y - 30 };
      editorStore.getState().addNode(type, at);
    },
    [screenToFlowPosition],
  );

  return (
    <main className="canvas" aria-label="Canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onPaneClick={() => editorStore.getState().select(undefined)}
        // Also for a node that is already selected (e.g. to leave the snippet library editor and show it again).
        // With Shift / Ctrl / Cmd the click adds or removes the node (see onNodesChange) instead.
        onNodeClick={(e, n) => {
          // A group's header (or its collapsed box): select the group.
          if (isFrameId(n.id)) editorStore.getState().selectGroup(groupIdOfFrame(n.id));
          else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) editorStore.getState().select(n.id);
        }}
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        onDelete={({ nodes: n, edges: e }) => editorStore.getState().removeElements(n.filter((x) => !isFrameId(x.id)).map((x) => x.id), e.map((x) => x.id))}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable className="minimap" style={{ width: 160, height: 100 }} nodeColor={nodeColor} nodeStrokeColor={nodeStroke} nodeBorderRadius={3} nodeComponent={MiniMapNode} />
        <Panel position="top-left" className="canvas-toolbar">
          <ExampleButtons />
          {graph.nodes.length > 0 && (
            <button type="button" className="ghost" onClick={() => editorStore.getState().clear()}>
              Clear
            </button>
          )}
          {evaluating && <span className="running" role="status">Running…</span>}
        </Panel>
        <Panel position="top-right">
          <ProjectToolbar />
        </Panel>
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <div className="canvas-empty">
          <p>Add nodes from the palette and connect them, or start from an example.</p>
          <p className="muted small">A typical graph: Document Source → Selector → Snippet → Output</p>
        </div>
      )}
    </main>
  );
}

function ExampleButtons() {
  const [loading, setLoading] = useState<string | undefined>();
  const confirmReplace = () => !editorStore.getState().graph.nodes.length || window.confirm('Replace the current graph with the example?');
  const load = (kind: 'html' | 'json') => {
    if (confirmReplace()) editorStore.getState().loadExample(kind);
  };
  // These are whole project files (with their Word and HTML files), so they are downloaded only when asked for.
  const loadProject = async (name: string, importer: () => Promise<{ default: string }>) => {
    if (!confirmReplace()) return;
    setLoading(name);
    try {
      editorStore.getState().openExampleProject((await importer()).default);
    } catch {
      editorStore.getState().notify('error', 'The example could not be loaded. Check the connection and try again.');
    } finally {
      setLoading(undefined);
    }
  };
  return (
    <>
      <button type="button" onClick={() => load('html')}>
        HTML example
      </button>
      <button type="button" onClick={() => load('json')}>
        JSON example
      </button>
      <button
        type="button"
        onClick={() => void loadProject('scrolly', () => import('../../../examples/ge16-scrolly.node-cms.json?raw'))}
        disabled={!!loading}
        title="Two documents: text written in Word put into a developer’s HTML code for a scrollytelling graphic"
      >
        {loading === 'scrolly' ? 'Loading…' : 'Two documents'}
      </button>
      <button
        type="button"
        onClick={() => void loadProject('review', () => import('../../../examples/word-review.node-cms.json?raw'))}
        disabled={!!loading}
        title="A Word file with tracked changes, comments and messy formatting, made into CKEditor 5 data with one house style"
      >
        {loading === 'review' ? 'Loading…' : 'Word review'}
      </button>
    </>
  );
}
