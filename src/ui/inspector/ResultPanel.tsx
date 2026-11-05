import type { NodeResult } from '../../engine';

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
