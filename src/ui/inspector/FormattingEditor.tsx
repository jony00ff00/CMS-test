import { useMemo } from 'react';
import {
  analyseFormats, DEFAULT_INLINE, INLINE_LABELS, TARGET_LABELS, type CmsDocument, type FormatTarget, type FormattingConfig, type GraphNode, type InlineFormat,
} from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, SelectField, TextField } from './fields';

const TARGETS = Object.keys(TARGET_LABELS) as FormatTarget[];

/** The Formatting node: what each format found in the Word file becomes, and the house rules for the rest. */
export function FormattingEditor({ node }: { node: GraphNode }) {
  const config = node.config as FormattingConfig;
  const update = (patch: Partial<FormattingConfig>) => editorStore.getState().updateConfig<FormattingConfig>(node.id, (c) => ({ ...c, ...patch }));
  const input = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id && e.targetPort === 'document');
    const r = edge ? s.results[edge.source] : undefined;
    return r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as CmsDocument | undefined) : undefined;
  });
  const rows = useMemo(() => (input ? analyseFormats(input) : []), [input]);
  const inline = new Set(config.inline ?? DEFAULT_INLINE);
  const author = config.author ?? { id: 'house-style', name: 'House style' };

  if (!input) return <p className="hint warn-text">Connect a Word file read in review mode (or a Changes node after it).</p>;
  if (!rows.length) {
    return <p className="hint warn-text">No formats from Word found. In the Document Source, turn on “Keep tracked changes and comments (review mode)”.</p>;
  }
  return (
    <>
      <p className="muted small">
        Each row is a format found in the Word file: the kind of paragraph, its style and the formatting on most of its
        text. Choose what it becomes; rows you leave get the suggestion.
      </p>
      <ul className="format-list" aria-label="Formats found">
        {rows.map((row) => {
          const chosen = config.targets?.[row.key];
          return (
            <li key={row.key} className={`format-row${chosen ? ' is-chosen' : ''}`}>
              <div>
                <strong>{row.label}</strong> <span className="muted">× {row.count}</span>
              </div>
              {row.sample && <div className="change-text muted">“{row.sample}”</div>}
              <select
                aria-label={`Becomes: ${row.label}`}
                value={chosen ?? ''}
                onChange={(e) => {
                  const targets = { ...config.targets };
                  if (e.target.value) targets[row.key] = e.target.value as FormatTarget;
                  else delete targets[row.key];
                  update({ targets });
                }}
              >
                <option value="">Suggested: {TARGET_LABELS[row.suggested].toLowerCase()}</option>
                {TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <fieldset>
        <legend>Inline formatting to keep</legend>
        <p className="hint">Links are always kept. Fonts, sizes and colours always go, and headings are plain.</p>
        {(Object.keys(INLINE_LABELS) as InlineFormat[]).map((f) => (
          <CheckboxField
            key={f}
            label={INLINE_LABELS[f]}
            checked={inline.has(f)}
            onChange={(on) => update({ inline: (Object.keys(INLINE_LABELS) as InlineFormat[]).filter((x) => (x === f ? on : inline.has(x))) })}
          />
        ))}
      </fieldset>
      <CheckboxField
        label="Bold first rows become table headers"
        checked={config.tableHeaders !== false}
        onChange={(on) => update({ tableHeaders: on ? undefined : false })}
      />
      <CheckboxField label="Join lists of the same type next to each other" checked={config.mergeLists !== false} onChange={(on) => update({ mergeLists: on ? undefined : false })} />
      <CheckboxField
        label="Number every paragraph"
        checked={!!config.numberParagraphs}
        hint="Every paragraph and list item becomes a numbered item, in one running sequence through the document; headings, tables and quotes are not numbered."
        onChange={(on) => update({ numberParagraphs: on || undefined })}
      />
      <fieldset>
        <legend>Review</legend>
        <SelectField
          label="Label what changed with comments"
          value={config.labels ?? 'paragraph'}
          options={[
            { value: 'paragraph', label: 'One comment per changed paragraph' },
            { value: 'rule', label: 'One comment per format (at its first paragraph)' },
            { value: 'none', label: 'No comments' },
          ]}
          hint="Numbers typed by hand become tracked deletions in any case, so reviewers can accept them."
          onChange={(labels) => update({ labels: labels === 'paragraph' ? undefined : labels })}
        />
        <TextField label="Labels are by (name)" value={author.name} onChange={(name) => update({ author: { ...author, name: name || 'House style' } })} />
        <TextField label="User id in the editor" value={author.id} monospace onChange={(id) => update({ author: { ...author, id: id.trim() || 'house-style' } })} />
      </fieldset>
    </>
  );
}
