// Selector modes: pick parts of a document by CSS, regex, heading section, JSON field, or stored anchors.
import type { Element } from 'hast';
import { selectAll } from 'hast-util-select';
import { resolveAnchors, type ResolveOptions } from './anchors';
import { childrenAt, elementMatch, enclosingBlock, headingLevel, imagesOf, imageWithFrame, indexDocument, sameMatch, sectionMatch, slidesOf, textOf, type DocIndex } from './doc-index';
import { parseSlideRange } from './pptx';
import { queryJsonPaths } from './json';
import type { InsertionPoint } from './insert';
import type { Anchor, CmsDocument, Match, NodeMatch, Selection, SelectionMatch } from './types';

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
  | {
      mode: 'all';
      /** "document" (default): everything as one match. "blocks": each top-level block as its own match. */
      scope?: 'document' | 'blocks';
    }
  | {
      /** A point picked in the preview (where an Object goes); as a selection, the text next to it. */
      mode: 'point';
      point?: InsertionPoint;
    }
  | {
      mode: 'slide';
      /** Slide numbers in the deck, e.g. "2-5, 8". Empty: every slide. */
      slides?: string;
      /** Only slides whose title contains this (case-insensitive). */
      title?: string;
      /** What of each slide: all of it (default), its title, its content (without title and notes), its notes. */
      part?: SlidePart;
    }
  | {
      mode: 'image';
      /** Image numbers in document order, e.g. "1, 3-4". Empty: every image. */
      images?: string;
      /** Only images whose alternative text or file name contains this (case-insensitive). */
      text?: string;
      /** "image" (default): the <img> alone. "frame": with the link, <picture> and <figure> (and caption) around it. */
      scope?: 'image' | 'frame';
    }
  | ({ mode: 'manual'; anchors: Anchor[] } & ResolveOptions);

export type SelectorMode = SelectorConfig['mode'];
export type SlidePart = 'slide' | 'title' | 'content' | 'notes';

/**
 * Neighbouring matches (sibling runs with nothing but whitespace between them) as one match, so one wrapper goes
 * around all of them. Other matches stay as they are.
 */
export function joinMatches(selection: Selection): Selection {
  const ix = indexDocument(selection.document);
  const out: SelectionMatch[] = [];
  for (const m of selection.matches) {
    const prev = out[out.length - 1];
    if (prev && prev.match.kind === 'nodes' && m.match.kind === 'nodes' && prev.match.parent.join() === m.match.parent.join()) {
      const siblings = childrenAt(ix, m.match.parent) ?? [];
      const between = siblings.slice(prev.match.end, m.match.start);
      if (m.match.start >= prev.match.end && between.every((n) => n.type === 'text' && !n.value.trim())) {
        const match: NodeMatch = { ...prev.match, end: m.match.end };
        out[out.length - 1] = withText(ix, match);
        continue;
      }
    }
    out.push(m);
  }
  return { ...selection, matches: out };
}

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
    case 'all':
      matches = selectEverything(ix, config.scope ?? 'document', warnings);
      break;
    case 'slide':
      matches = selectSlides(ix, config, warnings);
      break;
    case 'image':
      matches = selectImages(ix, config, warnings);
      break;
    case 'point': {
      const r = config.point ? resolveAnchors(ix, [config.point.anchor])[0] : undefined;
      if (config.point && !r?.match) warnings.push(`The point needs attention: ${r?.reason ?? 'not found'}`);
      matches = r?.match ? [{ ...withText(ix, r.match), anchorId: r.anchorId, status: r.status, confidence: r.confidence }] : [];
      break;
    }
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

/** The whole document as one run of its top-level nodes, or each top-level element on its own. */
function selectEverything(ix: DocIndex, scope: 'document' | 'blocks', warnings: string[]): SelectionMatch[] {
  const children = ix.doc.tree.children;
  const isBlank = (n: (typeof children)[number]) => n.type === 'text' && !n.value.trim();
  if (children.every((n) => isBlank(n) || n.type === 'comment')) {
    warnings.push('The document is empty');
    return [];
  }
  if (scope === 'blocks') {
    return children.flatMap((n, i) => (n.type === 'element' ? [withText(ix, elementMatch([i]))] : []));
  }
  // Leave out whitespace at the edges so a wrapper sits right around the content.
  let start = 0;
  let end = children.length;
  while (isBlank(children[start])) start++;
  while (isBlank(children[end - 1])) end--;
  return [withText(ix, { kind: 'nodes', parent: [], start, end })];
}

