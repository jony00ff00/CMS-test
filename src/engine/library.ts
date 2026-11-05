// The snippet library: reusable snippets, each with a list of versions. Versions never change once saved;
// editing a snippet saves a new version, and Snippet nodes keep the version they use until updated.
import type { Snippet, SnippetParam } from './types';

/** Snippet id → its versions, oldest first. */
export type SnippetLibrary = Record<string, Snippet[]>;

export function latestVersion(library: SnippetLibrary, id: string): Snippet | undefined {
  const versions = library[id];
  return versions?.[versions.length - 1];
}

export function findVersion(library: SnippetLibrary, id: string, version: number): Snippet | undefined {
  return library[id]?.find((s) => s.version === version);
}

/** Save `snippet` as the next version of its id (version 1 for a new id). Returns the new library. */
export function addVersion(library: SnippetLibrary, snippet: Snippet): { library: SnippetLibrary; snippet: Snippet } {
  const previous = latestVersion(library, snippet.id);
  const saved: Snippet = { ...structuredClone(snippet), kind: 'snippet', version: (previous?.version ?? 0) + 1 };
  return { library: { ...library, [snippet.id]: [...(library[snippet.id] ?? []), saved] }, snippet: saved };
}

export function removeSnippet(library: SnippetLibrary, id: string): SnippetLibrary {
  const { [id]: _removed, ...rest } = library;
  return rest;
}

/** A snippet id from a name, unique in the library: "My Box" → "my-box", "my-box-2", ... */
export function snippetIdFor(library: SnippetLibrary, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snippet';
  let id = base;
  for (let i = 2; library[id]; i++) id = `${base}-${i}`;
  return id;
}

export interface RefStatus {
  /** The library no longer has this snippet. */
  missing: boolean;
  /** A newer version exists. */
  outdated: boolean;
  latest?: Snippet;
}

export function refStatus(library: SnippetLibrary, ref: { id: string; version: number } | undefined): RefStatus | undefined {
  if (!ref) return undefined;
  const latest = latestVersion(library, ref.id);
  return { missing: !latest, outdated: !!latest && latest.version > ref.version, latest };
}

/**
 * Parameter values after switching to another version: values for parameters that still exist
 * (and are still valid) are kept, the rest are dropped so the new defaults apply.
 */
export function carryParams(params: Record<string, unknown> | undefined, to: SnippetParam[]): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const kept: Record<string, unknown> = {};
  for (const p of to) {
    if (!(p.name in params)) continue;
    const v = params[p.name];
    if (p.type === 'select' && !p.options?.includes(String(v))) continue;
    kept[p.name] = v;
  }
  return Object.keys(kept).length ? kept : undefined;
}

/** Problems that would stop a snippet from being saved. */
export function validateSnippet(snippet: Snippet): string[] {
  const errors: string[] = [];
  if (!snippet.name.trim()) errors.push('Give the snippet a name');
  if (!snippet.template.trim() && snippet.mode !== 'replace') errors.push('The template is empty');
  const names = new Set<string>();
  for (const p of snippet.params) {
    if (!/^[A-Za-z_][\w]*$/.test(p.name)) errors.push(`Parameter name "${p.name}" must be letters, digits or _ (not starting with a digit)`);
    else if (names.has(p.name)) errors.push(`Two parameters are called "${p.name}"`);
    names.add(p.name);
    if (p.type === 'select' && !p.options?.length) errors.push(`Parameter "${p.name}" needs at least one option`);
    if (p.type === 'select' && p.default !== undefined && !p.options?.includes(String(p.default))) {
      errors.push(`The default of "${p.name}" must be one of its options`);
    }
  }
  return errors;
}
