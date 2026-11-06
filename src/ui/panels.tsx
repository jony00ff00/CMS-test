import { useEffect, useState } from 'react';

export type PanelName = 'palette' | 'inspector' | 'preview';
export type Minimised = Record<PanelName, boolean>;

const KEY = 'node-cms:minimised-panels';
const NONE: Minimised = { palette: false, inspector: false, preview: false };

export const PANEL_TITLES: Record<PanelName, string> = { palette: 'Nodes', inspector: 'Inspector', preview: 'Preview' };

/** Which panels are minimised, remembered in this browser (a convenience: fine when storage is blocked). */
export function useMinimisedPanels() {
  const [minimised, setMinimised] = useState<Minimised>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Minimised>;
      return { palette: saved.palette === true, inspector: saved.inspector === true, preview: saved.preview === true };
    } catch {
      return NONE;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(minimised));
    } catch {
      // storage blocked: not remembered
    }
  }, [minimised]);
  const set = (panel: PanelName, value: boolean) => setMinimised((m) => ({ ...m, [panel]: value }));
  return [minimised, set] as const;
}

/** Arrow pointing the way the panel goes when minimised (or comes back from). */
const ARROWS = { left: 'M10 3 5 8l5 5', right: 'm6 3 5 5-5 5', down: 'm3 6 5 5 5-5', up: 'm3 10 5-5 5 5' } as const;

function Chevron({ dir }: { dir: keyof typeof ARROWS }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d={ARROWS[dir]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MINIMISE_DIR = { palette: 'left', inspector: 'right', preview: 'right' } as const;
const RESTORE_DIR = { palette: 'right', inspector: 'left', preview: 'left' } as const;

/** The button in a panel's header that minimises it. */
export function MinimiseButton({ panel, onClick }: { panel: PanelName; onClick: () => void }) {
  const title = `Minimise the ${PANEL_TITLES[panel].toLowerCase()} panel`;
  return (
    <button type="button" className="ghost panel-toggle" aria-label={title} title={title} onClick={onClick}>
      <Chevron dir={MINIMISE_DIR[panel]} />
    </button>
  );
}

/** What a minimised side panel leaves behind: a narrow strip that brings it back. */
export function PanelRail({ panel, onRestore, note }: { panel: Exclude<PanelName, 'preview'>; onRestore: () => void; note?: string }) {
  return (
    <aside className={`panel-rail ${panel}`} aria-label={`${PANEL_TITLES[panel]} (minimised)`}>
      <RailButton panel={panel} onRestore={onRestore} note={note} />
    </aside>
  );
}

/** The strip's button: an arrow, the panel's name written downwards, and an optional note. */
export function RailButton({ panel, onRestore, note }: { panel: PanelName; onRestore: () => void; note?: string }) {
  const title = `Show the ${PANEL_TITLES[panel].toLowerCase()} panel`;
  return (
    <button type="button" className="panel-rail-button" aria-label={title} title={title} onClick={onRestore}>
      <Chevron dir={RESTORE_DIR[panel]} />
      <span className="panel-rail-label">{PANEL_TITLES[panel]}</span>
      {note && <span className="panel-rail-note">{note}</span>}
    </button>
  );
}

/** A button that brings a minimised panel back. */
export function RestoreButton({ panel, onClick }: { panel: PanelName; onClick: () => void }) {
  const title = `Show the ${PANEL_TITLES[panel].toLowerCase()} panel`;
  return (
    <button type="button" className="ghost panel-toggle" aria-label={title} title={title} onClick={onClick}>
      <Chevron dir={RESTORE_DIR[panel]} />
    </button>
  );
}
