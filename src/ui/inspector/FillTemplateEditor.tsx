import type { ReactNode } from 'react';
import {
  isRepeatRow, suggestFillRows, type CmsDocument, type FillReport, type FillRepeatRow, type FillRow, type FillSlotRow, type FillTemplateNodeConfig,
  type GraphNode, type SelectorConfig,
} from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { useInputDocument } from './SelectorEditor';
import { CheckboxField } from './fields';

/** The selector modes a row's content can come from. */
type SourceMode = 'css' | 'heading' | 'regex' | 'all';
const SOURCE_MODES: { value: SourceMode; label: string }[] = [
  { value: 'css', label: 'CSS (e.g. a Word style’s class)' },
  { value: 'heading', label: 'Heading section' },
  { value: 'regex', label: 'Text pattern' },
  { value: 'all', label: 'Everything' },
];

let rowCounter = 0;
const newId = (rows: FillRow[]) => {
  const used = new Set(rows.flatMap((r) => [r.id, ...(isRepeatRow(r) ? r.rows.map((x) => x.id) : [])]));
  let id: string;
  do id = `row-${++rowCounter}`;
  while (used.has(id));
  return id;
};

/** Rows: a slot in the template and where its content comes from; repeat rows copy a template element per item. */
export function FillTemplateEditor({ node }: { node: GraphNode }) {
  const config = node.config as FillTemplateNodeConfig;
  const rows = config.rows ?? [];
  const template = useInputDocument(node.id, 'template');
  const content = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id && e.targetPort === 'content');
    const value = edge ? s.results[edge.source]?.outputs[edge.sourcePort] : undefined;
    // A selection's document stands in for the content when suggesting rows.
    return (value as { kind?: string; document?: CmsDocument } | undefined)?.kind === 'selection' ? (value as { document: CmsDocument }).document : (value as CmsDocument | undefined);
  });
  const report = useEditor((s) => s.results[node.id]?.outputs.report as FillReport[] | undefined);
  const setRows = (next: FillRow[] | ((rows: FillRow[]) => FillRow[])) =>
    editorStore.getState().updateConfig<FillTemplateNodeConfig>(node.id, (c) => ({ ...c, rows: typeof next === 'function' ? next(c.rows ?? []) : next }));
  const suggestions = template && content && typeof content === 'object' && 'tree' in content ? suggestFillRows(template, content, rows) : [];

  return (
    <>
      <p className="muted small">
        Each row fills a slot in the <strong>Template</strong> (CSS) with content from the <strong>Content</strong>. A
        repeat row makes one copy of a template element per item of the content (e.g. a step card per “Step”
        heading), so the page follows the text when steps are added or removed.
      </p>
      {(!template || !content) && (
        <p className="hint warn-text">
          Connect {!template ? <strong>Template</strong> : null}
          {!template && !content ? ' and ' : null}
          {!content ? <strong>Content</strong> : null}: the page’s code and the document with the text.
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          disabled={!suggestions.length}
          title={
            suggestions.length
              ? `Add ${suggestions.length} row${suggestions.length === 1 ? '' : 's'}: ${suggestions.map((r) => `${r.slot} ← ${(r.from as { selector: string }).selector}`).join(', ')}`
              : 'No template class matches a class in the content (e.g. gs-kicker ← kicker), or they are all used'
          }
          onClick={() => setRows((rs) => [...rs, ...suggestions.map((r) => ({ ...r, id: newId(rs) }))])}
        >
          Match by name{suggestions.length ? ` (${suggestions.length})` : ''}
        </button>
        <button type="button" onClick={() => setRows((rs) => [...rs, { id: newId(rs), slot: '', from: { mode: 'css', selector: '' } }])}>
          Add slot
        </button>
        <button
          type="button"
          onClick={() =>
            setRows((rs) => [...rs, { id: newId(rs), repeat: '', items: { mode: 'heading', text: '', includeHeading: true }, rows: [] }])
          }
        >
          Add repeat
        </button>
      </div>
      <ol className="fill-rows" aria-label="Rows">
        {rows.map((row, i) => (
          <li key={row.id}>
            <RowControls
              index={i}
              count={rows.length}
              label={isRepeatRow(row) ? 'repeat' : 'slot'}
              onMove={(d) => setRows((rs) => move(rs, i, d))}
              onRemove={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
            />
            {isRepeatRow(row) ? (
              <RepeatRowFields row={row} report={report?.[i]} onChange={(r) => setRows((rs) => rs.map((x) => (x.id === row.id ? r : x)))} />
            ) : (
              <SlotRowFields row={row} report={report?.[i]} onChange={(r) => setRows((rs) => rs.map((x) => (x.id === row.id ? r : x)))} />
            )}
          </li>
        ))}
      </ol>
      <CheckboxField
        label="Bring the content’s styles"
        checked={!!config.styles}
        hint="Off: the template’s own CSS decides the look."
        onChange={(styles) => editorStore.getState().updateConfig<FillTemplateNodeConfig>(node.id, (c) => ({ ...c, styles: styles || undefined }))}
      />
    </>
  );
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function RowControls({ index, count, label, onMove, onRemove }: { index: number; count: number; label: string; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="fill-row-head">
      <span className="field-label">
        {index + 1}. {label === 'repeat' ? 'Repeat' : 'Slot'}
      </span>
      <span className="fill-row-actions">
        <button type="button" className="ghost small-button" aria-label={`Move row ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="ghost small-button" aria-label={`Move row ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="ghost small-button danger" aria-label={`Remove row ${index + 1}`} onClick={onRemove}>
          ×
        </button>
      </span>
    </div>
  );
}

/** A small labelled input inside a row. */
function Inline({ label, children }: { label: string; children: () => ReactNode }) {
  return (
    <label className="fill-inline">
      <span>{label}</span>
      {children()}
    </label>
  );
}

function SlotRowFields({ row, report, onChange, inRepeat }: { row: FillSlotRow; report?: FillReport; onChange: (row: FillSlotRow) => void; inRepeat?: boolean }) {
  return (
    <div className="fill-row">
      <Inline label={inRepeat ? 'Slot in each copy' : 'Slot in the template'}>
        {() => (
          <input type="text" className="mono" spellCheck={false} placeholder=".kicker" value={row.slot} onChange={(e) => onChange({ ...row, slot: e.target.value })} />
        )}
      </Inline>
      <SourceFields label={inRepeat ? 'From each item' : 'From the content'} value={row.from} onChange={(from) => onChange({ ...row, from })} />
      <div className="fill-row-options">
        <label className="fill-check">
          <input type="checkbox" checked={row.target === 'element'} onChange={(e) => onChange({ ...row, target: e.target.checked ? 'element' : undefined })} />
          Replace the slot element itself
        </label>
        <label className="fill-check">
          <input type="checkbox" checked={!!row.required} onChange={(e) => onChange({ ...row, required: e.target.checked || undefined })} />
          Required
        </label>
      </div>
      <RowStatus report={report} noun="slot" />
    </div>
  );
}

function RepeatRowFields({ row, report, onChange }: { row: FillRepeatRow; report?: FillReport; onChange: (row: FillRepeatRow) => void }) {
  const setInner = (rows: FillSlotRow[]) => onChange({ ...row, rows });
  const inner = row.rows.filter((r): r is FillSlotRow => !isRepeatRow(r));
  const num = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Math.max(0, Math.round(Number(v))));
  return (
    <div className="fill-row fill-repeat">
      <Inline label="Template element to repeat">
        {() => (
          <input type="text" className="mono" spellCheck={false} placeholder=".step" value={row.repeat} onChange={(e) => onChange({ ...row, repeat: e.target.value })} />
        )}
      </Inline>
      <SourceFields label="One copy per" value={row.items} onChange={(items) => onChange({ ...row, items })} />
      <div className="fill-row-options">
        <Inline label="At least">
          {() => <input type="number" min={0} className="fill-count" value={row.min ?? ''} onChange={(e) => onChange({ ...row, min: num(e.target.value) })} />}
        </Inline>
        <Inline label="At most">
          {() => <input type="number" min={0} className="fill-count" value={row.max ?? ''} onChange={(e) => onChange({ ...row, max: num(e.target.value) })} />}
        </Inline>
      </div>
      <RowStatus report={report} noun="template element" items />
      <div className="fill-inner">
        <span className="field-label">In each copy</span>
        {inner.map((r, j) => (
          <div key={r.id} className="fill-inner-row">
            <RowControls
              index={j}
              count={inner.length}
              label="slot"
              onMove={(d) => setInner(move(inner, j, d))}
              onRemove={() => setInner(inner.filter((x) => x.id !== r.id))}
            />
            <SlotRowFields row={r} inRepeat report={report?.rows?.[j]} onChange={(x) => setInner(inner.map((y) => (y.id === r.id ? x : y)))} />
          </div>
        ))}
        <button
          type="button"
          className="ghost"
          onClick={() => setInner([...inner, { id: `${row.id}-${inner.length + 1}-${Date.now().toString(36)}`, slot: '', from: { mode: 'all', scope: 'document' } }])}
        >
          Add a slot in each copy
        </button>
      </div>
    </div>
  );
}

/** Where content comes from: a few Selector modes in one line. */
export function SourceFields({ label, value, onChange }: { label: string; value: SelectorConfig; onChange: (v: SelectorConfig) => void }) {
  const mode = (SOURCE_MODES.some((m) => m.value === value.mode) ? value.mode : 'css') as SourceMode;
  const setMode = (m: SourceMode) =>
    onChange(
      m === 'css' ? { mode: 'css', selector: '' } : m === 'heading' ? { mode: 'heading', text: '', includeHeading: true } : m === 'regex' ? { mode: 'regex', pattern: '', flags: 'i', scope: 'block' } : { mode: 'all', scope: 'document' },
    );
  return (
    <div className="fill-source">
      <Inline label={label}>
        {() => (
          <select value={mode} onChange={(e) => setMode(e.target.value as SourceMode)}>
            {SOURCE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </Inline>
      {value.mode === 'css' && (
        <input type="text" className="mono" aria-label={`${label}: CSS`} spellCheck={false} placeholder=".title" value={value.selector} onChange={(e) => onChange({ ...value, selector: e.target.value })} />
      )}
      {value.mode === 'heading' && (
        <>
          <input type="text" aria-label={`${label}: heading text`} placeholder="Heading contains…" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          <label className="fill-check">
            <input type="checkbox" checked={value.includeHeading ?? true} onChange={(e) => onChange({ ...value, includeHeading: e.target.checked })} />
            With the heading
          </label>
        </>
      )}
      {value.mode === 'regex' && (
        <input type="text" className="mono" aria-label={`${label}: pattern`} spellCheck={false} placeholder="Pattern" value={value.pattern} onChange={(e) => onChange({ ...value, pattern: e.target.value })} />
      )}
    </div>
  );
}

function RowStatus({ report, noun, items }: { report?: FillReport; noun: string; items?: boolean }) {
  if (!report) return null;
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  const text = items ? `${n(report.matches, 'item')} · ${n(report.slots, noun)} in the template` : `${n(report.slots, noun)} · ${n(report.matches, 'match')}${report.filled ? ' · filled' : ''}`;
  return (
    <p className={`hint fill-status${report.problem ? ' is-problem' : report.warning ? ' warn-text' : ''}`} role="status">
      {text}
      {(report.problem ?? report.warning) && <> — {report.problem ?? report.warning}</>}
    </p>
  );
}
