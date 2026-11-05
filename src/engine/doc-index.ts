// Lookups shared by selectors and anchors: element paths, text ranges of nodes, sections and blocks.
import type { Element, Nodes } from 'hast';
import { BLOCK_TAGS, buildTextIndex, locate, nodeAtPath, visitElements, type TextIndex } from './document';
import type { CmsDocument, Match, NodeMatch } from './types';

export interface DocIndex {
  doc: CmsDocument;
  text: TextIndex;
  /** Path of every element, in document order. */
  elements: { el: Element; path: number[] }[];
  pathOf: Map<Element, number[]>;
  /** Text range covered by each node that holds text, keyed by its path ("0.2.1"). */
  ranges: Map<string, { start: number; end: number }>;
}

const key = (path: number[]) => path.join('.');

export function indexDocument(doc: CmsDocument): DocIndex {
  const text = buildTextIndex(doc.tree);
  const elements: DocIndex['elements'] = [];
  const pathOf = new Map<Element, number[]>();
  visitElements(doc.tree, (el, path) => {
    elements.push({ el, path });
    pathOf.set(el, path);
  });
  const ranges = new Map<string, { start: number; end: number }>();
  for (const seg of text.segments) {
    for (let depth = 1; depth <= seg.path.length; depth++) {
      const k = key(seg.path.slice(0, depth));
      const r = ranges.get(k);
      if (r) r.end = seg.end;
      else ranges.set(k, { start: seg.start, end: seg.end });
    }
  }
  return { doc, text, elements, pathOf, ranges };
}

export function childrenAt(ix: DocIndex, parent: number[]): Nodes[] | undefined {
  const node = nodeAtPath(ix.doc.tree, parent);
  return node && 'children' in node ? (node.children as Nodes[]) : undefined;
}

/** Text range of a match. Node runs without any text get an empty range where they sit, when that can be found. */
export function rangeOf(ix: DocIndex, match: Match): { start: number; end: number } | undefined {
  if (match.kind === 'text') return { start: match.start, end: match.end };
  let start = Infinity;
  let end = -Infinity;
  for (let i = match.start; i < match.end; i++) {
    const r = ix.ranges.get(key([...match.parent, i]));
    if (r) {
      start = Math.min(start, r.start);
      end = Math.max(end, r.end);
    }
  }
  if (start !== Infinity) return { start, end };
  // No text inside (an image, an empty cell): an empty range where the next text in the document starts.
  const pos = positionOf(ix, [...match.parent, match.start]);
  return { start: pos, end: pos };
}

const comparePaths = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** Offset of the first text at or after a node (in document order), or the end of the text. */
export function positionOf(ix: DocIndex, path: number[]): number {
  const segs = ix.text.segments;
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (comparePaths(segs[mid].path, path) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo < segs.length ? segs[lo].start : ix.text.text.length;
}

export function textOf(ix: DocIndex, match: Match): string {
  const r = rangeOf(ix, match);
  return r ? ix.text.text.slice(r.start, r.end) : '';
}

export const CONTEXT_LENGTH = 32;

export function contextOf(ix: DocIndex, range: { start: number; end: number }) {
  return {
    prefix: ix.text.text.slice(Math.max(0, range.start - CONTEXT_LENGTH), range.start),
    suffix: ix.text.text.slice(range.end, range.end + CONTEXT_LENGTH),
  };
}

export function elementMatch(path: number[]): NodeMatch {
  return { kind: 'nodes', parent: path.slice(0, -1), start: path[path.length - 1], end: path[path.length - 1] + 1 };
}

export const headingLevel = (node: Nodes | undefined) =>
  node?.type === 'element' && /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0;

/** A heading plus every following sibling up to the next heading of the same or a higher level. */
export function sectionMatch(ix: DocIndex, headingPath: number[], includeHeading = true): NodeMatch | undefined {
  const parent = headingPath.slice(0, -1);
  const index = headingPath[headingPath.length - 1];
  const siblings = childrenAt(ix, parent);
  const level = headingLevel(siblings?.[index]);
  if (!siblings || !level) return undefined;
  let end = index + 1;
  while (end < siblings.length) {
    const l = headingLevel(siblings[end]);
    if (l && l <= level) break;
    end++;
  }
  const start = includeHeading ? index : index + 1;
  return start < end ? { kind: 'nodes', parent, start, end } : undefined;
}

/** The nearest block element around a text offset (or the text node's top-level ancestor). */
export function enclosingBlock(ix: DocIndex, offset: number): NodeMatch | undefined {
  const loc = locate(ix.text, offset);
  if (!loc) return undefined;
  const path = loc.segment.path;
  for (let depth = path.length - 1; depth >= 1; depth--) {
    const node = nodeAtPath(ix.doc.tree, path.slice(0, depth));
    if (node?.type === 'element' && BLOCK_TAGS.has(node.tagName)) return elementMatch(path.slice(0, depth));
  }
  return elementMatch(path.slice(0, 1));
}

export function sameMatch(a: Match, b: Match): boolean {
  if (a.kind !== b.kind || a.start !== b.start || a.end !== b.end) return false;
  return a.kind === 'text' || key(a.parent) === key((b as NodeMatch).parent);
}
