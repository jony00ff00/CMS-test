// Project files: the graph, its files and the snippet library as one JSON document.
// Used for autosave (localStorage) and for "Save project file" / "Open project".
import {
  edgeError, ENGINE_VERSION, NOTE_COLORS, nodeRegistry, type CanvasNote, type NoteColor, storeFile, type Graph, type NodeGroup, type NodeRegistry, type Snippet, type SnippetLibrary, type StoredFile,
} from '../engine';
import { seedLibrary } from '../snippets/seed';

export const PROJECT_FORMAT = 'node-cms-project';
export const PROJECT_VERSION = 1;

interface SavedFile {
  id: string;
  name: string;
  encoding: 'text' | 'base64';
  data: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  /** The engine version that saved it (`ENGINE_VERSION`). */
  engineVersion?: string;
  graph: Graph;
  files: SavedFile[];
  library: SnippetLibrary;
}

export interface Project {
  graph: Graph;
  files: Record<string, StoredFile>;
  library: SnippetLibrary;
}

export function toProjectFile(project: Project, savedAt = new Date()): ProjectFile {
  // Only files that a node still uses.
  const used = new Set(project.graph.nodes.flatMap((n) => fileIdsIn(n.config)));
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    engineVersion: ENGINE_VERSION,
    graph: project.graph,
    files: Object.values(project.files)
      .filter((f) => used.has(f.id))
      .map((f) =>
        typeof f.data === 'string'
          ? { id: f.id, name: f.name, encoding: 'text', data: f.data }
          : { id: f.id, name: f.name, encoding: 'base64', data: toBase64(f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data) },
      ),
    library: project.library,
  };
}

/** Every `fileId` in a node's settings, however deep (Document Source: `fileId`; Insert: `content.fileId`). */
function fileIdsIn(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(fileIdsIn);
  return Object.entries(value).flatMap(([k, v]) => (k === 'fileId' && typeof v === 'string' ? [v] : fileIdsIn(v)));
}

export const projectToJson = (project: Project) => JSON.stringify(toProjectFile(project), null, 1);

export interface ParsedProject {
  project: Project;
  /** Parts that were dropped because they were broken. */
  warnings: string[];
}

