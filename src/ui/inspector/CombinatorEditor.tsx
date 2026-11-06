import { valueKind, type CombinatorConfig, type GraphNode } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { CheckboxField, SelectField } from './fields';

const KIND_LABELS = { document: 'a document', selection: 'a selection', point: 'a point', html: 'HTML' } as const;

/** A and B, how they are combined, and how the result is turned into the other kinds. */
export function CombinatorEditor({ node }: { node: GraphNode }) {
  const config = node.config as CombinatorConfig;
  const update = (patch: Partial<CombinatorConfig>) => editorStore.getState().updateConfig<CombinatorConfig>(node.id, (c) => ({ ...c, ...patch }));
  const result = useEditor((s) => s.results[node.id]);
  return (
    <>
      <p className="muted small">Combines what comes into A and B (any kind) and gives the result as every kind: use the output you need.</p>
      <ul className="combinator-inputs">
        <InputLine nodeId={node.id} port="a" />
        <InputLine nodeId={node.id} port="b" />
      </ul>
      <SelectField
        label="Combine"
        value={config.combine ?? 'merge'}
        options={[
          { value: 'merge', label: 'Merge: both changes in one document' },
          { value: 'append', label: 'A, then B' },
        ]}
        hint={
          (config.combine ?? 'merge') === 'merge'
            ? 'Two changed versions of the same document become one with both changes (A’s first); two selections in one document become one selection. Anything else goes A, then B.'
            : 'A’s document, then B’s, one after the other.'
        }
        onChange={(combine) => update({ combine })}
      />
      {result?.info.combined !== undefined && <p className="small muted">Combined: {String(result.info.combined).replace(/^2$/, 'merged into one document')}</p>}
      <SelectField
        label="A selection as a document"
        value={config.selectionToDocument ?? 'content'}
        options={[
          { value: 'content', label: 'Only what it selected (a new document)' },
          { value: 'document', label: 'The whole document it selects in' },
        ]}
        onChange={(selectionToDocument) => update({ selectionToDocument })}
      />
      <SelectField
        label="As a selection"
        value={config.documentToSelection ?? 'document'}
        options={[
          { value: 'document', label: 'Everything, as one selection' },
          { value: 'blocks', label: 'Each block on its own' },
        ]}
        onChange={(documentToSelection) => update({ documentToSelection })}
      />
      <CheckboxField
        label="HTML as a complete page"
        checked={config.fullPage ?? true}
        hint="With title, styles and snippet scripts. Off: only the body content."
        onChange={(fullPage) => update({ fullPage })}
      />
    </>
  );
}

function InputLine({ nodeId, port }: { nodeId: string; port: 'a' | 'b' }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === port));
  const from = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const kind = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    return r?.status === 'ok' ? valueKind(r.outputs[edge!.sourcePort]) : undefined;
  });
  return (
    <li>
      <strong>{port.toUpperCase()}</strong>{' '}
      {from ? (
        <>
          {nodeLabel(from)}
          {kind && <span className="muted"> · {KIND_LABELS[kind]}</span>}
        </>
      ) : (
        <span className="muted">not connected</span>
      )}
    </li>
  );
}
