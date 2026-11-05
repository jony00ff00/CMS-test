// Import .json files: string fields (or a Handlebars template) → CmsDocument.
import type { Element, ElementContent, RootContent } from 'hast';
import { JSONPath } from 'jsonpath-plus';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { parseHtml } from './document';
import type { CmsDocument, JsonFieldFormat, JsonFieldMapping, JsonMapping, JsonPathSegment } from './types';

export class JsonParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'JsonParseError';
  }
}

/**
 * Parse JSON text. On failure, throws a JsonParseError with a line, a column and a plain reason.
 * The location comes from our own scanner, because browsers word JSON errors differently and some give no position.
 */
export function parseJson(text: string, fileName = 'JSON file'): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const problem = findJsonError(text);
    if (!problem) throw new JsonParseError(`${fileName} is not valid JSON: ${(err as Error).message}`);
    const before = text.slice(0, problem.offset);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    throw new JsonParseError(`${fileName} is not valid JSON (line ${line}, column ${column}): ${problem.reason}`, line, column);
  }
}

/** A small strict JSON scanner that only finds where the first syntax error is. */
export function findJsonError(text: string): { offset: number; reason: string } | undefined {
  let i = 0;
  class Stop {
    constructor(readonly offset: number, readonly reason: string) {}
  }
  const what = (c: string | undefined) => (c === undefined ? 'the end of the file' : `'${c}'`);
  const fail = (reason: string, at = i): never => {
    throw new Stop(at, reason);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('Invalid \\u escape in string');
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else fail(`Invalid escape ${what(e === undefined ? undefined : `\\${e}`)} in string`);
        continue;
      }
      if (c < ' ') fail(c === '\n' ? 'Line break inside a string (missing closing quote?)' : 'Control character inside a string');
      i++;
    }
    fail('String is never closed', start);
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
      m.lastIndex = i;
      const found = m.exec(text);
      if (!found) fail('Invalid number');
      i += found![0].length;
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, i)) {
        i += literal.length;
        return;
      }
    }
    if (c === "'") fail('Strings must use double quotes');
    fail(`Unexpected ${what(c)}, expected a value`);
  };
  const object = () => {
    i++;
    ws();
    if (text[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') {
        fail(text[i] === undefined ? 'Object is never closed' : `Expected a property name in double quotes, found ${what(text[i])}`);
      }
      string();
      ws();
      if (text[i] !== ':') fail(`Expected ':' after the property name, found ${what(text[i])}`);
      i++;
      value();
      ws();
      if (text[i] === ',') {
        const comma = i++;
        ws();
        if (text[i] === '}') fail("Trailing comma before '}'", comma);
        continue;
      }
      if (text[i] === '}') {
        i++;
        return;
      }
      fail(`Expected ',' or '}' after a property value, found ${what(text[i])}`);
    }
  };
  const array = () => {
    i++;
    ws();
    if (text[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      value();
      ws();
      if (text[i] === ',') {
        const comma = i++;
        ws();
        if (text[i] === ']') fail("Trailing comma before ']'", comma);
        continue;
      }
      if (text[i] === ']') {
        i++;
        return;
      }
      fail(`Expected ',' or ']' after an array item, found ${what(text[i])}`);
    }
  };

  try {
    value();
    ws();
    if (i < text.length) fail(`Unexpected ${what(text[i])} after the end of the data`);
    return undefined;
  } catch (err) {
    if (err instanceof Stop) return { offset: err.offset, reason: err.reason };
    throw err;
  }
}

/** Format path segments as a JSONPath, e.g. `$.articles[0].body` or `$['odd key']`. */
export function formatJsonPath(segments: JsonPathSegment[]): string {
  return (
    '$' +
    segments
      .map((s) =>
        typeof s === 'number'
          ? `[${s}]`
          : /^[A-Za-z_$][\w$]*$/.test(s)
            ? `.${s}`
            : `['${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`,
      )
      .join('')
  );
}

export interface DiscoveredPath {
  path: string;
  segments: JsonPathSegment[];
  /** First 80 characters of the value. */
  preview: string;
  /** A best guess, for the mapping UI to pre-fill. */
  suggestedFormat: JsonFieldFormat;
}

/** Every string value in the JSON, in file order. */
export function discoverPaths(data: unknown): DiscoveredPath[] {
  const found: DiscoveredPath[] = [];
  walk(data, [], (value, segments) => {
    if (typeof value !== 'string') return;
    found.push({
      path: formatJsonPath(segments),
      segments,
      preview: value.length > 80 ? `${value.slice(0, 79)}…` : value,
      suggestedFormat: guessFormat(value),
    });
  });
  return found;
}

