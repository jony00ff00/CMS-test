import { useEditor } from '../../store/editor-store';

/** Shows the selected Output node's page, or the first Output node's, in a sandboxed iframe. */
export function Preview() {
  const target = useEditor((s) => {
    const outputs = s.graph.nodes.filter((n) => n.type === 'output');
    return outputs.find((n) => n.id === s.selectedId) ?? outputs[0];
  });
  const result = useEditor((s) => (target ? s.results[target.id] : undefined));
  const html = result?.status === 'ok' ? (result.outputs.html as string) : undefined;

  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-head">
        <h2>Preview</h2>
        <span className="muted small">
          {!target ? 'Add an Output node to see the result.' : html ? target.id : (result?.message ?? 'Waiting…')}
        </span>
      </div>
      {html ? (
        // allow-scripts without allow-same-origin: snippet JS runs, but cannot reach the editor.
        <iframe title="Output preview" sandbox="allow-scripts" srcDoc={html} />
      ) : (
        <div className="preview-empty muted">Nothing to show yet.</div>
      )}
    </section>
  );
}
