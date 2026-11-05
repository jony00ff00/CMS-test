import { useId } from 'react';
import type { CmsDocument, GraphNode, SelectorConfig, SelectorMode } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, SelectField, TextField } from './fields';

const MODES: { value: SelectorMode; label: string }[] = [
  { value: 'css', label: 'CSS selector' },
  { value: 'regex', label: 'Text pattern (regex)' },
  { value: 'heading', label: 'Section under a heading' },
  { value: 'jsonField', label: 'JSON field' },
  { value: 'manual', label: 'Selected by hand' },
];

const DEFAULTS: Record<SelectorMode, SelectorConfig> = {
  css: { mode: 'css', selector: 'h2' },
  regex: { mode: 'regex', pattern: '', flags: 'i', scope: 'match' },
  heading: { mode: 'heading', text: '', match: 'contains', includeHeading: true },
  jsonField: { mode: 'jsonField', path: '$.' },
  manual: { mode: 'manual', anchors: [] },
};

export function SelectorEditor({ node }: { node: GraphNode }) {
  const config = node.config as SelectorConfig;
  const listId = useId();
  // The document coming in, for suggestions (JSON field paths).
  const input = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id);
    return edge ? (s.results[edge.source]?.outputs[edge.sourcePort] as CmsDocument | undefined) : undefined;
  });
  const set = (next: SelectorConfig) => editorStore.getState().updateConfig(node.id, next);
  const patch = (p: Partial<SelectorConfig>) => set({ ...config, ...p } as SelectorConfig);

  return (
    <>
      <SelectField
        label="Select by"
        value={config.mode}
        options={MODES}
        onChange={(mode) => set(mode === config.mode ? config : DEFAULTS[mode])}
      />
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
      {config.mode === 'manual' && (
        <div className="field">
          <p className="muted">
            {config.anchors.length
              ? `${config.anchors.length} saved selection${config.anchors.length === 1 ? '' : 's'}.`
              : 'No saved selections yet.'}{' '}
            Selecting text in the preview comes in the next version (M6).
          </p>
          {config.anchors.length > 0 && (
            <ul className="anchors">
              {config.anchors.map((a) => (
                <li key={a.id}>
                  <span>“{a.textQuote?.exact.slice(0, 60)}”</span>
                  <button type="button" className="link" onClick={() => patch({ anchors: config.anchors.filter((x) => x.id !== a.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