function walk(value: unknown, segments: JsonPathSegment[], visit: (value: unknown, segments: JsonPathSegment[]) => void) {
  visit(value, segments);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...segments, i], visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, [...segments, k], visit);
  }
}

export function guessFormat(value: string): JsonFieldFormat {
  if (/<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1>|<(br|img|hr)\b[^>]*\/?>/i.test(value)) return 'html';
  if (/\*\*[^*]+\*\*|__[^_]+__|^#{1,6} |^\s*[-*+] |^\s*\d+\. |\[[^\]]+\]\([^)]+\)|`[^`]+`/m.test(value)) return 'markdown';
  return 'text';
}

/** The mapping used when none is given: every string field, as plain text. */
export function defaultJsonMapping(data: unknown): JsonMapping {
  return { mode: 'fields', fields: discoverPaths(data).map((p) => ({ path: p.path, format: 'text' as const })) };
}

export interface JsonImportOptions {
  fileName?: string;
}

/**
 * Build a CmsDocument from parsed JSON. Never changes `data`.
 * Async because the Markdown parser and Handlebars are only loaded when the mapping needs them.
 */
export async function mapJsonToDocument(data: unknown, mapping?: JsonMapping, options: JsonImportOptions = {}): Promise<CmsDocument> {
  const effective = mapping ?? defaultJsonMapping(data);
  const doc =
    effective.mode === 'template'
      ? await renderTemplate(data, effective.template ?? '', options)
      : await mapFields(data, effective.fields ?? [], options);
  doc.meta.json = { fields: doc.meta.json?.fields ?? [], data: structuredClone(data), mapping: structuredClone(effective) };
  return doc;
}

/** Parse and map in one step. Throws JsonParseError for invalid JSON. */
export async function importJson(source: string | ArrayBuffer | Uint8Array, mapping?: JsonMapping, options: JsonImportOptions = {}) {
  const text = typeof source === 'string' ? source : new TextDecoder().decode(source);
  return mapJsonToDocument(parseJson(text.replace(/^﻿/, ''), options.fileName), mapping, options);
}

// ---------------------------------------------------------------------------------------------
// Field mode

/** Wrappers that may only hold inline content: text goes in directly and html/markdown is not allowed. */
const INLINE_WRAPPERS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'em', 'strong', 'small', 'label']);

async function mapFields(data: unknown, fields: JsonFieldMapping[], options: JsonImportOptions): Promise<CmsDocument> {
  const markdown = fields.some((f) => f.format === 'markdown') ? await loadMarkdown() : undefined;
  const warnings: string[] = [];
  const styles: string[] = [];
  const children: RootContent[] = [];
  const resolved: { path: string; segments: JsonPathSegment[]; format: JsonFieldFormat }[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const query = queryJsonPaths(data, field.path);
    if ('error' in query) {
      warnings.push(`${field.path}: ${query.error}`);
      continue;
    }
    if (query.matches.length === 0) warnings.push(`${field.path}: matched nothing`);

    for (const match of query.matches) {
      if (match.segments.length === 0) {
        warnings.push(`${field.path}: the whole file cannot be a field`);
        continue;
      }
      const { segments, path } = match;

      let value = match.value;
      if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
      if (typeof value !== 'string') {
        warnings.push(`${path}: skipped, not a string (${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value})`);
        continue;
      }
      if (seen.has(path)) {
        warnings.push(`${path}: mapped more than once, kept the first`);
        continue;
      }
      seen.add(path);

      const format = field.format;
      let tag = field.blockTag ?? 'div';
      if (INLINE_WRAPPERS.has(tag) && format !== 'text') {
        warnings.push(`${path}: <${tag}> cannot hold ${format} content, used <div>`);
        tag = 'div';
      }
      const block = buildBlock(value, format, tag, path, { warnings, styles, markdown });
      children.push(block);
      resolved.push({ path, segments, format });
    }
  }

  return {
    kind: 'document',
    tree: { type: 'root', children },
    meta: {
      origin: 'json',
      fileName: options.fileName,
      title: firstTitle(data),
      styles,
      warnings,
      json: { data: undefined, mapping: { mode: 'fields', fields }, fields: resolved },
    },
    assets: {},
  };
}

