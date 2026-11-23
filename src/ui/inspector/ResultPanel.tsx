import type { NodeResult } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';

const LABELS: Record<string, string> = { ok: 'OK', waiting: 'Waiting', error: 'Error', blocked: 'Blocked' };

export function ResultPanel({ result }: { result?: NodeResult }) {
  if (!result) return null;
  const info = Object.entries(result.info).filter(([, v]) => v !== '');
  return (
    <section className="result-panel" aria-label="Result">
      <h3>
        Result <span className={`status-pill status-${result.status}`}>{LABELS[result.status]}</span>
        {result.status === 'ok' && (
          <span className="muted small"> {result.cached ? '(from cache)' : `(${Math.max(1, Math.round(result.duration))} ms)`}</span>
        )}
      </h3>
      {result.message && <p className={result.status === 'error' ? 'error-text' : 'muted'}>{result.message}</p>}
      {info.length > 0 && (
        <dl className="info">
          {info.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {(result.problems?.length ?? 0) > 0 && (
        <>
          <h4 className="error-text">Problems</h4>
          <ul className="problems" aria-label="Problems">
            {result.problems!.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}
      {result.upstreamProblems && <UpstreamProblems problems={result.upstreamProblems} />}
      {result.warnings.length > 0 && (
        <>
          <h4>Warnings</h4>
          <ul className="warnings">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** An Output's list of problems in the nodes before it; a click selects the node. */
export function UpstreamProblems({ problems }: { problems: NonNullable<NodeResult['upstreamProblems']> }) {
  const nodes = useEditor((s) => s.graph.nodes);
  return (
    <>
      <h4 className="error-text">Problems before this page</h4>
      <ul className="problems" aria-label="Problems before this page">
        {problems.map((p, i) => (
          <li key={i}>
            <button type="button" className="link" onClick={() => editorStore.getState().select(p.nodeId)}>
              {nodeLabel(nodes.find((n) => n.id === p.nodeId), p.nodeId)}
            </button>
            : {p.problem}
          </li>
        ))}
      </ul>
    </>
  );
}
