// Anchors: stored pointers to part of a document that can be found again after the document changes.
//
// Every anchor keeps a text quote (the selected text plus a little context before and after) and,
// where they apply, a structural path, a CSS path, a heading and a JSON field path.
// Resolving tries the cheap strategies first and checks each result against the quote; when they
// fail, it searches the whole document, first for the exact text and then for close matches.
import type { Element } from 'hast';
import { selectAll } from 'hast-util-select';
import {
  childrenAt, contextOf, elementMatch, headingLevel, imagesOf, imageWithFrame, indexDocument, rangeOf, sameMatch, sectionMatch, slideAt, slidesOf, textOf,
  type DocIndex, type SlideInfo,
} from './doc-index';
import { allIndexesOf, contextSimilarity, fuzzyFind, similarity } from './text-match';
import { hashString } from './hash';
import type { Anchor, CmsDocument, Match, NodeMatch, ResolveStatus, TextMatch } from './types';

export interface CreateAnchorOptions {
  id?: string;
}

// randomUUID only exists on secure pages (https, localhost), so fall back to Math.random elsewhere.
const newId = () =>
  `anchor-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;

/** Create an anchor for a match (from a selector, or from text the user highlighted). */
export function createAnchor(source: CmsDocument | DocIndex, match: Match, options: CreateAnchorOptions = {}): Anchor {
  const ix = 'kind' in source ? indexDocument(source) : source;
  const range = rangeOf(ix, match) ?? { start: 0, end: 0 };
  const anchor: Anchor = {
    id: options.id ?? newId(),
    target: match.kind,
    textQuote: { exact: ix.text.text.slice(range.start, range.end), ...contextOf(ix, range) },
    textPosition: range,
  };
  const slide = slideAt(ix, range.start);
  if (slide) anchor.slide = { number: slide.number, ...(slide.title ? { title: slide.title } : {}) };

  if (match.kind === 'nodes') {
    const siblings = childrenAt(ix, match.parent) ?? [];
    const first = siblings[match.start];
    const tagName = first?.type === 'element' ? first.tagName : '#text';
    anchor.structural = { parent: match.parent, start: match.start, end: match.end, tagName };
    if (first?.type === 'element') {
      const path = [...match.parent, match.start];
      anchor.css = cssPathFor(ix, path);
      const level = headingLevel(first);
      if (level) {
        const section = sectionMatch(ix, path);
        const scope = match.end - match.start === 1 ? 'block' : section && sameMatch(section, match) ? 'section' : undefined;
        if (scope) anchor.semantic = { headingText: textOf(ix, elementMatch(path)), level, scope };
      }
      if (match.end - match.start === 1) {
        const image = imageAt(ix, path);
        if (image) anchor.image = { src: imageKey(image.src), alt: image.alt, number: image.number };
      }
      const jsonPath = first.properties.dataJsonPath;
      if (typeof jsonPath === 'string' && match.end - match.start === 1) anchor.jsonPath = { path: jsonPath };
    }
  } else {
    const block = jsonBlockAround(ix, range.start);
    if (block && block.range.end >= range.end) anchor.jsonPath = { path: block.path };
  }
  return anchor;
}

export interface ResolveOptions {
  /** Below this score an anchor counts as failed. Default 0.75. */
  minConfidence?: number;
}

export interface ResolvedAnchor {
  anchorId: string;
  status: ResolveStatus;
  /** 0 to 1. */
  confidence: number;
  match?: Match;
  /** Which strategy found it: structural, css, jsonPath, semantic, position, quote or fuzzy. */
  strategy?: string;
  /** Why it failed. */
  reason?: string;
}

interface Candidate {
  match: Match;
  strategy: string;
  textSim: number;
  ctxSim: number;
  samePlace: boolean;
  distance: number;
  /** For anchors on a slide: whether this candidate is on the same slide (same title, or same number untitled). */
  sameSlide: boolean;
}

/** On a slide, an anchor found on another slide (its own slide was deleted or renamed) is less certain. */
const OTHER_SLIDE_FACTOR = 0.85;

const score = (c: Candidate) => 0.8 * c.textSim + 0.2 * c.ctxSim;

/** Find an anchor again in a (possibly changed) document. */
export function resolveAnchor(source: CmsDocument | DocIndex, anchor: Anchor, options: ResolveOptions = {}): ResolvedAnchor {
  const ix = 'kind' in source ? indexDocument(source) : source;
  const minConfidence = options.minConfidence ?? 0.75;
  const quote = anchor.textQuote ?? { exact: '', prefix: '', suffix: '' };
  const originalStart = anchor.textPosition?.start ?? 0;
  /** The lowest text similarity that can still reach minConfidence (with perfect context). */
  const neededTextSim = Math.max(0, (minConfidence - 0.2) / 0.8);

  const slides: SlideInfo[] = anchor.slide ? slidesOf(ix) : [];
  const onSameSlide = (start: number) => {
    if (!anchor.slide) return true;
    const s = slideAt(ix, start, slides);
    return !!s && (anchor.slide.title ? s.title === anchor.slide.title : s.number === anchor.slide.number);
  };
  const candidates: Candidate[] = [];
  const consider = (match: Match | undefined, strategy: string, textSim?: number): Candidate | undefined => {
    if (!match) return undefined;
    const range = rangeOf(ix, match);
    if (!range) return undefined;
    const c: Candidate = {
      match,
      strategy,
      textSim: textSim ?? similarity(ix.text.text.slice(range.start, range.end), quote.exact),
      ctxSim: contextSimilarity(quote, contextOf(ix, range)),
      samePlace: isSamePlace(anchor, match, range),
      distance: Math.abs(range.start - originalStart),
      sameSlide: onSameSlide(range.start),
    };
    candidates.push(c);
    return c;
  };
  const done = (c: Candidate, status: ResolveStatus, confidence: number): ResolvedAnchor => ({
    anchorId: anchor.id,
    status,
    confidence: round(confidence),
    match: c.match,
    strategy: c.strategy,
  });
  /** Exact text: 0.8, plus up to 0.2 for matching context (less when it is on another slide). */
  const found = (c: Candidate) =>
    done(c, c.samePlace && c.sameSlide ? 'exact' : 'moved', (0.8 + 0.2 * c.ctxSim) * (c.sameSlide ? 1 : OTHER_SLIDE_FACTOR));
  /** Same text with fitting context (on the same slide): accept straight away. */
  const accept = (c: Candidate | undefined) => (c && c.textSim === 1 && c.ctxSim >= 0.5 && c.sameSlide ? found(c) : undefined);

  if (anchor.target === 'nodes' && anchor.image) return resolveImage(ix, anchor, minConfidence);
  if (anchor.target === 'nodes') {
    const quick =
      accept(consider(structuralMatch(ix, anchor), 'structural')) ??
      accept(consider(cssMatch(ix, anchor), 'css')) ??
      accept(consider(jsonPathNodeMatch(ix, anchor), 'jsonPath'));
    if (quick) return quick;

    // A heading section keeps its meaning when content inside it changes, so the heading decides.
    if (anchor.semantic) {
      const hit = findHeading(ix, anchor.semantic.headingText, anchor.semantic.level);
      if (hit) {
        const match = anchor.semantic.scope === 'section' ? sectionMatch(ix, hit.path) : elementMatch(hit.path);
        const c = consider(match, 'semantic');
        if (c && (c.textSim === 1 || hit.sim === 1)) {
          if (c.textSim === 1) return found(c);
          return done(c, 'fuzzy', Math.max(0.85 * hit.sim, score(c)));
        }
      }
    }

    // Search every element with the same tag, taking runs as long as the original.
    // Identical text first (cheap); only when there is none, score how close each one is.
    const tagName = anchor.structural?.tagName;
    const length = anchor.structural ? anchor.structural.end - anchor.structural.start : 1;
    const runs: { match: NodeMatch; text: string }[] = [];
    for (const { el, path } of ix.elements) {
      if (el.tagName !== tagName) continue;
      const siblings = childrenAt(ix, path.slice(0, -1)) ?? [];
      const start = path[path.length - 1];
      const match: NodeMatch = { kind: 'nodes', parent: path.slice(0, -1), start, end: Math.min(siblings.length, start + length) };
      runs.push({ match, text: textOf(ix, match) });
    }
    const identical = runs.filter((r) => r.text === quote.exact);
    if (identical.length) for (const r of identical) consider(r.match, 'quote', 1);
    else {
      for (const r of runs) {
        const sim = similarity(r.text, quote.exact, neededTextSim);
        if (sim >= neededTextSim) consider(r.match, 'quote', sim);
      }
    }
  } else {
    const pos = anchor.textPosition;
    const quick = pos ? accept(consider({ kind: 'text', start: pos.start, end: pos.end }, 'position')) : undefined;
    if (quick) return quick;

    if (quote.exact) {
      // Exact text, inside the original JSON field first, then anywhere.
      const block = anchor.jsonPath && jsonBlockByPath(ix, anchor.jsonPath.path);
      const inBlock = block ? allIndexesOf(ix.text.text.slice(block.start, block.end), quote.exact).map((i) => i + block.start) : [];
      for (const i of inBlock) consider(textMatch(i, i + quote.exact.length), 'jsonPath', 1);
      for (const i of allIndexesOf(ix.text.text, quote.exact)) {
        if (!inBlock.includes(i)) consider(textMatch(i, i + quote.exact.length), 'quote', 1);
      }
      const exact = best(candidates.filter((c) => c.textSim === 1));
      if (exact) return found(exact);

      // Close matches, for small edits such as a fixed typo. Very short quotes are too ambiguous.
      if (quote.exact.length >= 4) {
        const maxDistance = Math.floor(quote.exact.length * 0.25);
        for (const hit of fuzzyFind(ix.text.text, quote.exact, maxDistance)) {
          consider(textMatch(hit.start, hit.end), 'fuzzy', 1 - hit.distance / quote.exact.length);
        }
      }
    }
  }

  // Identical text always beats similar text, even when its surroundings changed more.
  const identical = best(candidates.filter((c) => c.textSim === 1));
  if (identical) return found(identical);
  // Close matches: the anchor's slide first, but only among those good enough.
  const adjusted = (c: Candidate) => score(c) * (c.sameSlide ? 1 : OTHER_SLIDE_FACTOR);
  const good = best(candidates.filter((c) => adjusted(c) >= minConfidence));
  if (good) return done(good, 'fuzzy', adjusted(good));
  const top = best(candidates);
  return {
    anchorId: anchor.id,
    status: 'failed',
    confidence: top ? round(score(top)) : 0,
    reason:
      top && score(top) >= 0.5
        ? `Closest match "${shorten(textOf(ix, top.match))}" is too different from "${shorten(quote.exact)}"`
        : `"${shorten(quote.exact)}" was not found`,
  };
}

/** Long addresses (data: URLs) are stored as a hash. */
const imageKey = (src: string) => (src.length > 300 ? `#${hashString(src)}` : src);

