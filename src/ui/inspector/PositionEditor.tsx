import type { GraphNode, PositionNodeConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { ContentSource, CopyOptionsFields, PointSummary } from './ObjectEditor';

/** The Position node: the point picked in the preview, what goes there (its Content input) and how. */
export function PositionEditor({ node }: { node: GraphNode }) {
  const config = node.config as PositionNodeConfig;
  const update = (patch: Partial<PositionNodeConfig>) => editorStore.getState().updateConfig<PositionNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const from = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id && e.targetPort === 'document');
    return edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined;
  });
  return (
    <>
      <p className="muted small">
        Puts the content at one point in the document. Click in the preview (showing this node's input) to pick it:
        at the cursor, or before or after a paragraph, heading, …
      </p>
      {from ? (
        <p className="hint">
          In the document from <strong>{nodeLabel(from)}</strong>.
        </p>
      ) : (
        <p className="hint warn-text">
          Connect a document to this Position node's <strong>Document</strong> input.
        </p>
      )}
      <PointSummary nodeId={node.id} point={config.point} noun="Position node" />
      {config.point && (
        <button type="button" className="link" onClick={() => update({ point: undefined })}>
          Clear the point
        </button>
      )}
      <ContentSource nodeId={node.id} owner="Position node" />
      <CopyOptionsFields options={config} onChange={update} />
    </>
  );
}
