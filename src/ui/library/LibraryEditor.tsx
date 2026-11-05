import { useEffect, useMemo, useState } from 'react';
import {
  applySnippet, parseHtml, refStatus, runSelector, serialize, validateSnippet, type Snippet, type SnippetNodeConfig,
} from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { ParamValues, SnippetFields } from '../inspector/SnippetFields';

const TRY_ON = '<p>Some <strong>example</strong> text to try the snippet on.</p>';
const TRY_CSS = 'body{font-family:system-ui,sans-serif;margin:.75rem;font-size:14px}';

/** Edit a library snippet. Saving makes a new version; nodes using the old one show that an update is available. */
export function LibraryEditor({ id }: { id: string }) {
  const versions = useEditor((s) => s.library[id]);
  const latest = versions?.[versions.length - 1];
  const nodes = useEditor((s) => s.graph.nodes);
  const users = useMemo(() => nodes.filter((n) => n.type === 'snippet' && (n.config as SnippetNodeConfig).ref?.id === id), [nodes, id]);
  const library = useEditor((s) => s.library);
  const [draft, setDraft] = useState<Snippet | undefined>(latest);
  // A fresh draft when another snippet is opened or a new version was saved.
  useEffect(() => setDraft(latest), [latest]);

  if (!latest || !draft) {
    return <p className="muted">This snippet is no longer in the library.</p>;
  }
  const store = editorStore.getState();
  const dirty = JSON.stringify(draft) !== JSON.stringify(latest);
  const errors = validateSnippet(draft);
  const outdated = users.filter((n) => refStatus(library, (n.config as SnippetNodeConfig).ref)?.outdated);

  return (
    <>
      <div className="library-head">
        <span className="version-pill">v{latest.version}</span>
        {dirty && <span className="warn-text small">Unsaved changes</span>}
      </div>
      <SnippetFields snippet={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
      {errors.length > 0 && (
        <ul className="errors" aria-label="Problems">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button type="button" className="primary" disabled={!dirty || errors.length > 0} onClick={() => store.saveSnippet(draft)}>
          Save as version {latest.version + 1}
        </button>
        <button type="button" className="ghost" disabled={!dirty} onClick={() => setDraft(latest)}>
          Discard changes
        </button>
      </div>
      <TryIt snippet={draft} />
      <section className="library-usage" aria-label="Used by">
        <h4>Used by</h4>
        {users.length === 0 ? (
          <p className="muted small">No node uses this snippet.</p>
        ) : (
          <ul>
            {users.map((n) => {
              const ref = (n.config as SnippetNodeConfig).ref!;
              return (
                <li key={n.id}>
                  <button type="button" className="link" onClick={() => store.select(n.id)}>
                    {n.id}
                  </button>{' '}
                  <span className="muted small">v{ref.version}</span>
                  {ref.version < latest.version && <span className="update-pill">update available</span>}
                </li>
              );
            })}
          </ul>
        )}
        {outdated.length > 0 && (
          <button type="button" onClick={() => outdated.forEach((n) => store.updateNodeSnippet(n.id))}>
            Update {outdated.length === 1 ? 'it' : `all ${outdated.length}`} to v{latest.version}
          </button>
        )}
      </section>
      <div className="button-row">
        <button type="button" onClick={() => store.addSnippetNode(id)}>
          Add to canvas
        </button>
        <button type="button" className="ghost" onClick={() => store.duplicateSnippet(id)}>
          Duplicate
        </button>
        <button
          type="button"
          className="ghost danger"
          onClick={() => {
            const note = users.length ? ` ${users.length} node${users.length === 1 ? '' : 's'} will keep their own copy.` : '';
            if (window.confirm(`Delete “${latest.name}” from the library?${note}`)) store.deleteSnippet(id);
          }}
        >
          Delete
        </button>
      </div>
      {versions.length > 1 && (
        <p className="muted small">
          Versions: {versions.map((v) => `v${v.version}`).join(', ')}. Saved versions never change.
        </p>
      )}
    </>
  );
}

/** The draft applied to a short example paragraph, with its CSS and JavaScript. */
function TryIt({ snippet }: { snippet: Snippet }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const doc = useMemo(() => parseHtml(TRY_ON), []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const selection = runSelector(doc, snippet.mode === 'attributes' || snippet.mode === 'replace' ? { mode: 'css', selector: 'strong' } : { mode: 'css', selector: 'p' });
      const result = await applySnippet(selection, { ...snippet, id: `${snippet.id}-try` }, { params: values });
      if (cancelled) return;
      setProblems(result.warnings);
      const html = serialize(result.document, { fullDocument: true });
      setPage(html.replace('</head>', `<style>${TRY_CSS}</style></head>`));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [snippet, values, doc]);

  return (
    <section className="try-it" aria-label="Try it">
      <h4>Try it</h4>
      <ParamValues params={snippet.params} values={values} onChange={(name, value) => setValues({ ...values, [name]: value })} />
      {page && <iframe title="Snippet example" sandbox="allow-scripts" srcDoc={page} />}
      {problems.length > 0 && (
        <ul className="warnings">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