/** The image an element is: an <img>, or a link / figure / picture holding one image and its caption. */
function imageAt(ix: DocIndex, path: number[]) {
  const key = path.join('.');
  return imagesOf(ix).find((img) => img.path.join('.') === key || imageWithFrame(ix, img.path).join('.') === key);
}

/**
 * Images have no text to search for: find the one with the same address (the one at the same place, then the
 * one with the same number, then the closest), else one with the same alternative text.
 */
function resolveImage(ix: DocIndex, anchor: Anchor, minConfidence: number): ResolvedAnchor {
  const want = anchor.image!;
  const framed = anchor.structural?.tagName !== 'img';
  const images = imagesOf(ix).map((img) => ({ img, match: elementMatch(framed ? imageWithFrame(ix, img.path) : img.path) }));
  const s = anchor.structural;
  const samePlace = (m: NodeMatch) => !!s && sameMatch(m, { kind: 'nodes', parent: s.parent, start: s.start, end: s.end });
  const closest = (list: typeof images) =>
    [...list].sort((a, b) => Number(samePlace(b.match)) - Number(samePlace(a.match)) || Math.abs(a.img.number - want.number) - Math.abs(b.img.number - want.number))[0];
  const same = closest(images.filter(({ img }) => imageKey(img.src) === want.src && (want.src !== '' || img.alt === want.alt)));
  const result = (hit: (typeof images)[number], status: ResolveStatus, confidence: number, strategy: string): ResolvedAnchor => ({
    anchorId: anchor.id,
    status,
    confidence,
    match: hit.match,
    strategy,
  });
  if (same) return samePlace(same.match) ? result(same, 'exact', 1, 'image') : result(same, 'moved', 0.9, 'image');
  const byAlt = want.alt.trim() ? closest(images.filter(({ img }) => img.alt === want.alt)) : undefined;
  if (byAlt && 0.8 >= minConfidence) return result(byAlt, 'fuzzy', 0.8, 'image');
  const name = want.alt.trim() || (want.src.startsWith('#') ? `image ${want.number}` : want.src.split('/').pop());
  return { anchorId: anchor.id, status: 'failed', confidence: 0, reason: `The image "${shorten(name ?? '')}" was not found` };
}

