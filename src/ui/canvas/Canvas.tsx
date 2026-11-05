import {
  applyNodeChanges, Background, Controls, MiniMap, Panel, ReactFlow, useReactFlow, type Connection, type Edge,
  type EdgeChange, type FinalConnectionState, type IsValidConnection, type NodeChange, useNodesInitialized,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { edgeError, nodeRegistry, type EdgeCandidate } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CmsNode, type CmsFlowNode } from './CmsNode';
import { ProjectToolbar } from './ProjectToolbar';
import { DRAG_SNIPPET } from '../library/LibraryPanel';
import { DRAG_TYPE } from './Palette';

const nodeTypes = { cms: CmsNode };

const toCandidate = (c: Connection | Edge): EdgeCandidate => ({
  source: c.source,
  sourcePort: c.sourceHandle ?? '',
  target: c.target,
  targetPort: c.targetHandle ?? '',
});

export function Canvas() {
  const graph = useEditor((s) => s.graph);
  const selectedId = useEditor((s) => s.selectedId);
  const evaluating = useEditor((s) => s.evaluating);
  const fitRequest = useEditor((s) => s.fitRequest);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const initialized = useNodesInitialized();

  // React Flow keeps measured sizes on its node objects, so nodes live in local state,
  // synced from the store whenever the graph changes.
  const [nodes, setNodes] = useState<CmsFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) =>
      graph.nodes.map((n) => {
        const old = prev.find((p) => p.id === n.id);
        return { ...old, id: n.id, type: 'cms', data: {}, position: n.position ?? { x: 0, y: 0 }, selected: n.id === selectedId };
      }),
    );
  }, [graph.nodes, selectedId]);

  // Fit the view once nodes are measured after loading an example (not when nodes are added one by one:
  // moving the view then would get in the way of dragging).
  const fitted = useRef(0);
  useEffect(() => {
    if (!initialized || fitRequest === fitted.current) return;
    fitted.current = fitRequest;
    void fitView({ padding: 0.15, maxZoom: 1 });
  }, [initialized, fitRequest, fitView]);

  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const source = graph.nodes.find((n) => n.id === e.source);
        const type = source && nodeRegistry[source.type]?.outputs.find((p) => p.name === e.sourcePort)?.type;
        return {
          id: e.id,
          source: e.source,
          sourceHandle: e.sourcePort,
          target: e.target,
          targetHandle: e.targetPort,
          className: `edge-${type ?? 'unknown'}`,
          selected: selectedEdges.has(e.id),
        };
      }),
    [graph, selectedEdges],
  );

  const onNodesChange = useCallback((changes: NodeChange<CmsFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    const state = editorStore.getState();
    for (const c of changes) {
      if (c.type === 'position' && c.position && !c.dragging) state.moveNode(c.id, c.position);
      if (c.type === 'select' && c.selected) state.select(c.id);
    }
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
    const candidate = { source: from.nodeId, sourcePort: from.id ?? '', target: to.nodeId, targetPort: to.id ?? '' };
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
      const snippetId = e.dataTransfer.getData(DRAG_SNIPPET);
      if (!type && !snippetId) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const at = { x: p.x - 110, y: p.y - 30 };
      if (snippetId) editorStore.getState().addSnippetNode(snippetId, at);
      else editorStore.getState().addNode(type, at);
    },
    [screenToFlowPosition],
  );

  return (
    <main className="canvas" aria-label="Canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onPaneClick={() => editorStore.getState().select(undefined)}
        onDelete={({ nodes: n, edges: e }) => editorStore.getState().removeElements(n.map((x) => x.id), e.map((x) => x.id))}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable className="minimap" />
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
  const load = (kind: 'html' | 'json') => {
    const state = editorStore.getState();
    if (state.graph.nodes.length && !window.confirm('Replace the current graph with the example?')) return;
    state.loadExample(kind);
  };
  return (
    <>
      <button type="button" onClick={() => load('html')}>
        HTML example
      </button>
      <button type="button" onClick={() => load('json')}>
        JSON example
      </button>
    </>
  );
}