/** Slides from a .pptx by number and title: whole slides, their titles, their content or their notes. */
function selectSlides(ix: DocIndex, config: Extract<SelectorConfig, { mode: 'slide' }>, warnings: string[]): SelectionMatch[] {
  const slides = slidesOf(ix);
  if (slides.length === 0) {
    warnings.push('This document has no slides (slides come from a .pptx file)');
    return [];
  }
  const deckSize = ix.doc.meta.pptx?.slideCount ?? Math.max(...slides.map((s) => s.number));
  const range = parseSlideRange(config.slides, deckSize);
  warnings.push(...range.warnings);
  if (range.slides) {
    const present = new Set(slides.map((s) => s.number));
    const missing = [...range.slides].filter((n) => !present.has(n));
    if (missing.length) {
      warnings.push(`Slide${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the document (hidden, or left out in the Document Source)`);
    }
  }
  const words = config.title?.trim().toLowerCase();
  const picked = slides.filter((s) => (!range.slides || range.slides.has(s.number)) && (!words || (s.title ?? '').toLowerCase().includes(words)));
  if (picked.length === 0) {
    if (!warnings.length) warnings.push(words ? `No slide title contains "${config.title!.trim()}"` : 'No slides chosen');
    return [];
  }
  const part = config.part ?? 'slide';
  const matches: SelectionMatch[] = [];
  const lacking: number[] = [];
  for (const s of picked) {
    let match: Match | undefined;
    if (part === 'slide') match = elementMatch(s.path);
    else if (part === 'title') match = s.titlePath && elementMatch(s.titlePath);
    else if (part === 'notes') match = s.notesPath && elementMatch(s.notesPath);
    else {
      // Everything between the title and the notes, as one run of the slide's children.
      const kids = s.el.children;
      const skip = new Set([s.titlePath?.at(-1), s.notesPath?.at(-1)]);
      const keep = kids.map((c, i) => (!skip.has(i) && !(c.type === 'text' && !c.value.trim()) ? i : -1)).filter((i) => i >= 0);
      if (keep.length) match = { kind: 'nodes', parent: s.path, start: keep[0], end: keep[keep.length - 1] + 1 };
    }
    if (match) matches.push(withText(ix, match));
    else lacking.push(s.number);
  }
  if (lacking.length) {
    const what = part === 'title' ? 'a title' : part === 'notes' ? 'speaker notes' : 'content besides its title';
    warnings.push(`Slide${lacking.length === 1 ? '' : 's'} ${lacking.join(', ')} ${lacking.length === 1 ? 'has' : 'have'} no ${what}`);
  }
  return matches;
}

/** Images by number, by their alternative text or file name, alone or with their link / figure. */
function selectImages(ix: DocIndex, config: Extract<SelectorConfig, { mode: 'image' }>, warnings: string[]): SelectionMatch[] {
  const images = imagesOf(ix);
  if (images.length === 0) {
    warnings.push('This document has no images');
    return [];
  }
  const range = parseSlideRange(config.images, images.length, { item: 'image', whole: 'The document' });
  warnings.push(...range.warnings);
  const words = config.text?.trim().toLowerCase();
  const fileName = (src: string) => (src.startsWith('data:') ? '' : decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? ''));
  const picked = images.filter(
    (img) => (!range.slides || range.slides.has(img.number)) && (!words || img.alt.toLowerCase().includes(words) || fileName(img.src).toLowerCase().includes(words)),
  );
  if (picked.length === 0 && !warnings.length) warnings.push(`No image's alternative text or file name contains "${config.text!.trim()}"`);
  const out: SelectionMatch[] = [];
  for (const img of picked) {
    const match = elementMatch(config.scope === 'frame' ? imageWithFrame(ix, img.path) : img.path);
    if (!out.some((o) => sameMatch(o.match, match))) out.push(withText(ix, match));
  }
  return out;
}

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
      warnings.push(`A saved selection needs attention: ${r.reason}`);
      continue;
    }
    out.push({ ...withText(ix, r.match), anchorId: r.anchorId, status: r.status, confidence: r.confidence });
  }
  return out;
}
