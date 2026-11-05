// Selector modes: pick parts of a document by CSS, regex, heading section, JSON field, or stored anchors.
import type { Element } from 'hast';
import { selectAll } from 'hast-util-select';
import { resolveAnchors, type ResolveOptions } from './anchors';
import { elementMatch, enclosingBlock, headingLevel, indexDocument, sameMatch, sectionMatch, textOf, type DocIndex } from './doc-index';
import { queryJsonPaths } from './json';
import type { Anchor, CmsDocument, Match, Selection, SelectionMatch } from './types';

export type SelectorConfig =
  | { mode: 'css'; selector: string }
  | {
      mode: 'regex';
      pattern: string;
      /** Regex flags; "g" is always added. Default "". */
      flags?: string;
      /** "match" selects the matched text, "block" the whole block element around each match. Default "match". */
      scope?: 'match' | 'block';
    }
  | {
      mode: 'heading';
      text: string;
      /** Default "contains" (case-insensitive). */
      match?: 'exact' | 'contains';
      /** Only headings of this level (1–6). */
      level?: number;
      /** Default true. */
      includeHeading?: boolean;
    }
  | { mode: 'jsonField'; path: string }
  | ({ mode: 'manual'; anchors: Anchor[] } & ResolveOptions);

export type SelectorMode = SelectorConfig['mode'];

/** Safety limit so a pattern like "." cannot freeze the app. */
export const MAX_MATCHES = 5000;

/** Run a selector on a document. Problems become warnings; this never throws. */
export function runSelector(doc: CmsDocument, config: SelectorConfig): Selection {
  const ix = indexDocument(doc);
  const warnings: string[] = [];
  let matches: SelectionMatch[];
  switch (config.mode) {
    case 'css':
      matches = selectCss(ix, config.selector, warnings);
      break;
    case 'regex':
      matches = selectRegex(ix, config, warnings);
      break;
    case 'heading':
      matches = selectHeading(ix, config, warnings);
      break;
    case 'jsonField':
      matches = selectJsonField(ix, config.path, warnings);
      break;
    case 'manual':
      matches = selectManual(ix, config, warnings);
      break;
    default:
      warnings.push(`Unknown selector mode "${(config as { mode: string }).mode}"`);
      matches = [];
  }
  if (matches.length > MAX_MATCHES) {
    warnings.push(`Only the first ${MAX_MATCHES} of ${matches.length} matches are used`);
    matches = matches.slice(0, MAX_MATCHES);
  }
  return { kind: 'selection', document: doc, matches, warnings };
}

const withText = (ix: DocIndex, match: Match): SelectionMatch => ({ match, text: textOf(ix, match) });

function selectCss(ix: DocIndex, selector: string, warnings: string[]): SelectionMatch[] {
  if (!selector.trim()) {
    warnings.push('CSS selector is empty');
    return [];
  }
  let found: Element[];
  try {
    found = selectAll(selector, ix.doc.tree);
  } catch (err) {
    warnings.push(`Invalid CSS selector: ${(err as Error).message.replace(/^css-selector-parser parse error: /, '')}`);
    return [];
  }
  if (found.length === 0) warnings.push(`"${selector}" matched nothing`);
  return found.map((el) => withText(ix, elementMatch(ix.pathOf.get(el)!)));
}

function selectRegex(ix: DocIndex, config: Extract<SelectorConfig, { mode: 'regex' }>, warnings: string[]): SelectionMatch[] {
  let regex: RegExp;
  try {
    const flags = [...new Set(((config.flags ?? '') + 'g').replace(/[^dgimsuvy]/g, '').replace('y', ''))].join('');
    regex = new RegExp(config.pattern, flags);
  } catch (err) {
    warnings.push(`Invalid regular expression: ${(err as Error).message}`);
    return [];
  }
  if (!config.pattern) {
    warnings.push('Regular expression is empty');
    return [];
  }
  const out: SelectionMatch[] = [];
  for (const m of ix.text.text.matchAll(regex)) {
    if (m[0].length === 0) continue;
    if (out.length > MAX_MATCHES) break;
    const start = m.index;
    if (config.scope === 'block') {
      const block = enclosingBlock(ix, start);
      if (block && !out.some((o) => sameMatch(o.match, block))) out.push(withText(ix, block));
    } else {
      out.push({ match: { kind: 'text', start, end: start + m[0].length }, text: m[0] });
    }
  }
  if (out.length === 0) warnings.push(`/${config.pattern}/ matched nothing`);
  return out;
}

function selectHeading(ix: DocIndex, config: Extract<SelectorConfig, { mode: 'heading' }>, warnings: string[]): SelectionMatch[] {
  const wanted = config.text.trim().toLowerCase();
  if (!wanted) {
    warnings.push('Heading text is empty');
    return [];
  }
  const out: SelectionMatch[] = [];
  for (const { el, path } of ix.elements) {
    const level = headingLevel(el);
    if (!level || (config.level && level !== config.level)) continue;
    const text = textOf(ix, elementMatch(path)).trim().toLowerCase();
    if (config.match === 'exact' ? text !== wanted : !text.includes(wanted)) continue;
    const section = sectionMatch(ix, path, config.includeHeading ?? true);
    if (section) out.push(withText(ix, section));
    else warnings.push(`Heading "${config.text}" has no content under it`);
  }
  if (out.length === 0 && !warnings.length) warnings.push(`No heading matches "${config.text}"`);
  return out;
}

function selectJsonField(ix: DocIndex, path: string, warnings: string[]): SelectionMatch[] {
  const json = ix.doc.meta.json;
  if (!json) {
    warnings.push('JSON field selectors only work on .json sources');
    return [];
  }
  if (json.mapping.mode === 'template') {
    warnings.push('This JSON source uses a template, so it has no field blocks to select');
    return [];
  }
  const query = queryJsonPaths(json.data, path);
  if ('error' in query) {
    warnings.push(`${path}: ${query.error}`);
    return [];
  }
  const wanted = new Set(query.matches.map((m) => m.path));
  const out = ix.elements
    .filter(({ el }) => typeof el.properties.dataJsonPath === 'string' && wanted.has(el.properties.dataJsonPath))
    .map(({ path: p }) => withText(ix, elementMatch(p)));
  if (out.length === 0) {
    warnings.push(query.matches.length ? `${path}: matched fields that are not mapped into the document` : `${path}: matched nothing`);
  }
  return out;
}

function selectManual(ix: DocIndex, config: Extract<SelectorConfig, { mode: 'manual' }>, warnings: string[]): SelectionMatch[] {
  const out: SelectionMatch[] = [];
  for (const r of resolveAnchors(ix, config.anchors, config)) {
    if (!r.match) {
      warnings.push(`Selection ${r.anchorId} needs attention: ${r.reason}`);
      continue;
    }
    out.push({ ...withText(ix, r.match), anchorId: r.anchorId, status: r.status, confidence: r.confidence });
  }
  return out;
}
