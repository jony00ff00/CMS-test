import { lazy, Suspense, useId, type ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  list?: string;
  monospace?: boolean;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <input
          id={id}
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          list={props.list}
          spellCheck={false}
          className={props.monospace ? 'mono' : undefined}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
  /** Ordinary text: not monospaced, spell-checked. */
  prose?: boolean;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <textarea
          id={id}
          className={props.prose ? undefined : 'mono'}
          rows={props.rows ?? 5}
          value={props.value}
          placeholder={props.placeholder}
          spellCheck={!!props.prose}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field field-checkbox">
      <input id={id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <label htmlFor={id}>{props.label}</label>
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}

const loadCodeEditor = () => import('./CodeEditor');
const CodeEditor = lazy(loadCodeEditor);

/** Start loading the code editor in the background, so it is ready before anyone opens a snippet. */
export function preloadCodeEditor() {
  void loadCodeEditor();
}

/** A code field with syntax highlighting. Shows a plain text area while the editor loads. */
export function CodeField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  language: 'html' | 'css' | 'javascript';
  hint?: ReactNode;
  minHeight?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <Suspense
        fallback={
          <textarea
            className="mono"
            aria-label={props.label}
            rows={4}
            value={props.value}
            spellCheck={false}
            onChange={(e) => props.onChange(e.target.value)}
          />
        }
      >
        <CodeEditor value={props.value} onChange={props.onChange} language={props.language} label={props.label} minHeight={props.minHeight} />
      </Suspense>
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}
