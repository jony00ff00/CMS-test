import { useMemo } from 'react';
import {
  changeGroups, commentThreads, decisionFor, KIND_LABELS, kindOf, type ChangeDecision, type ChangeKind, type ChangesConfig, type CmsDocument, type GraphNode,
} from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField, SelectField, TextField } from './fields';

const DECISIONS: { value: ChangeDecision; label: string }[] = [
  { value: 'keep', label: 'Keep as a suggestion' },
  { value: 'accept', label: 'Accept' },
  { value: 'reject', label: 'Reject' },
];

const when = (date: string | undefined, utc: boolean) => (date ? `${date.replace('T', ' ').slice(0, 16)}${utc ? ' UTC' : ''}` : 'no date');

/** The Changes node: what happens to each kind of change, each author's changes, each change, each comment thread. */
export function ChangesEditor({ node }: { node: GraphNode }) {
  const config = node.config as ChangesConfig;
  const update = (patch: Partial<ChangesConfig>) => editorStore.getState().updateConfig<ChangesConfig>(node.id, (c) => ({ ...c, ...patch }));
  const input = useEditor((s) => {
    const edge = s.graph.edges.find((e) => e.target === node.id && e.targetPort === 'document');
    const r = edge ? s.results[edge.source] : undefined;
    return r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as CmsDocument | undefined) : undefined;
  });
  const groups = useMemo(() => (input ? changeGroups(input) : []), [input]);
  const threads = useMemo(() => (input ? commentThreads(input) : []), [input]);
  const review = input?.meta.review;

  if (!input) return <p className="hint warn-text">Connect a Document Source with a Word file read in review mode.</p>;
  if (!review) {
    return (
      <p className="hint warn-text">
        The document has no tracked changes or comments. In its Document Source, turn on “Keep tracked changes and comments (review mode)”.
      </p>
    );
  }
  const kinds = [...new Set(groups.map((g) => g.kind))];
  const undated = [...Object.values(review.revisions), ...Object.values(review.comments)].some((x) => x.date && !x.utc);
  const setDecision = (ids: string[], d: ChangeDecision | '') => {
    const decisions = { ...config.decisions };
    for (const id of ids) {
      if (d) decisions[id] = d;
      else delete decisions[id];
    }
    update({ decisions });
  };
  const dropped = new Set(config.dropComments ?? []);

  return (
    <>
      <p className="muted small">
        Decide what stays a suggestion in the editor, and what is accepted or rejected now. A change's own choice wins over its
        author's, which wins over its kind's.
      </p>
      <fieldset>
        <legend>By kind</legend>
        {kinds.length === 0 && <p className="hint">No tracked changes.</p>}
        {kinds.map((kind) => (
          <SelectField
            key={kind}
            label={KIND_LABELS[kind as ChangeKind]}
            value={config.defaults?.[kind] ?? 'keep'}
            options={DECISIONS}
            onChange={(d) => update({ defaults: { ...config.defaults, [kind]: d } })}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>Authors</legend>
        <p className="hint">The user id is who the author is in the editor (the id your sign-in gives them); without one, the name is used.</p>
        {review.authors.map((author) => (
          <div key={author} className="author-row" aria-label={`Author ${author}`}>
            <strong>{author || '(no name)'}</strong>
            <SelectField
              label="Their changes"
              value={(config.byAuthor?.[author] ?? '') as ChangeDecision}
              options={[{ value: '' as ChangeDecision, label: 'As their kind says' }, ...DECISIONS]}
              onChange={(d) => {
                const byAuthor = { ...config.byAuthor };
                if (d) byAuthor[author] = d;
                else delete byAuthor[author];
                update({ byAuthor });
              }}
            />
            <TextField
              label="User id in the editor"
              value={config.users?.[author]?.id ?? ''}
              placeholder="e.g. user-123"
              monospace
              onChange={(id) => {
                const users = { ...config.users };
                if (id.trim()) users[author] = { ...users[author], id: id.trim() };
                else delete users[author];
                update({ users });
              }}
            />
          </div>
        ))}
        {undated && (
          <TextField
            label="Time zone of dates without one"
            value={config.timezone ?? ''}
            placeholder="+08:00"
            hint="Some dates in the file have no time zone. Give the offset from UTC of the computer they were written on."
            onChange={(timezone) => update({ timezone: timezone.trim() || undefined })}
          />
        )}
      </fieldset>
      <fieldset>
        <legend>Changes ({groups.reduce((n, g) => n + g.ids.length, 0)})</legend>
        <ul className="change-list" aria-label="Tracked changes">
          {groups.map((g) => {
            const own = config.decisions?.[g.ids[0]] ?? '';
            const effective = decisionFor(config, { ...review.revisions[g.ids[0]], id: g.ids[0] });
            return (
              <li key={g.ids.join(' ')} className={`change change-${g.kind} decision-${effective}`}>
                <div>
                  <strong>{KIND_LABELS[kindOf(review.revisions[g.ids[0]])]}</strong>
                  {g.ids.length > 1 ? ` · ${g.ids.length} paragraphs` : ''} · {g.author || 'no author'} · {when(g.date, g.utc)}
                </div>
                <div className="change-text">“{g.text}”{g.before ? <span className="muted"> (was: {g.before})</span> : null}</div>
                <select
                  aria-label={`Decision for ${g.text.slice(0, 30)}`}
                  value={own}
                  onChange={(e) => setDecision(g.ids, e.target.value as ChangeDecision | '')}
                >
                  <option value="">As the rules say ({DECISIONS.find((d) => d.value === decisionFor({ ...config, decisions: {} }, review.revisions[g.ids[0]]))?.label.toLowerCase()})</option>
                  {DECISIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset>
        <legend>Comments ({threads.length})</legend>
        <CheckboxField label="Drop threads resolved in Word" checked={!!config.dropResolved} onChange={(dropResolved) => update({ dropResolved })} />
        <ul className="change-list" aria-label="Comment threads">
          {threads.map((t) => {
            const first = t.comments[0];
            const keep = !dropped.has(t.id) && !(config.dropResolved && first.resolved);
            return (
              <li key={t.id} className={`change ${keep ? '' : 'decision-drop'}`}>
                <label className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={keep}
                    disabled={!!config.dropResolved && first.resolved}
                    onChange={(e) => {
                      const next = new Set(dropped);
                      if (e.target.checked) next.delete(t.id);
                      else next.add(t.id);
                      update({ dropComments: [...next] });
                    }}
                  />{' '}
                  <span>
                    <strong>{first.author}</strong>: {first.html.replace(/<[^>]+>/g, ' ').trim()}
                    {t.comments.length > 1 ? ` (+${t.comments.length - 1} repl${t.comments.length === 2 ? 'y' : 'ies'})` : ''}
                    {first.resolved ? ' · resolved' : ''}
                  </span>
                </label>
                <div className="change-text muted">on “{t.text || 'a point'}”</div>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </>
  );
}
