// Apply a snippet to every match of a selection, producing a new document.
import type { Element, ElementContent, Nodes, Properties, Text } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { childrenAt, indexDocument } from './doc-index';
import { locate, parseHtml } from './document';
import { isProtected, Workspace, type NodeRef, type Run, type TextRef } from './ranges';
import type { CmsDocument, Selection, Snippet, SnippetParam } from './types';

export interface ApplyOptions {
  /** Values for the snippet's parameters. Missing ones use the parameter's default. */
  params?: Record<string, unknown>;
  /** Grow text selections to the whole blocks (paragraphs, list items, ...) they touch. */
  snapToBlock?: boolean;
  /** Extra data per match, available in the template as `{{match.x}}` (e.g. the status of an anchor). */
  matchData?: (index: number) => Record<string, unknown>;
}

export interface ApplyResult {
  document: CmsDocument;
  warnings: string[];
  /** How many places the snippet was applied to (a text selection across blocks counts once per block). */
  applied: number;
}

const SLOT_TAG = 'cms-slot';
const SLOT = `<${SLOT_TAG}></${SLOT_TAG}>`;

/**
 * Apply `snippet` to each match in `selection`. Never changes the selection or its document.
 *
 * Template variables:
 * - `{{content}}`: the selected content itself (wrap / replace keep the original nodes).
 * - `{{text}}`: its plain text. Use this inside attributes.
 * - `{{html}}`: its HTML as a string (escaped unless written `{{{html}}}`).
 * - `{{index}}` (from 0), `{{number}}` (from 1), `{{count}}`: position among the matches.
 * - `{{part}}`, `{{parts}}`: when a text selection spans several blocks, which piece this is.
 * - `{{params.name}}`: parameter values. `{{jsonPath}}`: the JSON field the content comes from, if any.
 * - `{{match.x}}`: whatever `options.matchData(index)` returns for this match.
 *
 * JSON field blocks (`data-json-path`) are never removed: wrap goes outside them, replace works inside them,
 * and attributes cannot overwrite `data-json-path`.
 */
export async function applySnippet(selection: Selection, snippet: Snippet, options: ApplyOptions = {}): Promise<ApplyResult> {
  const doc = structuredClone(selection.document);
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  const { default: Handlebars } = await import('handlebars');
  const hb = Handlebars.create();
  let render: (context: object) => string;
  try {
    const compiled = hb.compile(snippet.template, { strict: false });
    render = (context) => compiled(context);
    render({ content: new hb.SafeString(SLOT), params: {} }); // surface syntax errors now
  } catch (err) {
    return { document: doc, warnings: [`${snippet.name}: template error: ${(err as Error).message}`], applied: 0 };
  }

  const params = resolveParams(snippet.params, options.params ?? {}, warn);
  const refs = toRefs(doc, selection, warn);
  const ws = new Workspace(doc.tree);
  let applied = 0;

  refs.forEach((ref, index) => {
    if (!ref) return;
    const runs = ref.kind === 'nodes' ? [ws.resolveNodes(ref)].filter((r): r is Run => !!r) : ws.isolateText(ref, !!options.snapToBlock);
    if (runs.length === 0) warn(`Match ${index + 1} could not be found in the document any more`);
    runs.forEach((run, part) => {
      const context = {
        index,
        number: index + 1,
        count: refs.length,
        part,
        parts: runs.length,
        params,
        match: options.matchData?.(index) ?? {},
      };
      try {
        applyToRun(ws, run, snippet, context, { hb, render, warn });
        applied++;
      } catch (err) {
        warn(`${snippet.name}: ${(err as Error).message}`);
      }
    });
  });

  if (snippet.css || snippet.js) {
    const key = `${snippet.id}@${snippet.version}`;
    const assets = doc.meta.snippetAssets ?? [];
    if (!assets.some((a) => a.key === key)) assets.push({ key, name: snippet.name, css: snippet.css, js: snippet.js });
    doc.meta.snippetAssets = assets;
  }
  return { document: doc, warnings, applied };
}

