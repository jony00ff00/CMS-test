// Project files: the graph, its files and the snippet library as one JSON document.
// Used for autosave (localStorage) and for "Save project file" / "Open project".
import {
  edgeError, nodeRegistry, storeFile, type Graph, type NodeRegistry, type Snippet, type SnippetLibrary, type StoredFile,
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

  const files: Record<string, StoredFile> = {};
  for (const f of Array.isArray(p.files) ? p.files : []) {
    try {
      if (typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.data !== 'string') throw new Error('incomplete');
      files[f.id] = storeFile(f.name, f.encoding === 'base64' ? fromBase64(f.data) : f.data, f.id);
    } catch {
      warnings.push(`A file (${typeof f?.name === 'string' ? f.name : 'unnamed'}) could not be read and was left out`);
    }
  }

  const nodes = (Array.isArray(p.graph?.nodes) ? p.graph.nodes : []).filter((n) => {
    const ok = n && typeof n.id === 'string' && typeof n.type === 'string' && registry[n.type];
    if (!ok) warnings.push(`A node of unknown type "${String(n?.type)}" was left out`);
    return ok;
  });
  const ids = new Set<string>();
  const unique = nodes.filter((n) => (ids.has(n.id) ? (warnings.push(`A second node "${n.id}" was left out`), false) : ids.add(n.id)));
  const graph: Graph = { nodes: unique, edges: [] };
  for (const e of Array.isArray(p.graph?.edges) ? p.graph.edges : []) {
    const error = e && typeof e.id === 'string' ? edgeError(graph, e, registry) : 'incomplete connection';
    if (error) warnings.push(`A connection was left out: ${error}`);
    else graph.edges.push(e);
  }

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