/** Resolve several anchors against one document (indexed once). */
export function resolveAnchors(doc: CmsDocument | DocIndex, anchors: Anchor[], options: ResolveOptions = {}): ResolvedAnchor[] {
  const ix = 'kind' in doc ? indexDocument(doc) : doc;
  return anchors.map((a) => resolveAnchor(ix, a, options));
}

// ---------------------------------------------------------------------------------------------

/** The best candidate: on the anchor's slide first, then the highest score, then the closest to where it was. */
function best(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort((a, b) => Number(b.sameSlide) - Number(a.sameSlide) || score(b) - score(a) || a.distance - b.distance)[0];
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const shorten = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s).replace(/\n/g, ' ');
const textMatch = (start: number, end: number): TextMatch => ({ kind: 'text', start, end });

function isSamePlace(anchor: Anchor, match: Match, range: { start: number; end: number }): boolean {
  if (match.kind === 'nodes') {
    const s = anchor.structural;
    return !!s && sameMatch(match, { kind: 'nodes', parent: s.parent, start: s.start, end: s.end });
  }
  return anchor.textPosition?.start === range.start && anchor.textPosition?.end === range.end;
}

function structuralMatch(ix: DocIndex, anchor: Anchor): NodeMatch | undefined {
  const s = anchor.structural;
  if (!s) return undefined;
  const siblings = childrenAt(ix, s.parent);
  const first = siblings?.[s.start];
  if (!siblings || s.end > siblings.length || !first) return undefined;
  const tagName = first.type === 'element' ? first.tagName : '#text';
  return tagName === s.tagName ? { kind: 'nodes', parent: s.parent, start: s.start, end: s.end } : undefined;
}

