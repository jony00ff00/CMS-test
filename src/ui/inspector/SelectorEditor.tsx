import { useId, type ReactNode } from 'react';
import type { Anchor, CmsDocument, GraphNode, ResolveStatus, Selection, SelectorConfig, SelectorMode } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { CheckboxField, SelectField, TextField } from './fields';

export const SELECTOR_MODES: { value: SelectorMode; label: string }[] = [
  { value: 'css', label: 'CSS selector' },
  { value: 'regex', label: 'Text pattern (regex)' },
  { value: 'heading', label: 'Section under a heading' },
  { value: 'jsonField', label: 'JSON field' },
  { value: 'manual', label: 'Selected by hand' },
  { value: 'all', label: 'Everything (select all)' },
];

const DEFAULTS: Record<SelectorMode, SelectorConfig> = {
  css: { mode: 'css', selector: 'h2' },
  regex: { mode: 'regex', pattern: '', flags: 'i', scope: 'match' },
  heading: { mode: 'heading', text: '', match: 'contains', includeHeading: true },
  jsonField: { mode: 'jsonField', path: '$.' },
  manual: { mode: 'manual', anchors: [] },
  all: { mode: 'all', scope: 'document' },
};

/** The document coming into a node, e.g. for JSON field path suggestions. */
export function useInputDocument(nodeId: string, port = 'document') {
  return useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === nodeId && e.targetPort === port);
    return edge ? (s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined) : undefined;
  });
}

export function SelectorEditor({ node }: { node: GraphNode }) {
  const config = node.config as SelectorConfig;
  const input = useInputDocument(node.id);
  return (
    <SelectorFields
      config={config}
      input={input}
      onChange={(next) => editorStore.getState().updateConfig(node.id, next)}
      manual={(c, patch) => <ManualSelections node={node} config={c} onChange={(anchors) => patch({ anchors })} />}
    />
  );
}