export interface JsonPathMatch {
  path: string;
  segments: JsonPathSegment[];
  value: unknown;
}

/** Run a JSONPath query and return each match with its exact, normalized path. */
export function queryJsonPaths(data: unknown, path: string): { matches: JsonPathMatch[] } | { error: string } {
  let raw: { value: unknown; parent: unknown; parentProperty: string | number }[];
  try {
    raw = (JSONPath({ path, json: data as object, resultType: 'all', eval: 'safe', wrap: true }) ?? []) as typeof raw;
  } catch (err) {
    return { error: `invalid JSONPath (${(err as Error).message})` };
  }
  const segmentsOf = indexContainers(data);
  return {
    matches: raw.map((m) => {
      if (m.parent == null) return { path: '$', segments: [], value: m.value };
      const key = Array.isArray(m.parent) ? Number(m.parentProperty) : String(m.parentProperty);
      const segments = [...(segmentsOf.get(m.parent as object) ?? []), key];
      return { path: formatJsonPath(segments), segments, value: m.value };
    }),
  };
}

/** Map every object and array in the JSON to its path, so matches can be turned back into paths. */
function indexContainers(data: unknown): Map<object, JsonPathSegment[]> {
  const map = new Map<object, JsonPathSegment[]>();
  walk(data, [], (value, segments) => {
    if (value && typeof value === 'object') map.set(value, segments);
  });
  return map;
}

interface BlockContext {
  warnings: string[];
  styles: string[];
  markdown?: (source: string) => string;
}

function buildBlock(value: string, format: JsonFieldFormat, tag: string, path: string, ctx: BlockContext): Element {
  const { warnings, styles } = ctx;
  let content: ElementContent[];
  if (format === 'text') {
    content = INLINE_WRAPPERS.has(tag) ? textWithBreaks(value.trim()) : textParagraphs(value);
  } else {
    const html = format === 'markdown' ? ctx.markdown!(value) : value;
    const fragment = parseHtml(html);
    warnings.push(...fragment.meta.warnings.map((w) => `${path}: ${w}`));
    styles.push(...fragment.meta.styles);
    content = fragment.tree.children as ElementContent[];
  }
  return { type: 'element', tagName: tag, properties: { dataJsonPath: path }, children: content };
}

/** Plain text: blank lines start a new paragraph, single line breaks become <br>. */
function textParagraphs(value: string): ElementContent[] {
  return value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: 'element', tagName: 'p', properties: {}, children: textWithBreaks(p) }));
}

function textWithBreaks(value: string): ElementContent[] {
  const out: ElementContent[] = [];
  value.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ type: 'element', tagName: 'br', properties: {}, children: [] });
    const text = line.replace(/\s+/g, ' ');
    if (text) out.push({ type: 'text', value: text });
  });
  return out;
}

let markdownLoader: Promise<(source: string) => string> | undefined;

/** Load the Markdown parser once and return a synchronous Markdown → HTML function. Raw HTML is dropped. */
export function loadMarkdown(): Promise<(source: string) => string> {
  markdownLoader ??= Promise.all([import('remark-parse'), import('remark-gfm'), import('remark-rehype')]).then(
    ([parse, gfm, toRehype]) => {
      const processor = unified().use(parse.default).use(gfm.default).use(toRehype.default).use(rehypeStringify);
      return (source: string) => String(processor.processSync(source));
    },
  );
  return markdownLoader;
}

export async function markdownToHtml(source: string): Promise<string> {
  return (await loadMarkdown())(source);
}

function firstTitle(data: unknown): string | undefined {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of ['title', 'name', 'headline']) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Template mode

async function renderTemplate(data: unknown, template: string, options: JsonImportOptions): Promise<CmsDocument> {
  const [{ default: Handlebars }, markdown] = await Promise.all([import('handlebars'), loadMarkdown()]);
  const hb = Handlebars.create();
  hb.registerHelper('markdown', (value: unknown) => new hb.SafeString(typeof value === 'string' ? markdown(value) : ''));
  hb.registerHelper('json', (value: unknown) => JSON.stringify(value));

  let html: string;
  try {
    html = hb.compile(template)(data);
  } catch (err) {
    throw new Error(`JSON template error: ${(err as Error).message}`);
  }
  const doc = parseHtml(html, { fileName: options.fileName, origin: 'json' });
  doc.meta.title ??= firstTitle(data);
  doc.meta.json = { data: undefined, mapping: { mode: 'template', template }, fields: [] };
  return doc;
}
