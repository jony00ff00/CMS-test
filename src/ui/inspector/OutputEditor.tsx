import { nodeRegistry, type CmsDocument, type GraphNode, type NodeResult, type OutputConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { download } from '../download';
import { nodeLabel } from '../node-label';
import { CheckboxField, SelectField, TextField } from './fields';

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
  const appended = several && config.combine === 'append';
  const update = (patch: Partial<OutputConfig>) => editorStore.getState().updateConfig<OutputConfig>(node.id, (c) => ({ ...c, ...patch }));
  const format = config.format ?? 'html';
  const jsonPossible = !appended && (several || input?.meta.json?.mapping.mode === 'fields');
  const ok = result?.status === 'ok';
  const baseName = (input?.meta.fileName ?? 'output').replace(/\.[^.]+$/, '');

  const save = () => {
    if (!ok) return;
    if (format === 'json') download(`${baseName}.edited.json`, result.outputs.json as string, 'application/json');
    else if (format === 'ckeditor') download(`${baseName}.ckeditor-import.json`, result.outputs.json as string, 'application/json');
    else download(`${baseName}${format === 'slides' ? '.slides' : ''}.html`, result.outputs.html as string, 'text/html');
  };

  return (
    <>
      {several && (
        <div className="field">
          <SelectField
            label="Combine the documents"
            value={config.combine ?? 'merge'}
            options={[
              { value: 'merge', label: 'Apply all their changes to one document' },
              { value: 'append', label: 'Show them one after another' },
            ]}
            hint={
              (config.combine ?? 'merge') === 'merge'
                ? 'Each input’s changes are applied in this order. Documents from different sources are shown one after another.'
                : 'Each document is shown in full, in this order.'
            }
            onChange={(combine) => update({ combine })}
          />
          <span className="field-label">{(config.combine ?? 'merge') === 'merge' ? 'Order the changes are applied in' : 'Documents, in page order'}</span>
          <ol className="input-order" aria-label="Documents in page order">
            {incoming.map((e, i) => {
              const source = graph.nodes.find((n) => n.id === e.source);
              const label = source ? `${nodeRegistry[source.type]?.label ?? source.type} · ${nodeLabel(source)}` : e.source;
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
        </div>
      )}
      <SelectField
        label="Export as"
        value={format}
        options={[
          { value: 'html', label: 'Web page (HTML)' },
          { value: 'json', label: 'JSON file (changed fields written back)' },
          { value: 'slides', label: 'Slide deck (one slide at a time)' },
          { value: 'ckeditor', label: 'CKEditor 5 (Cloud Services import)' },
        ]}
        hint={
          appended
            ? 'Documents shown one after another can only be made into a web page.'
            : format === 'json'
            ? 'Only the mapped fields change; everything else in the file stays as it was.'
            : format === 'ckeditor'
            ? 'Content with suggestion and comment markers, the suggestions and comment threads, as the body of a Cloud Services import request (POST /documents). Send it with scripts/ckeditor-import.mjs from your server.'
            : format === 'slides'
            ? 'A page that shows one slide at a time: arrow keys, Space, Page Up / Down, Home / End, N for speaker notes. Documents without slides get a new slide at each heading.'
            : input?.meta.json && !jsonPossible
              ? 'This JSON source uses a template, so it can only be exported as a page.'
              : undefined
        }
        onChange={(f) => update({ format: f })}
      />
      {format === 'ckeditor' ? (
        <CkeditorFields config={config} update={update} />
      ) : format === 'json' ? (
        <CheckboxField
          label="Include snippet CSS and JavaScript"
          checked={!!config.jsonAssets}
          hint='Added under a "$assets" key.'
          onChange={(jsonAssets) => update({ jsonAssets })}
        />
      ) : format === 'slides' ? (
        <CheckboxField
          label="Put images into the HTML"
          checked={config.inlineAssets ?? true}
          hint="So the deck works on its own as one file."
          onChange={(inlineAssets) => update({ inlineAssets })}
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
        {format === 'json' ? 'Download JSON' : format === 'ckeditor' ? 'Download CKEditor import (.json)' : 'Download HTML'}
      </button>
      {ok && (format === 'json' || format === 'ckeditor') && (
        <details className="advanced">
          <summary>Show the JSON</summary>
          <pre className="json-preview" aria-label="Exported JSON">{result.outputs.json as string}</pre>
        </details>
      )}
    </>
  );
}

function CkeditorFields({ config, update }: { config: OutputConfig; update: (patch: Partial<OutputConfig>) => void }) {
  const ck = config.ckeditor ?? {};
  const set = (patch: Partial<NonNullable<OutputConfig['ckeditor']>>) => update({ ckeditor: { ...ck, ...patch } });
  const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return (
    <fieldset>
      <legend>CKEditor 5</legend>
      <p className="hint warn-text">
        The import format could not be checked against CKEditor's documentation from here. Before the first real import,
        compare it with an export of a test document from your environment (GET /documents/&lt;id&gt;).
      </p>
      <TextField label="Document id" value={ck.documentId ?? ''} placeholder="e.g. ge16-brief" monospace hint="The editor's collaboration channel id. It must not exist yet in Cloud Services." onChange={(documentId) => set({ documentId })} />
      <TextField label="Editor bundle version" value={ck.bundleVersion ?? ''} placeholder="e.g. 1.0.3" monospace hint="The version of the editor bundle you uploaded to Cloud Services." onChange={(bundleVersion) => set({ bundleVersion })} />
      <TextField
        label="Heading elements"
        value={(ck.headings ?? ['h2', 'h3', 'h4']).join(', ')}
        monospace
        hint="The headings your editor offers (by default Heading 1–3 are h2, h3, h4)."
        onChange={(v) => set({ headings: list(v) })}
      />
      <TextField
        label="Other elements your editor allows"
        value={(ck.extraElements ?? []).join(', ')}
        placeholder="e.g. u, s, img, sub, sup"
        monospace
        hint="Paragraphs, bold, italic, links, lists, quotes and tables are always allowed."
        onChange={(v) => set({ extraElements: list(v) })}
      />
    </fieldset>
  );
}
