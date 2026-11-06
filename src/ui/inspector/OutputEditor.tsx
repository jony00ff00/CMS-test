import { nodeRegistry, type CmsDocument, type GraphNode, type NodeResult, type OutputConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { download } from '../download';
import { CheckboxField, SelectField } from './fields';

export function OutputEditor({ node }: { node: GraphNode }) {
  const config = node.config as OutputConfig;
  const result: NodeResult | undefined = useEditor((s) => s.results[node.id]);
  const graph = useEditor((s) => s.graph);
  const incoming = graph.edges.filter((e) => e.target === node.id && e.targetPort === 'document');
  const input = useEditor((s) => {
    if (incoming.length !== 1) return undefined;
    const edge = incoming[0];
    return s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined;
  });
  const several = incoming.length > 1;
  const update = (patch: Partial<OutputConfig>) => editorStore.getState().updateConfig<OutputConfig>(node.id, (c) => ({ ...c, ...patch }));
  const format = config.format ?? 'html';
  const jsonPossible = !several && input?.meta.json?.mapping.mode === 'fields';
  const ok = result?.status === 'ok';
  const baseName = (input?.meta.fileName ?? 'output').replace(/\.[^.]+$/, '');

  const save = () => {
    if (!ok) return;
    if (format === 'json') download(`${baseName}.edited.json`, result.outputs.json as string, 'application/json');
    else download(`${baseName}.html`, result.outputs.html as string, 'text/html');
  };

  return (
    <>
      {several && (
        <div className="field">
          <span className="field-label">Documents, in page order</span>
          <ol className="input-order" aria-label="Documents in page order">
            {incoming.map((e, i) => {
              const source = graph.nodes.find((n) => n.id === e.source);
              const label = source ? `${nodeRegistry[source.type]?.label ?? source.type} · ${source.id}` : e.source;
              return (
                <li key={e.id}>
                  <span>{label}</span>
                  <button type="button" className="ghost small-button" aria-label={`Move ${source?.id ?? e.source} up`} disabled={i === 0} onClick={() => editorStore.getState().moveInput(e.id, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost small-button"
                    aria-label={`Move ${source?.id ?? e.source} down`}
                    disabled={i === incoming.length - 1}
                    onClick={() => editorStore.getState().moveInput(e.id, 1)}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="hint">The page shows these one after another.</p>
        </div>
      )}
      <SelectField
        label="Export as"
        value={format}
        options={[
          { value: 'html', label: 'Web page (HTML)' },
          { value: 'json', label: 'JSON file (changed fields written back)' },
        ]}
        hint={
          several
            ? 'With several documents connected, only a web page can be made.'
            : format === 'json'
            ? 'Only the mapped fields change; everything else in the file stays as it was.'
            : input?.meta.json && !jsonPossible
              ? 'This JSON source uses a template, so it can only be exported as a page.'
              : undefined
        }
        onChange={(f) => update({ format: f })}
      />
      {format === 'json' ? (
        <CheckboxField
          label="Include snippet CSS and JavaScript"
          checked={!!config.jsonAssets}
          hint='Added under a "$assets" key.'
          onChange={(jsonAssets) => update({ jsonAssets })}
        />
      ) : (
        <>
          <CheckboxField
            label="Complete page"
            checked={config.fullDocument ?? true}
            hint="With title, styles and snippet scripts. Off: only the body content."
            onChange={(fullDocument) => update({ fullDocument })}
          />
          <CheckboxField
            label="Put images into the HTML"
            checked={config.inlineAssets ?? true}
            hint="Images from .docx files become part of the page, so it works on its own."
            onChange={(inlineAssets) => update({ inlineAssets })}
          />
        </>
      )}
      <button type="button" className="primary" onClick={save} disabled={!ok}>
        {format === 'json' ? 'Download JSON' : 'Download HTML'}
      </button>
      {ok && format === 'json' && (
        <details className="advanced">
          <summary>Show the JSON</summary>
          <pre className="json-preview" aria-label="Exported JSON">{result.outputs.json as string}</pre>
        </details>
      )}
    </>
  );
}
