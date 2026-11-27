import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { askAssistant, connectionHelp, DEFAULT_SETTINGS, listModels, LOCAL_SERVERS, type AssistantSettings } from '../../assistant/client';
import { planGraph, type AssistantPlan, type PlanStep } from '../../assistant/plan';
import type { ChatMessage } from '../../assistant/prompt';
import { nodeRegistry } from '../../engine';
import { editorStore } from '../../store/editor-store';

const SETTINGS_KEY = 'node-cms:assistant';

interface Entry {
  id: number;
  request: string;
  reply?: string;
  plan?: AssistantPlan;
  steps?: PlanStep[];
  attempts?: number;
  error?: string;
  status: 'asking' | 'proposed' | 'applied' | 'discarded' | 'answered' | 'failed';
}

function loadSettings(): AssistantSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<AssistantSettings> | null;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AssistantSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage blocked: the settings are just not remembered
  }
}

const context = () => {
  const s = editorStore.getState();
  return { registry: nodeRegistry, graph: s.graph, files: s.files, library: s.library, selectedId: s.selectedId };
};

/**
 * Asks a language model on the person's own computer to add, connect and set up nodes. Its plan is shown first;
 * nothing changes until "Apply" (one undo step).
 */
export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(() => !loadSettings().model);
  const [models, setModels] = useState<string[]>();
  const [modelsError, setModelsError] = useState<string>();
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [autoApply, setAutoApply] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(1);
  const log = useRef<HTMLOListElement>(null);
  const busy = entries.some((e) => e.status === 'asking');

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [entries]);

  const update = (id: number, patch: Partial<Entry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const change = (patch: Partial<AssistantSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if ('baseUrl' in patch) setModels(undefined);
  };

  const findModels = async () => {
    setModelsError(undefined);
    try {
      const found = await listModels(settings);
      setModels(found);
      if (!found.length) setModelsError('The server has no models yet (Ollama: ollama pull <model>)');
      else if (!found.includes(settings.model)) change({ model: found[0] });
    } catch (e) {
      setModels(undefined);
      setModelsError(connectionHelp(settings, e));
    }
  };

  const apply = (entry: Entry) => {
    if (!entry.plan) return;
    // Against the graph as it is now (it may have changed since the plan was made).
    const planned = planGraph(editorStore.getState().graph, entry.plan, context());
    editorStore.getState().applyGraph(planned.graph, planned.added.at(-1));
    update(entry.id, { status: 'applied', steps: planned.steps });
  };

  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    const request = input.trim();
    if (!request || busy) return;
    const id = nextId.current++;
    setEntries((list) => [...list, { id, request, status: 'asking' }]);
    setInput('');
    setShowSettings(false);
    abort.current = new AbortController();
    try {
      const turn = await askAssistant(settings, request, history.current, context(), { signal: abort.current.signal });
      history.current = turn.history;
      const entry: Entry = {
        id, request, reply: turn.plan.reply, plan: turn.plan, steps: turn.planned.steps, attempts: turn.attempts,
        status: turn.plan.operations.length ? 'proposed' : 'answered',
      };
      update(id, entry);
      if (autoApply && entry.status === 'proposed' && !turn.planned.errors.length) apply(entry);
    } catch (err) {
      update(id, { status: 'failed', error: connectionHelp(settings, err) });
    } finally {
      abort.current = undefined;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation(); // Backspace must not delete the selected node
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask();
    }
  };

  if (!open) {
    return (
      <button type="button" className="assistant-toggle" onClick={() => setOpen(true)} title="Build the flow by describing it to a language model on your computer">
        ✦ Assistant
      </button>
    );
  }

  return (
    <section className="assistant" aria-label="Assistant">
      <header className="assistant-head">
        <h2>Assistant</h2>
        <span className="muted small assistant-model">{settings.model || 'no model chosen'}</span>
        <button type="button" className="ghost small" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
          Settings
        </button>
        {entries.length > 0 && (
          <button type="button" className="ghost small" onClick={() => { setEntries([]); history.current = []; }} title="Start a new conversation">
            New
          </button>
        )}
        <button type="button" className="ghost small" aria-label="Close the assistant" onClick={() => setOpen(false)}>
          ×
        </button>
      </header>

      {showSettings && (
        <fieldset className="assistant-settings">
          <legend className="small">Local model (OpenAI-compatible server)</legend>
          <label>
            Server address
            <input type="text" value={settings.baseUrl} onChange={(e) => change({ baseUrl: e.target.value })} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} />
          </label>
          <div className="assistant-servers small">
            {LOCAL_SERVERS.map((s) => (
              <button key={s.name} type="button" className="ghost small" aria-pressed={settings.baseUrl === s.baseUrl} onClick={() => change({ baseUrl: s.baseUrl })}>
                {s.name}
              </button>
            ))}
          </div>
          <label>
            Model
            <span className="assistant-model-row">
              {models?.length ? (
                <select value={settings.model} onChange={(e) => change({ model: e.target.value })}>
                  {models.map((m) => <option key={m}>{m}</option>)}
                </select>
              ) : (
                <input type="text" value={settings.model} placeholder="e.g. qwen2.5-coder:7b" onChange={(e) => change({ model: e.target.value })} onKeyDown={(e) => e.stopPropagation()} spellCheck={false} />
              )}
              <button type="button" className="small" onClick={() => void findModels()}>Find models</button>
            </span>
          </label>
          {modelsError && <p className="error-text small" role="alert">{modelsError}</p>}
          <label>
            API key <span className="muted">(only if the server needs one)</span>
            <input type="password" value={settings.apiKey ?? ''} onChange={(e) => change({ apiKey: e.target.value })} onKeyDown={(e) => e.stopPropagation()} autoComplete="off" />
          </label>
          <label className="inline small">
            <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} /> Apply plans straight away (Undo takes them back)
          </label>
          <p className="muted small">
            Requests go from this browser straight to that address. The server must allow this page: for Ollama, start it
            with <code>OLLAMA_ORIGINS={location.origin}</code>; in LM Studio, turn on CORS.
          </p>
        </fieldset>
      )}

      <ol className="assistant-log" ref={log}>
        {entries.length === 0 && (
          <li className="muted small assistant-hint">
            Describe what to build, e.g. “Load guide.docx, wrap every h2 section in a callout and show the page”, or
            “Add a picture after the first paragraph”. The model sees the nodes, files and snippets in this project.
          </li>
        )}
        {entries.map((e) => (
          <li key={e.id} className="assistant-entry">
            <p className="assistant-request">{e.request}</p>
            {e.status === 'asking' && <p className="muted small" role="status">Thinking…</p>}
            {e.error && <p className="error-text small" role="alert">{e.error}</p>}
            {e.reply && <p className="assistant-reply">{e.reply}</p>}
            {e.steps && e.steps.length > 0 && (
              <ul className="assistant-steps small">
                {e.steps.map((s, i) => (
                  <li key={i} className={s.error ? 'step-error' : undefined}>
                    {s.text}
                    {s.error && <span className="error-text"> — skipped: {s.error}</span>}
                    {s.warnings?.map((w) => <span key={w} className="muted"> — {w}</span>)}
                  </li>
                ))}
              </ul>
            )}
            {e.status === 'proposed' && (
              <div className="assistant-actions">
                <button type="button" className="primary small" onClick={() => apply(e)}>
                  Apply
                </button>
                <button type="button" className="ghost small" onClick={() => update(e.id, { status: 'discarded' })}>
                  Discard
                </button>
                {e.attempts && e.attempts > 1 && <span className="muted small">after {e.attempts - 1} correction{e.attempts > 2 ? 's' : ''}</span>}
              </div>
            )}
            {e.status === 'applied' && <p className="muted small">Applied (Undo takes it back)</p>}
            {e.status === 'discarded' && <p className="muted small">Discarded</p>}
          </li>
        ))}
      </ol>

      <form className="assistant-form" onSubmit={(e) => void ask(e)}>
        <textarea
          aria-label="Ask the assistant"
          rows={2}
          value={input}
          placeholder={settings.model ? 'What should the flow do?' : 'Choose a model in Settings first'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button type="submit" className="primary" disabled={!input.trim() || !settings.model.trim()}>Ask</button>
        )}
      </form>
    </section>
  );
}
