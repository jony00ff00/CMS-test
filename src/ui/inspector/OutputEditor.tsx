import type { CmsDocument, GraphNode, NodeResult, OutputConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { download } from '../download';
import { CheckboxField, SelectField } from './fields';

export function OutputEditor({ node }: { node: GraphNode }) {
  const config = node.config as OutputConfig;
  const result: NodeResult | undefined = useEditor((s) => s.results[node.id]);
  const input = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id);
    return edge ? (s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined) : undefined;
  });
  const update = (patch: Partial<OutputConfig>) => editorStore.getState().updateConfig<OutputConfig>(node.id, (c) => ({ ...c, ...patch }));
  const format = config.format ?? 'html';
  const jsonPossible = input?.meta.json?.mapping.mode === 'fields';
  const ok = result?.status === 'ok';
  const baseName = (input?.meta.fileName ?? 'output').replace(/\.[^.]+$/, '');

  const save = () => {
    if (!ok) return;
    if (format === 'json') download(`${baseName}.edited.json`, result.outputs.json as string, 'application/json');
    else download(`${baseName}.html`, result.outputs.html as string, 'text/html');
  };

  return (
    <>
      <SelectField
        label="Export as"
        value={format}
        options={[
          { value: 'html', label: 'Web page (HTML)' },
          { value: 'json', label: 'JSON file (changed fields written back)' },
        ]}
        hint={
          format === 'json'
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
