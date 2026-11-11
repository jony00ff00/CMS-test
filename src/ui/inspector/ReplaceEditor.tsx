import type { GraphNode, ReplaceNodeConfig, Selection } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { ContentSource, CopyOptionsFields } from './ObjectEditor';
import { CheckboxField, SelectField } from './fields';

/** What the Replace node replaces (its Selection input) and with what (its Content input, copied in). */
export function ReplaceEditor({ node }: { node: GraphNode }) {
  const config = node.config as ReplaceNodeConfig;
  const hasContent = useEditor((s) => s.graph.edges.some((e) => e.target === node.id && e.targetPort === 'content'));
  const update = (patch: Partial<ReplaceNodeConfig>) => editorStore.getState().updateConfig<ReplaceNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  return (
    <>
      <p className="muted small">
        Takes out what a Selector picked and puts a copy of the content in its place, at every match. Selected text
        in a paragraph takes the content of one paragraph; bigger content replaces the whole paragraph. With nothing
        connected to Content, it removes what the Selector picked.
      </p>
      <SelectionSource nodeId={node.id} />
      <ContentSource
        nodeId={node.id}
        owner="Replace node"
        original="The original stays where it was."
        none={
          <>
            Nothing is connected to <strong>Content</strong>, so the selected {config.target === 'inside' ? 'elements are emptied' : 'parts are removed'}.
            Connect an Extractor, a Selector's Selection or any document to put something in their place.
          </>
        }
      />
      <SelectField
        label="Replace"
        value={config.target ?? 'element'}
        options={[
          { value: 'element', label: 'The selected element itself' },
          { value: 'inside', label: 'What is inside it (keep the element and its attributes)' },
        ]}
        hint={
          config.target === 'inside'
            ? 'E.g. a <p class="intro"> keeps its class and gets the new text; a paragraph or heading takes the content of one paragraph without its <p>.'
            : undefined
        }
        onChange={(target) => update({ target: target === 'inside' ? 'inside' : undefined })}
      />
      {/* Without content there is nothing to copy in, so these do not apply. */}
      {hasContent && (
        <>
          <CheckboxField
            label="Match by match"
            checked={!!config.pairs}
            hint="The 1st match gets the 1st part of the content (the 1st match of a selection, or the 1st block of a document), the 2nd the 2nd, and so on. Off: every match gets all of it."
            onChange={(pairs) => update({ pairs: pairs || undefined })}
          />
          <CopyOptionsFields options={config} onChange={update} placeWord="selection" />
        </>
      )}
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
