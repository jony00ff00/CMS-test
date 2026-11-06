import { cleanClassName, refStatus, type GraphNode, type SnippetNodeConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, CodeField, SelectField, TextField } from './fields';
import { ParamValues, SnippetFields } from './SnippetFields';

const CUSTOM = '__custom';
const COPY = '__copy';

export function SnippetEditor({ node }: { node: GraphNode }) {
  const config = node.config as SnippetNodeConfig;
  const library = useEditor((s) => s.library);
  const { snippet, ref } = config;
  const status = refStatus(library, ref);
  const store = editorStore.getState();
  const update = (patch: Partial<SnippetNodeConfig>) => store.updateConfig<SnippetNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const linked = !config.custom && !!ref && !status?.missing;
  // An edited copy of a library snippet (from "Edit here instead"), with all of a snippet's settings.
  const copy = !config.custom && !linked;

  const choices = [
    ...Object.values(library).map((versions) => {
      const latest = versions[versions.length - 1];
      return { value: latest.id, label: latest.name };
    }),
    ...(copy ? [{ value: COPY, label: ref && status?.missing ? `${snippet.name} (no longer in the library)` : `${snippet.name} (edited copy)` }] : []),
    { value: CUSTOM, label: 'Custom (only this node)' },
  ];

  return (
    <>
      <SelectField
        label="Snippet"
        value={config.custom ? CUSTOM : linked ? ref.id : COPY}
        options={choices}
        onChange={(v) => (v === CUSTOM ? store.makeCustomSnippet(node.id) : v === COPY ? undefined : store.useLibrarySnippet(node.id, v))}
      />
      {config.custom ? (
        <CustomFields node={node} config={config} />
      ) : linked ? (
        <div className="snippet-linked">
          <p className="muted small">
            {snippet.description ? `${snippet.description}. ` : ''}Version {ref.version} from the library.
          </p>
          {status?.outdated && status.latest && (
            <div className="update-banner" role="status">
              <span>Version {status.latest.version} is available.</span>
              <button type="button" onClick={() => store.updateNodeSnippet(node.id)}>
                Update to v{status.latest.version}
              </button>
            </div>
          )}
          <div className="button-row">
            <button type="button" onClick={() => store.openSnippet(ref.id)}>
              Edit in library
            </button>
            <button type="button" className="ghost" onClick={() => store.detachSnippet(node.id)}>
              Edit here instead
            </button>
          </div>
        </div>
      ) : (
        <>
          {ref && status?.missing && <p className="warn-text">This snippet was deleted from the library. The node keeps its own copy.</p>}
          <SnippetFields snippet={snippet} onChange={(patch) => update({ snippet: { ...snippet, ...patch } })} />
          <button type="button" onClick={() => store.saveNodeSnippetToLibrary(node.id)}>
            Save to library
          </button>
        </>
      )}
      {!config.custom && (
        <>
          <ParamValues params={snippet.params} values={config.params} onChange={(name, value) => update({ params: { ...config.params, [name]: value } })} />
          <details className="advanced node-code" open={!!(config.css?.trim() || config.js?.trim())}>
            <summary>CSS and JavaScript for this node only</summary>
            <OwnCode config={config} onChange={update} />
          </details>
        </>
      )}
      <CheckboxField
        label="Snap text selections to whole blocks"
        checked={!!config.snapToBlock}
        hint="A selection across paragraphs gets one wrapper around the whole paragraphs."
        onChange={(snapToBlock) => update({ snapToBlock })}
      />
    </>
  );
}

/** "Custom (only this node)": a class for the selected content, and the CSS and JavaScript that use it. */
function CustomFields({ node, config }: { node: GraphNode; config: SnippetNodeConfig }) {
  const store = editorStore.getState();
  const custom = config.custom!;
  const update = (patch: Partial<SnippetNodeConfig>) => store.updateConfig<SnippetNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const className = cleanClassName(custom.className);
  const wrap = custom.wrap ?? 'none';
  return (
    <>
      <p className="muted small">
        The selected content gets the class <code>.{className}</code>; write CSS and JavaScript for it below. Only this
        node adds them to the page.
      </p>
      <TextField
        label="Class name"
        monospace
        value={custom.className}
        hint={custom.className.trim() !== className ? `Used as “${className}” (letters, digits, - and _ only).` : undefined}
        onChange={(v) => update({ custom: { ...custom, className: v } })}
      />
      <SelectField
        label="Put the class on"
        value={wrap}
        options={[
          { value: 'none', label: 'The selected content itself' },
          { value: 'div', label: 'A new box around it (<div>)' },
          { value: 'span', label: 'A new inline wrapper around it (<span>)' },
        ]}
        hint={wrap === 'none' ? 'Selected text (not whole elements) gets a <span> with the class.' : undefined}
        onChange={(w) => update({ custom: { ...custom, wrap: w } })}
      />
      <OwnCode config={config} onChange={update} className={className} />
      <button type="button" onClick={() => store.saveNodeSnippetToLibrary(node.id)}>
        Save to library
      </button>
    </>
  );
}

function OwnCode({ config, onChange, className }: { config: SnippetNodeConfig; onChange: (p: Partial<SnippetNodeConfig>) => void; className?: string }) {
  const target = className ? `.${className}` : 'the snippet’s classes';
  return (
    <>
      <CodeField
        label="CSS"
        language="css"
        value={config.css ?? ''}
        hint={`Added to the page once. Target ${target}${className ? `, e.g. .${className} { background: #fef3c7; }` : ''}.`}
        onChange={(css) => onChange({ css })}
      />
      <CodeField
        label="JavaScript"
        language="javascript"
        value={config.js ?? ''}
        hint={`Runs once when the page has loaded (in the preview too, which is sandboxed)${className ? `, e.g. document.querySelectorAll('.${className}').forEach((el) => { … })` : ''}.`}
        onChange={(js) => onChange({ js })}
      />
    </>
  );
}
