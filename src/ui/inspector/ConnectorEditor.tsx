import { connectorInputKind, type ConnectorConfig, type GraphNode } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { CheckboxField, SelectField } from './fields';

const KIND_LABELS = { document: 'a document', selection: 'a selection', point: 'a point', html: 'HTML' } as const;

/** Where the Connector's input comes from, and the choices for turning it into the other kinds. */
export function ConnectorEditor({ node }: { node: GraphNode }) {
  const config = node.config as ConnectorConfig;
  const update = (patch: Partial<ConnectorConfig>) => editorStore.getState().updateConfig<ConnectorConfig>(node.id, (c) => ({ ...c, ...patch }));
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === node.id));
  const from = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const kind = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    return r?.status === 'ok' ? connectorInputKind(r.outputs[edge!.sourcePort]) : undefined;
  });
  return (
    <>
      <p className="muted small">
        Takes anything (a document, an Output's result, a selection or HTML) and gives it as every kind, so any node
        can follow: use the output you need.
      </p>
      {from ? (
        <p className="small">
          From <strong>{nodeLabel(from)}</strong>
          {kind && <> · {KIND_LABELS[kind]}</>}
        </p>
      ) : (
        <p className="small warn-text">Connect any output to this Connector's input.</p>
      )}
      {(!kind || kind === 'selection') && (
        <SelectField
          label="A selection as a document"
          value={config.selectionToDocument ?? 'content'}
          options={[
            { value: 'content', label: 'Only what it selected (a new document)' },
            { value: 'document', label: 'The whole document it selects in' },
          ]}
          onChange={(selectionToDocument) => update({ selectionToDocument })}
        />
      )}
      {kind !== 'selection' && (
        <SelectField
          label="As a selection"
          value={config.documentToSelection ?? 'document'}
          options={[
            { value: 'document', label: 'Everything, as one selection' },
            { value: 'blocks', label: 'Each block on its own' },
          ]}
          onChange={(documentToSelection) => update({ documentToSelection })}
        />
      )}
      {kind !== 'html' && (
        <CheckboxField
          label="HTML as a complete page"
          checked={config.fullPage ?? true}
          hint="With title, styles and snippet scripts. Off: only the body content."
          onChange={(fullPage) => update({ fullPage })}
        />
      )}
    </>
  );
}
