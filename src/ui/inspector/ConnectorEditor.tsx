import type { GraphNode } from '../../engine';
import { useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';

/** A Connector has no settings: say where its document comes from and what to do with it. */
export function ConnectorEditor({ node }: { node: GraphNode }) {
  const from = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id);
    return edge && s.graph.nodes.find((n) => n.id === edge.source);
  });
  return (
    <>
      <p className="muted small">
        Passes an Output’s finished result on as a document, so it can go through more nodes: Selectors, Snippets,
        Inserts or another Output. Snippet styles and scripts and JSON field information come along.
      </p>
      <p className="small">
        {from ? (
          <>
            From <strong>{nodeLabel(from)}</strong>
          </>
        ) : (
          <span className="warn-text">Connect the Result port of an Output node to this Connector.</span>
        )}
      </p>
    </>
  );
}
