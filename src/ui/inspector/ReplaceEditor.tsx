import type { GraphNode, ReplaceNodeConfig, Selection } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { ContentSource, CopyOptionsFields } from './ObjectEditor';

/** What the Replace node replaces (its Selection input) and with what (its Content input, copied in). */
export function ReplaceEditor({ node }: { node: GraphNode }) {
  const config = node.config as ReplaceNodeConfig;
  const update = (patch: Partial<ReplaceNodeConfig>) => editorStore.getState().updateConfig<ReplaceNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  return (
    <>
      <p className="muted small">
        Takes out what a Selector picked and puts a copy of the content in its place, at every match. Selected text
        in a paragraph takes the content of one paragraph; bigger content replaces the whole paragraph.
      </p>
      <SelectionSource nodeId={node.id} />
      <ContentSource nodeId={node.id} owner="Replace node" original="The original stays where it was." />
      <CopyOptionsFields options={config} onChange={update} placeWord="selection" />
    </>
  );
}

function SelectionSource({ nodeId }: { nodeId: string }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'selection'));
  const from = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const count = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    const value = r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as Selection | undefined) : undefined;
    return value?.matches.length;
  });
  if (!from) {
    return (
      <p className="hint warn-text">
        Connect a Selector's <strong>Selection</strong> output to say what to replace.
      </p>
    );
  }
  return (
    <p className="hint">
      Replaces what <strong>{nodeLabel(from)}</strong> selects{count === undefined ? '' : ` (${count} match${count === 1 ? '' : 'es'})`}.
    </p>
  );
}