function cssMatch(ix: DocIndex, anchor: Anchor): NodeMatch | undefined {
  if (!anchor.css) return undefined;
  let found: Element[];
  try {
    found = selectAll(anchor.css.selector, ix.doc.tree);
  } catch {
    return undefined;
  }
  const el = found.find((e) => anchor.css!.depth === undefined || ix.pathOf.get(e)?.length === anchor.css!.depth);
  const path = el && ix.pathOf.get(el);
  if (!path) return undefined;
  const length = anchor.structural ? anchor.structural.end - anchor.structural.start : 1;
  const siblings = childrenAt(ix, path.slice(0, -1)) ?? [];
  const start = path[path.length - 1];
  return { kind: 'nodes', parent: path.slice(0, -1), start, end: Math.min(siblings.length, start + length) };
}

function jsonPathNodeMatch(ix: DocIndex, anchor: Anchor): NodeMatch | undefined {
  if (!anchor.jsonPath) return undefined;
  const hit = ix.elements.find(({ el }) => el.properties.dataJsonPath === anchor.jsonPath!.path);
  return hit ? elementMatch(hit.path) : undefined;
}

function jsonBlockByPath(ix: DocIndex, path: string) {
  const hit = ix.elements.find(({ el }) => el.properties.dataJsonPath === path);
  return hit ? rangeOf(ix, elementMatch(hit.path)) : undefined;
}

/** The JSON field block containing a text offset, if any. */
function jsonBlockAround(ix: DocIndex, offset: number) {
  for (const { el, path } of ix.elements) {
    const jsonPath = el.properties.dataJsonPath;
    if (typeof jsonPath !== 'string') continue;
    const range = rangeOf(ix, elementMatch(path));
    if (range && range.start <= offset && offset < range.end) return { path: jsonPath, range };
  }
  return undefined;
}

/** The heading with this text (exactly, or the closest one above 0.8), preferring the same level. */
function findHeading(ix: DocIndex, text: string, level: number) {
  let found: { path: number[]; sim: number } | undefined;
  for (const { el, path } of ix.elements) {
    const l = headingLevel(el);
    if (!l) continue;
    const sim = similarity(textOf(ix, elementMatch(path)), text) - (l === level ? 0 : 0.1);
    if (sim >= 0.8 && (!found || sim > found.sim)) found = { path, sim };
  }
  return found;
}

/** A CSS path to an element: from the nearest ancestor with an id, or from the top with a depth check. */
export function cssPathFor(ix: DocIndex, path: number[]): { selector: string; depth?: number } {
  const parts: string[] = [];
  let fromId = false;
  for (let depth = 1; depth <= path.length; depth++) {
    const siblings = childrenAt(ix, path.slice(0, depth - 1)) ?? [];
    const node = siblings[path[depth - 1]];
    if (node?.type !== 'element') break;
    const id = node.properties.id;
    if (typeof id === 'string' && id) {
      parts.length = 0;
      parts.push(/^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : `[id="${id.replace(/["\\]/g, '\\$&')}"]`);
      fromId = true;
      continue;
    }
    const nth = siblings.slice(0, path[depth - 1] + 1).filter((s) => s.type === 'element' && s.tagName === node.tagName).length;
    parts.push(`${node.tagName}:nth-of-type(${nth})`);
  }
  return fromId ? { selector: parts.join(' > ') } : { selector: parts.join(' > '), depth: path.length };
}