/** Read a project file. Throws with a readable message when it is not one; drops broken parts with a warning. */
export function parseProject(text: string, registry: NodeRegistry = nodeRegistry): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a project file (it is not valid JSON)');
  }
  const p = raw as Partial<ProjectFile>;
  if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) throw new Error('This is not a Node CMS project file');
  if (typeof p.version !== 'number' || p.version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer version of the app (format ${String(p.version)})`);
  }
  const warnings: string[] = [];
  if (typeof p.engineVersion === 'string' && newerThan(p.engineVersion, ENGINE_VERSION)) {
    warnings.push(
      `This project was made with a newer version of the app (${p.engineVersion}; this page runs ${ENGINE_VERSION}), so parts of it may not work. Reload the page to get the latest version, then open the project again`,
    );
  }

  const files: Record<string, StoredFile> = {};
  for (const f of Array.isArray(p.files) ? p.files : []) {
    try {
      if (typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.data !== 'string') throw new Error('incomplete');
      files[f.id] = storeFile(f.name, f.encoding === 'base64' ? fromBase64(f.data) : f.data, f.id);
    } catch {
      warnings.push(`A file (${typeof f?.name === 'string' ? f.name : 'unnamed'}) could not be read and was left out`);
    }
  }

  const rawNodes = Array.isArray(p.graph?.nodes) ? p.graph.nodes : [];
  const rawEdges = Array.isArray(p.graph?.edges) ? p.graph.edges : [];
  upgradeInsertNodes(rawNodes, rawEdges, warnings);
  const nodes = rawNodes.filter((n) => {
    const ok = n && typeof n.id === 'string' && typeof n.type === 'string' && registry[n.type];
    if (!ok) {
      warnings.push(
        n?.type === 'combinator'
          ? `The Combinator node "${String(n.name ?? n.id)}" was left out: Combinators are no longer available (an Output combines several documents)`
          : `A node of unknown type "${String(n?.type)}" was left out`,
      );
    }
    return ok;
  });
  // A name must be text; anything else is dropped.
  for (const n of nodes) if (n.name !== undefined && typeof n.name !== 'string') delete n.name;
  const ids = new Set<string>();
  const unique = nodes.filter((n) => (ids.has(n.id) ? (warnings.push(`A second node "${n.id}" was left out`), false) : ids.add(n.id)));
  const graph: Graph = { nodes: unique, edges: [] };
  for (const e of rawEdges) {
    // Connectors used to take only a result, on an input called "result"; it is now "input" and takes anything.
    if (e && e.targetPort === 'result' && unique.find((n) => n.id === e.target)?.type === 'connector') e.targetPort = 'input';
    // An Object's second input was "selection" (selections only); it is now "content" and takes anything.
    if (e && e.targetPort === 'selection' && unique.find((n) => n.id === e.target)?.type === 'object') e.targetPort = 'content';
    const error = e && typeof e.id === 'string' ? edgeError(graph, e, registry) : 'incomplete connection';
    if (error) warnings.push(`A connection was left out: ${error}`);
    else graph.edges.push(e);
  }

  const groups = readGroups(p.graph?.groups, ids, warnings);
  if (groups.length) graph.groups = groups;
  const notes = readNotes(p.graph?.notes, warnings);
  if (notes.length) graph.notes = notes;

  let library: SnippetLibrary = seedLibrary();
  if (p.library && typeof p.library === 'object') {
    library = {};
    for (const [id, versions] of Object.entries(p.library)) {
      const valid = (Array.isArray(versions) ? versions : []).filter(isSnippet);
      if (valid.length) library[id] = valid;
      else warnings.push(`The snippet "${id}" could not be read and was left out`);
    }
  }

  return { project: { graph, files, library }, warnings };
}

function isSnippet(s: unknown): s is Snippet {
  const x = s as Snippet;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.version === 'number' &&
    typeof x.template === 'string' && typeof x.mode === 'string' && Array.isArray(x.params);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Insert nodes (before Object nodes) held their content and where it goes. Now a Selector gives the place (its
 * Point output) and an Object holds the content: each Insert becomes a Selector (with the old place) feeding an
 * Object with the same id, so connections out of it stay as they were.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upgradeInsertNodes(nodes: any[], edges: any[], warnings: string[]) {
  const taken = new Set(nodes.map((n) => n?.id));
  let upgraded = 0;
  for (const n of [...nodes]) {
    if (n?.type !== 'insert' || typeof n.id !== 'string') continue;
    const where = n.config?.where ?? { mode: 'point' };
    let id = `${n.id}-point`;
    for (let i = 2; taken.has(id); i++) id = `${n.id}-point-${i}`;
    taken.add(id);
    const selectorConfig =
      where.mode === 'selector' && where.selector ? { ...where.selector, place: where.place ?? 'after' } : { mode: 'point', ...(where.point ? { point: where.point } : {}) };
    const position = n.position ? { x: n.position.x - 260, y: n.position.y + 140 } : undefined;
    nodes.splice(nodes.indexOf(n), 0, { id, type: 'selector', name: n.name ? `${n.name} (point)` : undefined, config: selectorConfig, ...(position && { position }) });
    n.type = 'object';
    n.config = { content: n.config?.content ?? { kind: 'imageUrl', url: '', alt: '' } };
    for (const e of edges) {
      if (e?.target === n.id && e.targetPort === 'document') e.target = id;
    }
    edges.push({ id: `${id}-to-${n.id}`, source: id, sourcePort: 'point', target: n.id, targetPort: 'point' });
    upgraded++;
  }
  for (const n of nodes) if (n && n.name === undefined) delete n.name;
  if (upgraded) {
    warnings.push(
      `${upgraded} Insert node${upgraded === 1 ? ' is' : 's are'} now ${upgraded === 1 ? 'an Object node' : 'Object nodes'}: where ${upgraded === 1 ? 'it goes' : 'they go'} is set by a new Selector (its Point output)`,
    );
  }
}

/** Canvas notes from a project file: broken ones are left out with a warning; unknown colours are dropped. */
function readNotes(raw: unknown, warnings: string[]): CanvasNote[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The notes could not be read and were left out');
    return [];
  }
  const notes: CanvasNote[] = [];
  for (const n of raw as Partial<CanvasNote>[]) {
    const p = n?.position;
    if (!n || typeof n.id !== 'string' || typeof n.text !== 'string' || !p || typeof p.x !== 'number' || typeof p.y !== 'number' || notes.some((x) => x.id === n.id)) {
      warnings.push('A note could not be read and was left out');
      continue;
    }
    notes.push({
      id: n.id,
      text: n.text,
      position: { x: p.x, y: p.y },
      ...(typeof n.width === 'number' && n.width > 0 && { width: n.width }),
      ...(NOTE_COLORS.includes(n.color as NoteColor) && { color: n.color }),
    });
  }
  return notes;
}

/** Groups from a project file: unknown nodes leave them, a node in two groups stays in the first, empty ones go. */
function readGroups(raw: unknown, nodeIds: Set<string>, warnings: string[]): NodeGroup[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The groups could not be read and were left out');
    return [];
  }
  const groups: NodeGroup[] = [];
  const taken = new Set<string>();
  for (const g of raw as Partial<NodeGroup>[]) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.nodeIds) || groups.some((x) => x.id === g.id)) {
      warnings.push('A group could not be read and was left out');
      continue;
    }
    const name = typeof g.name === 'string' ? g.name : g.id;
    const members: string[] = [];
    for (const id of g.nodeIds) {
      if (typeof id !== 'string' || !nodeIds.has(id) || members.includes(id)) continue;
      if (taken.has(id)) {
        warnings.push(`The node "${id}" was in two groups; it stays in the first`);
        continue;
      }
      members.push(id);
      taken.add(id);
    }
    if (!members.length) {
      warnings.push(`The group "${name}" has no nodes left and was left out`);
      continue;
    }
    groups.push({
      id: g.id,
      name,
      nodeIds: members,
      ...(typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) && { color: g.color }),
      ...(g.collapsed === true && { collapsed: true }),
    });
  }
  return groups;
}

/** Whether version a (e.g. "0.6.0") is newer than b. */
export function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}