// ---------------------------------------------------------------------------------------------

type Child = ElementContent;

interface Tools {
  hb: typeof import('handlebars');
  render: (context: object) => string;
  warn: (message: string) => void;
}

function toRefs(doc: CmsDocument, selection: Selection, warn: (m: string) => void): (NodeRef | TextRef | undefined)[] {
  const ix = indexDocument(doc);
  return selection.matches.map(({ match }, i) => {
    if (match.kind === 'nodes') {
      const siblings = childrenAt(ix, match.parent) as Child[] | undefined;
      const first = siblings?.[match.start];
      const last = siblings?.[match.end - 1];
      if (!first || !last) {
        warn(`Match ${i + 1} points outside the document`);
        return undefined;
      }
      return { kind: 'nodes', first, last };
    }
    const start = locate(ix.text, match.start, 'forward');
    const end = locate(ix.text, match.end, 'backward');
    if (!start || !end || match.end <= match.start) {
      warn(`Match ${i + 1} is an empty text range`);
      return undefined;
    }
    return { kind: 'text', startNode: start.segment.node, startOffset: start.offset, endNode: end.segment.node, endOffset: end.offset };
  });
}

function applyToRun(ws: Workspace, run: Run, snippet: Snippet, base: object, tools: Tools) {
  const { hb, render, warn } = tools;
  const nodes = run.parent.children.slice(run.start, run.end) as Child[];
  const protectedNode = nodes.find(isProtected) ?? ws.ancestors(nodes[0]).find(isProtected);
  const jsonPath = protectedNode?.properties.dataJsonPath;
  const context = { ...base, text: plainText(nodes), html: toHtml(nodes), jsonPath };

  if (snippet.mode === 'attributes') {
    const attrs = parseAttributes(render({ ...context, content: toHtml(nodes) }), warn);
    if (run.fromText) {
      const span: Element = { type: 'element', tagName: 'span', properties: {}, children: [] };
      mergeProperties(span, attrs, warn);
      ws.splice(run.parent, run.start, run.end, [span]);
      ws.setChildren(span, nodes);
      return;
    }
    const elements = nodes.filter((n): n is Element => n.type === 'element');
    if (elements.length === 0) warn(`${snippet.name}: attributes need elements; this match is only text`);
    for (const el of elements) mergeProperties(el, attrs, warn);
    return;
  }

  const fragment = () => {
    const parsed = parseHtml(render({ ...context, content: new hb.SafeString(SLOT) }));
    for (const w of parsed.meta.warnings) warn(`${snippet.name}: ${w}`);
    const out = parsed.tree.children as Child[];
    if (findSlot(out, true)) warn(`${snippet.name}: {{content}} cannot be used inside an attribute; use {{text}}`);
    return out;
  };

  switch (snippet.mode) {
    case 'wrap': {
      const { nodes: out, filled } = fillSlots(fragment(), nodes, false);
      if (!filled) warn(`${snippet.name}: the template has no {{content}}, so the selected content was kept after it`);
      ws.splice(run.parent, run.start, run.end, filled ? out : [...out, ...nodes]);
      return;
    }
    case 'replace': {
      const fields = nodes.filter(isProtected);
      if (fields.length === 0) {
        ws.splice(run.parent, run.start, run.end, fillSlots(fragment(), nodes, false).nodes);
        return;
      }
      // Never remove a JSON field block: replace what is inside it instead.
      if (nodes.length > 1) warn(`${snippet.name}: replace across JSON fields was applied inside each field`);
      for (const field of fields) ws.setChildren(field, fillSlots(fragment(), field.children, false).nodes);
      return;
    }
    case 'prepend':
    case 'append': {
      const out = fillSlots(fragment(), nodes, true).nodes;
      const target = snippet.mode === 'prepend' ? nodes[0] : nodes[nodes.length - 1];
      if (snippet.inside && target.type === 'element') {
        const at = snippet.mode === 'prepend' ? 0 : target.children.length;
        ws.splice(target, at, at, out);
      } else {
        const at = snippet.mode === 'prepend' ? run.start : run.end;
        ws.splice(run.parent, at, at, out);
      }
      return;
    }
    default:
      throw new Error(`unknown snippet mode "${(snippet as { mode: string }).mode}"`);
  }
}

