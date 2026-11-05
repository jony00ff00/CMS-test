// Write a transformed JSON-source document back into its JSON file.
// Only mapped fields change; everything else in the file stays as it was.
import type { Element, ElementContent, Nodes, Root } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { mapJsonToDocument } from './json';
import type { CmsDocument, JsonPathSegment } from './types';

export interface JsonExportOptions {
  /** Add the snippets' CSS and JS under a "$assets" key (only when the file is an object). Default false. */
  assets?: boolean;
  /** Spaces of indentation. Default 2. */
  indent?: number;
}

export interface JsonExportResult {
  json: string;
  data: unknown;
  /** Paths of the fields whose value changed. */
  changed: string[];
  warnings: string[];
}

const isElement = (n: Nodes | undefined): n is Element => n?.type === 'element';
const fieldPath = (n: Nodes | undefined) => (isElement(n) && typeof n.properties.dataJsonPath === 'string' ? n.properties.dataJsonPath : undefined);
const stringify = (children: ElementContent[] | Root['children']) =>
  unified().use(rehypeStringify).stringify({ type: 'root', children: children as Root['children'] });

/**
 * The JSON file with each field's current content. A field's value is the HTML inside its block, plus any
 * elements a snippet wrapped around that block alone (e.g. <details> around an answer). Text fields that are
 * still plain paragraphs are written as plain text. Fields nothing changed keep their original value exactly.
 */
export async function exportJson(doc: CmsDocument, options: JsonExportOptions = {}): Promise<JsonExportResult> {
  const info = doc.meta.json;
  if (!info) throw new Error('JSON export needs a .json Document Source');
  if (info.mapping.mode === 'template') throw new Error('This JSON source uses a template, so it can only be exported as HTML');

  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };
  const data = structuredClone(info.data);
  const fields = new Map(info.fields.map((f) => [f.path, f]));

  // What each field looked like straight after import, to leave untouched fields alone.
  const original = await mapJsonToDocument(info.data, info.mapping);
  const originalInner = new Map<string, string>();
  for (const child of original.tree.children) {
    const p = fieldPath(child);
    if (p && isElement(child)) originalInner.set(p, stringify(child.children));
  }

  // Parents of every node, to climb from a field block to the wrappers around it.
  const parents = new Map<Nodes, Element | Root>();
  const fieldBlocks: Element[] = [];
  const walk = (node: Element | Root) => {
    for (const child of node.children) {
      parents.set(child, node);
      if (fieldPath(child)) fieldBlocks.push(child as Element);
      if (isElement(child)) walk(child);
    }
  };
  walk(doc.tree);

  const countFields = (node: Nodes): number =>
    (fieldPath(node) ? 1 : 0) + (isElement(node) ? node.children.reduce((n, c) => n + countFields(c), 0) : 0);

  const changed: string[] = [];
  const written = new Set<Nodes>();
  for (const block of fieldBlocks) {
    const path = fieldPath(block)!;
    const field = fields.get(path);
    if (!field) {
      warn(`${path} is not one of the mapped fields, so it was not written back`);
      continue;
    }
    if (countFields(block) > 1) {
      warn(`${path} contains another field and could not be written back`);
      continue;
    }
    // Climb through wrappers that hold this field and no other.
    let container: Element = block;
    for (let p = parents.get(container); p && isElement(p) && countFields(p) === 1; p = parents.get(p)) container = p;
    written.add(container);
    const parentOfContainer = parents.get(container);
    if (parentOfContainer && isElement(parentOfContainer)) warn('A wrapper around several fields cannot be written back; only the fields inside it were');

    const value = container === block ? valueOf(block, field.format) : stringify([unwrap(container, block)]);
    if (container === block && stringify(block.children) === originalInner.get(path)) continue;
    if (field.format === 'markdown') warn('Changed Markdown fields are written back as HTML');
    if (setAt(data, field.segments, value)) changed.push(path);
  }

  const outside = doc.tree.children.filter((c) => !written.has(c) && countFields(c) === 0);
  if (outside.length) warn(`${outside.length} element${outside.length === 1 ? '' : 's'} outside the JSON fields ${outside.length === 1 ? 'was' : 'were'} not written back`);

  if (options.assets) {
    const assets = doc.meta.snippetAssets ?? [];
    if (data && typeof data === 'object' && !Array.isArray(data) && assets.length) {
      const css = assets.flatMap((a) => (a.css ? [a.css] : [])).join('\n');
      const js = assets.flatMap((a) => (a.js ? [a.js] : [])).join('\n');
      (data as Record<string, unknown>).$assets = { ...(css && { css }), ...(js && { js }) };
    } else if (assets.length) warn('Snippet CSS and JS can only be added to a JSON object');
  }

  return { json: JSON.stringify(data, null, options.indent ?? 2) + '\n', data, changed, warnings };
}

/** A text field that is still plain paragraphs goes back as text; anything else as HTML. */
function valueOf(block: Element, format: string): string {
  if (format === 'text') {
    const paragraphs = block.children.every(
      (p) => isElement(p) && p.tagName === 'p' && Object.keys(p.properties).length === 0 &&
        p.children.every((c) => c.type === 'text' || (isElement(c) && c.tagName === 'br')),
    );
    const inline = block.children.every((c) => c.type === 'text' || (isElement(c) && c.tagName === 'br'));
    const text = (nodes: ElementContent[]) => nodes.map((c) => (c.type === 'text' ? c.value : '\n')).join('');
    if (inline) return text(block.children);
    if (paragraphs) return block.children.map((p) => text((p as Element).children)).join('\n\n');
  }
  return stringify(block.children);
}

/** A copy of `node` where `block` is replaced by its children. */
function unwrap(node: Element, block: Element): Element {
  return {
    ...node,
    children: node.children.flatMap((c) => (c === block ? block.children : isElement(c) ? [unwrap(c, block)] : [c])),
  };
}

function setAt(data: unknown, segments: JsonPathSegment[], value: string): boolean {
  let target = data as Record<string | number, unknown>;
  for (const s of segments.slice(0, -1)) {
    const next = target?.[s];
    if (!next || typeof next !== 'object') return false;
    target = next as Record<string | number, unknown>;
  }
  const last = segments[segments.length - 1];
  if (target[last] === value) return false;
  target[last] = value;
  return true;
}
