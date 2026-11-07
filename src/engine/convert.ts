// Turning any value that travels along a connection (document, result, selection, point, HTML) into the others.
// Used by the Connector, the Combinator and the Extractor.
import type { ElementContent } from 'hast';
import { parseHtml, serialize } from './document';
import { copySelection, insertionTargets, type PointValue } from './insert';
import { runSelector } from './selectors';
import type { CmsDocument, Selection } from './types';

export type ValueKind = 'document' | 'selection' | 'point' | 'html';

export const valueKind = (value: unknown): ValueKind =>
  typeof value === 'string'
    ? 'html'
    : (value as { kind?: string })?.kind === 'selection'
      ? 'selection'
      : (value as { kind?: string })?.kind === 'point'
        ? 'point'
        : 'document';

export interface ConvertOptions {
  /** A selection as a document: a new document of what it selected (default), or the whole document it is in. */
  selectionToDocument?: 'content' | 'document';
  /** A document as a selection: all of it as one match (default), or each top-level block as a match. */
  documentToSelection?: 'document' | 'blocks';
  /** HTML out: a complete page with styles and snippet scripts (default), or only the body content. */
  fullPage?: boolean;
}

export interface Converted {
  kind: ValueKind;
  document: CmsDocument;
  selection: Selection;
  html: string;
  warnings: string[];
}

/** A new document of only what a selection picked (in document order; it keeps its look, not its JSON fields). */
export async function documentFromSelection(selection: Selection, options: { context?: boolean } = {}): Promise<{ document: CmsDocument; warnings: string[] }> {
  const copy = await copySelection(selection, options);
  const source = selection.document;
  return {
    document: {
      kind: 'document',
      tree: { type: 'root', children: copy.nodes as ElementContent[] },
      meta: { ...source.meta, json: undefined, pptx: undefined, warnings: [], snippetAssets: copy.snippetAssets },
      assets: Object.fromEntries(copy.assets.map((a) => [a.id, a])),
    },
    warnings: copy.warnings,
  };
}

/** The places a point stands for, as a selection (the picked text, or the Selector's matches). */
export function selectionAtPoint(point: PointValue): Selection {
  const t = insertionTargets(point.document, point.where, false);
  return { kind: 'selection', document: point.document, matches: t.matches.map((match) => ({ match, text: '' })), warnings: t.warnings };
}

export const selectEverything = (doc: CmsDocument, options: ConvertOptions) =>
  runSelector(doc, { mode: 'all', scope: options.documentToSelection === 'blocks' ? 'blocks' : 'document' });

export async function convertValue(value: unknown, options: ConvertOptions = {}): Promise<Converted> {
  const kind = valueKind(value);
  const warnings: string[] = [];
  let document: CmsDocument;
  let selection: Selection;
  let html: string | undefined;
  if (kind === 'selection' || kind === 'point') {
    selection = kind === 'point' ? selectionAtPoint(value as PointValue) : (value as Selection);
    if (kind === 'point' || (options.selectionToDocument ?? 'content') === 'document') document = selection.document;
    else {
      const made = await documentFromSelection(selection);
      document = made.document;
      warnings.push(...made.warnings);
    }
  } else {
    if (kind === 'html') {
      html = value as string;
      document = parseHtml(html);
      warnings.push(...document.meta.warnings);
    } else document = value as CmsDocument;
    selection = selectEverything(document, options);
    warnings.push(...selection.warnings);
  }
  // HTML that came in goes out as it was; anything else is written out.
  html ??= serialize(document, { fullDocument: options.fullPage ?? true, inlineAssets: true });
  return { kind, document, selection, html, warnings };
}