/** Replace every slot element with the content: the first gets the nodes themselves (unless `clone`), the rest get copies. */
function fillSlots(out: Child[], content: Child[], clone: boolean): { nodes: Child[]; filled: boolean } {
  let used = clone;
  let filled = false;
  const visit = (children: Child[]): Child[] =>
    children.flatMap((child) => {
      if (child.type === 'element' && child.tagName === SLOT_TAG) {
        filled = true;
        const nodes = used ? structuredClone(content) : content;
        used = true;
        return nodes;
      }
      if (child.type === 'element') child.children = visit(child.children);
      return [child];
    });
  return { nodes: visit(out), filled };
}

/** Find a slot that ended up inside an attribute value (as text). */
function findSlot(nodes: Nodes[], inAttributes: boolean): boolean {
  return nodes.some((n) => {
    if (n.type !== 'element') return false;
    if (inAttributes && Object.values(n.properties).some((v) => String(v).includes(`<${SLOT_TAG}>`))) return true;
    return findSlot(n.children, inAttributes);
  });
}

function parseAttributes(source: string, warn: (m: string) => void): Properties {
  const trimmed = source.trim();
  if (!trimmed) {
    warn('The attributes template is empty');
    return {};
  }
  const parsed = parseHtml(`<span ${trimmed}></span>`);
  for (const w of parsed.meta.warnings) warn(w.replace(' from <span>', ''));
  const el = parsed.tree.children[0];
  if (el?.type !== 'element' || parsed.tree.children.length !== 1) {
    warn(`Could not read attributes from "${trimmed}"`);
    return {};
  }
  return el.properties;
}

function mergeProperties(el: Element, add: Properties, warn: (m: string) => void) {
  for (const [key, value] of Object.entries(add)) {
    if (key === 'dataJsonPath') {
      warn('data-json-path cannot be changed by a snippet');
      continue;
    }
    if (key === 'className') {
      const existing = Array.isArray(el.properties.className) ? el.properties.className : [];
      const extra = Array.isArray(value) ? value : [String(value)];
      el.properties.className = [...new Set([...existing, ...extra].map(String))];
    } else if (key === 'style' && typeof el.properties.style === 'string') {
      el.properties.style = `${el.properties.style.replace(/;\s*$/, '')}; ${value}`;
    } else {
      el.properties[key] = value;
    }
  }
}

function plainText(nodes: Nodes[]): string {
  const parts: string[] = [];
  const walk = (n: Nodes) => {
    if (n.type === 'text') parts.push((n as Text).value);
    else if ('children' in n) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return parts.join('');
}

const toHtml = (nodes: Child[]) => unified().use(rehypeStringify).stringify({ type: 'root', children: nodes });

function resolveParams(defs: SnippetParam[], given: Record<string, unknown>, warn: (m: string) => void) {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(given)) {
    if (!defs.some((d) => d.name === name)) warn(`Unknown parameter "${name}"`);
  }
  for (const def of defs) {
    const fallback = def.default ?? (def.type === 'number' ? 0 : def.type === 'boolean' ? false : def.type === 'select' ? (def.options?.[0] ?? '') : '');
    const raw = given[def.name] ?? fallback;
    switch (def.type) {
      case 'number': {
        const n = Number(raw);
        if (Number.isNaN(n)) warn(`Parameter "${def.name}" must be a number`);
        out[def.name] = Number.isNaN(n) ? fallback : n;
        break;
      }
      case 'boolean':
        out[def.name] = raw === true || raw === 'true';
        break;
      case 'select':
        if (def.options && !def.options.includes(String(raw))) {
          warn(`Parameter "${def.name}" must be one of ${def.options.join(', ')}`);
          out[def.name] = fallback;
        } else out[def.name] = String(raw);
        break;
      default:
        out[def.name] = String(raw);
    }
  }
  return out;
}
