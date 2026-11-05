import type { Snippet, SnippetMode, SnippetParam } from '../../engine';
import { CheckboxField, CodeField, SelectField, TextField } from './fields';

const MODES: { value: SnippetMode; label: string }[] = [
  { value: 'wrap', label: 'Wrap the selection' },
  { value: 'prepend', label: 'Insert before' },
  { value: 'append', label: 'Insert after' },
  { value: 'replace', label: 'Replace the selection' },
  { value: 'attributes', label: 'Add attributes' },
];

const TEMPLATE_HINT = (
  <>
    <code>{'{{content}}'}</code> the selection · <code>{'{{text}}'}</code> its text · <code>{'{{number}}'}</code> ·{' '}
    <code>{'{{params.name}}'}</code> · <code>{'{{#if params.x}}…{{/if}}'}</code>
  </>
);

/** Every editable part of a snippet: name, mode, template, parameters, CSS and JavaScript. */
export function SnippetFields({ snippet, onChange }: { snippet: Snippet; onChange: (patch: Partial<Snippet>) => void }) {
  return (
    <>
      <TextField label="Snippet name" value={snippet.name} onChange={(name) => onChange({ name })} />
      <TextField label="Description" value={snippet.description ?? ''} placeholder="What it does, in a few words" onChange={(description) => onChange({ description })} />
      <SelectField label="What it does" value={snippet.mode} options={MODES} onChange={(mode) => onChange({ mode })} />
      {(snippet.mode === 'prepend' || snippet.mode === 'append') && (
        <CheckboxField
          label={snippet.mode === 'prepend' ? 'Insert inside, as the first child' : 'Insert inside, as the last child'}
          checked={!!snippet.inside}
          onChange={(inside) => onChange({ inside })}
        />
      )}
      <CodeField
        label={snippet.mode === 'attributes' ? 'Attributes' : 'Template'}
        language="html"
        value={snippet.template}
        onChange={(template) => onChange({ template })}
        hint={snippet.mode === 'attributes' ? <>For example <code>{'class="note" title="{{text}}"'}</code></> : TEMPLATE_HINT}
      />
      <ParamsSchemaEditor params={snippet.params} onChange={(params) => onChange({ params })} />
      <CodeField label="CSS" language="css" value={snippet.css ?? ''} onChange={(css) => onChange({ css: css || undefined })} />
      <CodeField
        label="JavaScript"
        language="javascript"
        value={snippet.js ?? ''}
        hint="Runs once in the page (and in the sandboxed preview)."
        onChange={(js) => onChange({ js: js || undefined })}
      />
    </>
  );
}

const TYPES: { value: SnippetParam['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'select', label: 'Choice' },
];

/** Edit the list of parameters a snippet has. Each one becomes a field on Snippet nodes. */
export function ParamsSchemaEditor({ params, onChange }: { params: SnippetParam[]; onChange: (params: SnippetParam[]) => void }) {
  const set = (i: number, patch: Partial<SnippetParam>) => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => {
    let n = params.length + 1;
    while (params.some((p) => p.name === `param${n}`)) n++;
    onChange([...params, { name: `param${n}`, label: `Parameter ${n}`, type: 'text', default: '' }]);
  };
  return (
    <fieldset className="params params-schema">
      <legend>Parameters</legend>
      {params.length === 0 && <p className="muted small">None. Parameters become fields on every node that uses the snippet.</p>}
      {params.map((p, i) => (
        <div className="param-row" key={i} role="group" aria-label={`Parameter ${p.name}`}>
          <div className="param-row-head">
            <code>{`{{params.${p.name}}}`}</code>
            <button type="button" className="link" onClick={() => onChange(params.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <div className="param-grid">
            <TextField label="Name" monospace value={p.name} onChange={(name) => set(i, { name })} />
            <TextField label="Label" value={p.label ?? ''} onChange={(label) => set(i, { label: label || undefined })} />
            <SelectField
              label="Type"
              value={p.type}
              options={TYPES}
              onChange={(type) =>
                set(i, {
                  type,
                  default: type === 'boolean' ? false : type === 'number' ? 0 : type === 'select' ? (p.options?.[0] ?? '') : '',
                  options: type === 'select' ? (p.options?.length ? p.options : ['one', 'two']) : undefined,
                })
              }
            />
            {p.type === 'select' && (
              <TextField
                label="Choices"
                value={(p.options ?? []).join(', ')}
                hint="Separated by commas"
                onChange={(v) => set(i, { options: v.split(',').map((o) => o.trim()).filter(Boolean) })}
              />
            )}
            {p.type === 'boolean' ? (
              <CheckboxField label="On by default" checked={p.default === true} onChange={(d) => set(i, { default: d })} />
            ) : p.type === 'select' ? (
              <SelectField
                label="Default"
                value={String(p.default ?? p.options?.[0] ?? '')}
                options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                onChange={(d) => set(i, { default: d })}
              />
            ) : (
              <TextField
                label="Default"
                value={String(p.default ?? '')}
                onChange={(d) => set(i, { default: p.type === 'number' ? Number(d) || 0 : d })}
              />
            )}
          </div>
        </div>
      ))}
      <button type="button" onClick={add}>
        Add parameter
      </button>
    </fieldset>
  );
}

/** The form for parameter values, generated from a snippet's parameters. */
export function ParamValues({
  params,
  values,
  onChange,
}: {
  params: SnippetParam[];
  values?: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}) {
  if (params.length === 0) return null;
  return (
    <fieldset className="params">
      <legend>Settings</legend>
      {params.map((p) => {
        const value = values?.[p.name] ?? p.default;
        const label = p.label ?? p.name;
        if (p.type === 'select')
          return (
            <SelectField
              key={p.name}
              label={label}
              value={String(value ?? p.options?.[0] ?? '')}
              options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
              onChange={(v) => onChange(p.name, v)}
            />
          );
        if (p.type === 'boolean') return <CheckboxField key={p.name} label={label} checked={value === true} onChange={(v) => onChange(p.name, v)} />;
        return (
          <TextField
            key={p.name}
            label={label}
            value={String(value ?? '')}
            onChange={(v) => onChange(p.name, p.type === 'number' ? Number(v) : v)}
          />
        );
      })}
    </fieldset>
  );
}