/** The fields for every selector mode. `manual` renders the hand-made selections (left out where they make no sense). */
export function SelectorFields({
  config,
  input,
  onChange,
  manual,
  modes = SELECTOR_MODES,
}: {
  config: SelectorConfig;
  input?: CmsDocument;
  onChange: (next: SelectorConfig) => void;
  manual?: (config: Extract<SelectorConfig, { mode: 'manual' }>, patch: (p: Partial<SelectorConfig>) => void) => ReactNode;
  modes?: { value: SelectorMode; label: string }[];
}) {
  const listId = useId();
  const set = onChange;
  const patch = (p: Partial<SelectorConfig>) => set({ ...config, ...p } as SelectorConfig);

  return (
    <>
      <SelectField
        label="Select by"
        value={config.mode}
        options={modes}
        onChange={(mode) => set(mode === config.mode ? config : DEFAULTS[mode])}
      />
      {config.mode === 'all' && (
        <SelectField
          label="As"
          value={config.scope ?? 'document'}
          options={[
            { value: 'document', label: 'One selection: the whole document' },
            { value: 'blocks', label: 'Each block on its own (paragraphs, headings, …)' },
          ]}
          onChange={(scope) => patch({ scope })}
        />
      )}
      {config.mode === 'css' && (
        <TextField
          label="CSS selector"
          monospace
          value={config.selector}
          placeholder="h2, .note, table td:first-child"
          onChange={(selector) => patch({ selector })}
        />
      )}
      {config.mode === 'regex' && (
        <>
          <TextField label="Pattern" monospace value={config.pattern} placeholder="plan \w+" onChange={(pattern) => patch({ pattern })} hint="A JavaScript regular expression. Blocks are separated by a line break (\n)." />
          <CheckboxField label="Ignore case" checked={(config.flags ?? '').includes('i')} onChange={(on) => patch({ flags: on ? 'i' : '' })} />
          <SelectField
            label="Select"
            value={config.scope ?? 'match'}
            options={[
              { value: 'match', label: 'Only the matched text' },
              { value: 'block', label: 'The whole paragraph, list item, …' },
            ]}
            onChange={(scope) => patch({ scope })}
          />
        </>
      )}
      {config.mode === 'heading' && (
        <>
          <TextField label="Heading text" value={config.text} placeholder="Pricing" onChange={(text) => patch({ text })} />
          <SelectField
            label="Match"
            value={config.match ?? 'contains'}
            options={[
              { value: 'contains', label: 'Heading contains the text' },
              { value: 'exact', label: 'Heading is exactly the text' },
            ]}
            onChange={(match) => patch({ match })}
          />
          <SelectField
            label="Heading level"
            value={String(config.level ?? '')}
            options={[{ value: '', label: 'Any' }, ...[1, 2, 3, 4, 5, 6].map((l) => ({ value: String(l), label: `h${l}` }))]}
            onChange={(v) => patch({ level: v ? Number(v) : undefined })}
          />
          <CheckboxField label="Include the heading itself" checked={config.includeHeading ?? true} onChange={(includeHeading) => patch({ includeHeading })} />
        </>
      )}
      {config.mode === 'jsonField' && (
        <>
          <TextField
            label="JSONPath"
            monospace
            list={listId}
            value={config.path}
            placeholder="$.faq[*].a"
            hint={input?.meta.json ? 'Wildcards ([*], ..) and filters ([?(@.type===\'note\')]) work.' : 'Connect a JSON Document Source to get suggestions.'}
            onChange={(path) => patch({ path })}
          />
          <datalist id={listId}>
            {[...new Set((input?.meta.json?.fields ?? []).flatMap((f) => [f.path, f.path.replace(/\[\d+\]/g, '[*]')]))].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </>
      )}
      {config.mode === 'manual' && manual?.(config, patch)}
    </>
  );
}

const STATUS_TEXT: Record<ResolveStatus, string> = {
  exact: 'Found',
  moved: 'Moved',
  fuzzy: 'Changed a little',
  failed: 'Needs attention',
};

function ManualSelections({
  node,
  config,
  onChange,
}: {
  node: GraphNode;
  config: Extract<SelectorConfig, { mode: 'manual' }>;
  onChange: (anchors: Anchor[]) => void;
}) {
  const selection = useEditor((s) => s.results[node.id]?.outputs.selection as Selection | undefined);
  const statusOf = (a: Anchor) => {
    const m = selection?.matches.find((x) => x.anchorId === a.id);
    return m ? { status: m.status ?? 'exact', confidence: m.confidence } : selection ? { status: 'failed' as const } : undefined;
  };
  return (
    <div className="field">
      <span className="field-label">Saved selections</span>
      {config.anchors.length === 0 ? (
        <p className="muted">None yet. Select text in the preview, then choose “Add to {nodeLabel(node)}”.</p>
      ) : (
        <ol className="anchors" aria-label="Saved selections">
          {config.anchors.map((a) => {
            const st = statusOf(a);
            return (
              <li key={a.id}>
                <span className="anchor-quote" title={a.textQuote?.exact}>
                  “{shorten(a.textQuote?.exact ?? '')}”
                  <span className="muted small"> {a.target === 'nodes' ? `whole ${a.structural?.tagName ?? 'block'}` : 'text'}</span>
                </span>
                {st && (
                  <span className={`status-pill status-${st.status === 'failed' ? 'error' : st.status === 'fuzzy' ? 'blocked' : 'ok'}`}>
                    {STATUS_TEXT[st.status]}
                    {st.status === 'fuzzy' && st.confidence ? ` ${Math.round(st.confidence * 100)}%` : ''}
                  </span>
                )}
                <button type="button" className="link" aria-label={`Remove “${shorten(a.textQuote?.exact ?? '')}”`} onClick={() => onChange(config.anchors.filter((x) => x.id !== a.id))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="hint">Saved selections follow the text when the document changes. Ones marked “Needs attention” were not found.</p>
    </div>
  );
}

const shorten = (s: string) => (s.length > 50 ? `${s.slice(0, 49)}…` : s).replace(/\n/g, ' ');
