import { useMemo, useState, type ChangeEvent } from 'react';
import {
  ACCEPTED_EXTENSIONS, defaultJsonMapping, detectFormat, discoverPaths, parseJson, queryJsonPaths, type DocumentSourceConfig,
  type GraphNode, type JsonFieldFormat, type JsonFieldMapping, type JsonMapping, type StoredFile,
} from '../../engine';
import { sampleHtml, sampleJson } from '../../samples';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, SelectField, TextAreaField } from './fields';

const FORMATS: { value: JsonFieldFormat; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'html', label: 'HTML' },
  { value: 'markdown', label: 'Markdown' },
];

export function SourceEditor({ node }: { node: GraphNode }) {
  const config = node.config as DocumentSourceConfig;
  const file = useEditor((s) => (config.fileId ? s.files[config.fileId] : undefined));
  const update = (patch: Partial<DocumentSourceConfig>) =>
    editorStore.getState().updateConfig<DocumentSourceConfig>(node.id, (c) => ({ ...c, ...patch }));

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    const format = detectFormat(chosen.name);
    if (!format) {
      editorStore.getState().notify('error', `${chosen.name}: use one of ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }
    const data = format === 'docx' || format === 'pptx' ? new Uint8Array(await chosen.arrayBuffer()) : await chosen.text();
    editorStore.getState().chooseFile(node.id, chosen.name, data);
  };

  const format = file && detectFormat(file.name);
  return (
    <>
      <div className="field">
        <span className="field-label">File</span>
        <div className="file-row">
          <label className="button">
            {file ? 'Choose another file…' : 'Choose a file…'}
            <input type="file" aria-label="File" className="visually-hidden" accept={ACCEPTED_EXTENSIONS.join(',')} onChange={onFile} />
          </label>
          <span className={file ? 'file-name' : 'muted'}>{file ? file.name : 'No file yet'}</span>
        </div>
        <p className="hint">
          {ACCEPTED_EXTENSIONS.filter((e) => e !== '.htm' && e !== '.xhtml').join(', ')}. Or use a sample:{' '}
          <button type="button" className="link" onClick={() => editorStore.getState().chooseFile(node.id, 'example.html', sampleHtml())}>
            HTML
          </button>{' '}
          ·{' '}
          <button type="button" className="link" onClick={() => editorStore.getState().chooseFile(node.id, 'example.json', sampleJson())}>
            JSON
          </button>
        </p>
      </div>
      {format === 'json' && file && <JsonMappingEditor file={file} mapping={config.json} onChange={(json) => update({ json })} />}
      {format === 'docx' && (
        <TextAreaField
          label="Word style rules"
          rows={3}
          value={(config.docx?.styleMap ?? []).join('\n')}
          placeholder="p[style-name='Note'] => aside.note:fresh"
          hint="One mammoth style-map rule per line. These win over the built-in rules."
          onChange={(v) => update({ docx: { styleMap: v.split('\n').filter((l) => l.trim()) } })}
        />
      )}
    </>
  );
}

function JsonMappingEditor({ file, mapping, onChange }: { file: StoredFile; mapping?: JsonMapping; onChange: (m: JsonMapping) => void }) {
  const parsed = useMemo(() => {
    try {
      const text = typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data);
      return { data: parseJson(text.replace(/^﻿/, ''), file.name) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [file]);
  const [custom, setCustom] = useState('');

  if ('error' in parsed) return <p className="error-text">{parsed.error}</p>;
  const discovered = discoverPaths(parsed.data);
  const current = mapping ?? defaultJsonMapping(parsed.data);
  const fields = current.fields ?? [];
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const known = new Set(discovered.map((d) => d.path));
  const customFields = fields.filter((f) => !known.has(f.path));
  // Fields that a wildcard or filter path already includes.
  const coveredBy = new Map<string, JsonFieldMapping>();
  for (const f of customFields) {
    const q = queryJsonPaths(parsed.data, f.path);
    if ('matches' in q) for (const m of q.matches) if (!coveredBy.has(m.path)) coveredBy.set(m.path, f);
  }

  const setFields = (next: JsonFieldMapping[]) => onChange({ ...current, mode: 'fields', fields: next });
  const toggle = (path: string, on: boolean, format: JsonFieldFormat) => {
    if (on) {
      // Keep file order for discovered fields, custom paths stay at the end.
      const order = discovered.map((d) => d.path);
      const next = [...fields.filter((f) => f.path !== path), { path, format }];
      setFields(next.sort((a, b) => rank(order, a.path) - rank(order, b.path)));
    } else setFields(fields.filter((f) => f.path !== path));
  };
  const setFormat = (path: string, format: JsonFieldFormat) => setFields(fields.map((f) => (f.path === path ? { ...f, format } : f)));

  return (
    <div className="json-mapping">
      <SelectField
        label="JSON content"
        value={current.mode}
        options={[
          { value: 'fields', label: 'Pick fields' },
          { value: 'template', label: 'Template' },
        ]}
        onChange={(mode) => onChange({ ...current, mode, template: current.template ?? defaultTemplate(parsed.data) })}
      />
      {current.mode === 'template' ? (
        <TextAreaField
          label="Template"
          rows={8}
          value={current.template ?? ''}
          hint={
            <>
              Handlebars. <code>{'{{title}}'}</code> inserts escaped text, <code>{'{{{body}}}'}</code> inserts HTML,{' '}
              <code>{'{{markdown a}}'}</code> converts Markdown.
            </>
          }
          onChange={(template) => onChange({ ...current, template })}
        />
      ) : (
        <>
          <div className="json-fields-head">
            <span>
              Fields: {discovered.filter((d) => byPath.has(d.path) || coveredBy.has(d.path)).length} of {discovered.length} included
            </span>
            <button
              type="button"
              className="link"
              onClick={() => setFields(discovered.map((d) => ({ path: d.path, format: d.suggestedFormat })).concat(customFields))}
            >
              All, suggested formats
            </button>
            <button type="button" className="link" onClick={() => setFields(customFields)}>
              None
            </button>
          </div>
          <ul className="json-fields" aria-label="JSON fields">
            {discovered.map((d) => {
              const f = byPath.get(d.path);
              const via = f ? undefined : coveredBy.get(d.path);
              return (
                <li key={d.path} className={f || via ? 'on' : undefined}>
                  <label title={via ? `Included by ${via.path}` : d.preview}>
                    <input
                      type="checkbox"
                      checked={!!(f || via)}
                      disabled={!!via}
                      onChange={(e) => toggle(d.path, e.target.checked, d.suggestedFormat)}
                    />
                    <code>{d.path}</code>
                    <span className="preview">{via ? `via ${via.path}` : d.preview}</span>
                  </label>
                  <select
                    aria-label={`Format of ${d.path}`}
                    value={f?.format ?? via?.format ?? d.suggestedFormat}
                    disabled={!f}
                    onChange={(e) => setFormat(d.path, e.target.value as JsonFieldFormat)}
                  >
                    {FORMATS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
            {customFields.map((f) => (
              <li key={f.path} className="on custom">
                <span>
                  <code>{f.path}</code>
                </span>
                <select aria-label={`Format of ${f.path}`} value={f.format} onChange={(e) => setFormat(f.path, e.target.value as JsonFieldFormat)}>
                  {FORMATS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="link" aria-label={`Remove ${f.path}`} onClick={() => toggle(f.path, false, f.format)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!custom.trim() || byPath.has(custom.trim())) return;
              setFields([...fields, { path: custom.trim(), format: 'text' }]);
              setCustom('');
            }}
          >
            <input
              aria-label="JSONPath to add"
              className="mono"
              placeholder="$.items[*].text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button type="submit">Add path</button>
          </form>
          {byPath.has('$.title') && (
          <CheckboxField
            label="Show the title as a heading"
            checked={byPath.get('$.title')?.blockTag === 'h1'}
            hint="Puts $.title in an <h1> instead of a <div>."
            onChange={(on) => setFields(fields.map((f) => (f.path === '$.title' ? { ...f, blockTag: on ? 'h1' : undefined } : f)))}
          />
          )}
        </>
      )}
    </div>
  );
}

const rank = (order: string[], path: string) => {
  const i = order.indexOf(path);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

function defaultTemplate(data: unknown): string {
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  return keys.includes('title') ? '<h1>{{title}}</h1>\n' : '<pre>{{json this}}</pre>\n';
}
