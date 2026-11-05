import { DEFAULT_SNIPPET, type GraphNode, type Snippet, type SnippetMode, type SnippetNodeConfig } from '../../engine';
import { editorStore } from '../../store/editor-store';
import { CheckboxField, SelectField, TextAreaField, TextField } from './fields';

const MODES: { value: SnippetMode; label: string }[] = [
  { value: 'wrap', label: 'Wrap the selection' },
  { value: 'prepend', label: 'Insert before' },
  { value: 'append', label: 'Insert after' },
  { value: 'replace', label: 'Replace the selection' },
  { value: 'attributes', label: 'Add attributes' },
];

export function SnippetEditor({ node }: { node: GraphNode }) {
  const config = node.config as SnippetNodeConfig;
  const { snippet } = config;
  const update = (patch: Partial<SnippetNodeConfig>) =>
    editorStore.getState().updateConfig<SnippetNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const editSnippet = (patch: Partial<Snippet>) => update({ snippet: { ...snippet, ...patch } });
  const setParam = (name: string, value: unknown) => update({ params: { ...config.params, [name]: value } });

  return (
    <>
      <TextField label="Snippet name" value={snippet.name} onChange={(name) => editSnippet({ name })} />
      <SelectField label="What it does" value={snippet.mode} options={MODES} onChange={(mode) => editSnippet({ mode })} />
      {(snippet.mode === 'prepend' || snippet.mode === 'append') && (
        <CheckboxField
          label={snippet.mode === 'prepend' ? 'Insert inside, as the first child' : 'Insert inside, as the last child'}
          checked={!!snippet.inside}
          onChange={(inside) => editSnippet({ inside })}
        />
      )}
      <TextAreaField
        label={snippet.mode === 'attributes' ? 'Attributes' : 'Template'}
        rows={snippet.mode === 'attributes' ? 2 : 5}
        value={snippet.template}
        onChange={(template) => editSnippet({ template })}
        hint={
          <>
            <code>{'{{content}}'}</code> the selection · <code>{'{{text}}'}</code> its text · <code>{'{{number}}'}</code> ·{' '}
            <code>{'{{params.name}}'}</code>
          </>
        }
      />
      {snippet.params.length > 0 && (
        <fieldset className="params">
          <legend>Parameters</legend>
          {snippet.params.map((p) => {
            const value = config.params?.[p.name] ?? p.default;
            const label = p.label ?? p.name;
            if (p.type === 'select')
              return (
                <SelectField
                  key={p.name}
                  label={label}
                  value={String(value ?? p.options?.[0] ?? '')}
                  options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => setParam(p.name, v)}
                />
              );
            if (p.type === 'boolean') return <CheckboxField key={p.name} label={label} checked={value === true} onChange={(v) => setParam(p.name, v)} />;
            return <TextField key={p.name} label={label} value={String(value ?? '')} onChange={(v) => setParam(p.name, p.type === 'number' ? Number(v) : v)} />;
          })}
        </fieldset>
      )}
      <CheckboxField
        label="Snap text selections to whole blocks"
        checked={!!config.snapToBlock}
        hint="A selection across paragraphs gets one wrapper around the whole paragraphs."
        onChange={(snapToBlock) => update({ snapToBlock })}
      />
      <details className="advanced">
        <summary>CSS and JavaScript</summary>
        <TextAreaField label="CSS" rows={4} value={snippet.css ?? ''} onChange={(css) => editSnippet({ css: css || undefined })} />
        <TextAreaField
          label="JavaScript"
          rows={3}
          value={snippet.js ?? ''}
          hint="Runs in the exported page and in the sandboxed preview."
          onChange={(js) => editSnippet({ js: js || undefined })}
        />
      </details>
      <button type="button" className="ghost" onClick={() => update({ snippet: structuredClone(DEFAULT_SNIPPET), params: undefined })}>
        Reset to the Callout snippet
      </button>
    </>
  );
}
