import { refStatus, type GraphNode, type SnippetNodeConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, SelectField } from './fields';
import { ParamValues, SnippetFields } from './SnippetFields';

const CUSTOM = '__custom';

export function SnippetEditor({ node }: { node: GraphNode }) {
  const config = node.config as SnippetNodeConfig;
  const library = useEditor((s) => s.library);
  const { snippet, ref } = config;
  const status = refStatus(library, ref);
  const store = editorStore.getState();
  const update = (patch: Partial<SnippetNodeConfig>) => store.updateConfig<SnippetNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const linked = !!ref && !status?.missing;

  const choices = [
    ...Object.values(library).map((versions) => {
      const latest = versions[versions.length - 1];
      return { value: latest.id, label: latest.name };
    }),
    { value: CUSTOM, label: ref && status?.missing ? `${snippet.name} (no longer in the library)` : 'Custom (only this node)' },
  ];

  return (
    <>
      <SelectField
        label="Snippet"
        value={linked ? ref.id : CUSTOM}
        options={choices}
        onChange={(v) => (v === CUSTOM ? store.detachSnippet(node.id) : store.useLibrarySnippet(node.id, v))}
      />
      {linked ? (
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
      <ParamValues params={snippet.params} values={config.params} onChange={(name, value) => update({ params: { ...config.params, [name]: value } })} />
      <CheckboxField
        label="Snap text selections to whole blocks"
        checked={!!config.snapToBlock}
        hint="A selection across paragraphs gets one wrapper around the whole paragraphs."
        onChange={(snapToBlock) => update({ snapToBlock })}
      />
    </>
  );
}
