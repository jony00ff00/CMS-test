import type { ElementContent } from 'hast';
import { convertValue, selectionAtPoint, valueKind } from '../convert';
import { parseHtml } from '../document';
import type { NodeDefinition, NodeOutput } from '../graph';
import {
  buildInsertion, contentAlone, copyContent, describeInsertion, insertContent, removeSelection, replaceSelection, replaceWithContent, withPlace,
  type InsertContent, type InsertionPoint, type InsertPlace, type InsertWhere, type PointValue,
} from '../insert';
import type { SelectorConfig } from '../selectors';
import type { CmsDocument, Selection } from '../types';

/**
 * Where the content goes, relative to what comes into Where: next to it (before / after / start / end), or in its
 * place ("replace": the matched element or text; "inside": what is inside the matched element).
 */
export type ObjectPlace = InsertPlace | 'replace' | 'inside';

/** One of several items an Insert node puts in, each at its own place (e.g. three pictures in an article). */
export interface InsertItem {
  id: string;
  /** A name for the inspector and for problems ("Picture: hives"). */
  label?: string;
  /** Where it goes: next to every match of this selector (in the document coming into Where). */
  selector: SelectorConfig;
  place: InsertPlace;
  /** What it adds (not content from another node: each item holds its own). */
  content: Exclude<InsertContent, { kind: 'selection' }>;
}

export interface ObjectNodeConfig {
  /** What it adds: text, code, an image or video (uploaded or by address), or content from another node. */
  content: InsertContent;
  /**
   * Default: a Point's own place; for a Selection, "replace". A place here overrides a Point's.
   * With nothing connected to Content and "Content from another node", replace / inside remove what was matched.
   */
  place?: ObjectPlace;
  /** Replacing with content from another node: match i gets part i of it. */
  pairs?: boolean;
  /** A point picked in the preview, for when a whole document comes into Where. */
  point?: InsertionPoint;
  /** Several items, each with its own place and content (instead of `content` and `place`). */
  items?: InsertItem[];
}

const SEVERAL_TEXT = 'Content is connected but not used: choose "Content from another node" to add it';

/**
 * Adds content to a document: at a Point from a Selector, next to or in place of what a Selector selected, or at a
 * point picked in the preview. Without anything connected to Where, it gives its content alone, as a document.
 * (It was the Object node; Replace and Position nodes are this node now, see `parseProject`.)
 */
export const object: NodeDefinition<ObjectNodeConfig> = {
  type: 'object',
  label: 'Insert',
  description: 'Adds text, code, an image, a video or content from another node: at a point, next to a selection, or in its place',
  inputs: [
    // A Point (where a Selector says), a Selection (next to or in place of what it picked), or a document (a point
    // picked in the preview). Without it, the content alone.
    { name: 'where', type: 'any', label: 'Where', optional: true },
    // Only for "Content from another node": what to copy in.
    { name: 'content', type: 'any', label: 'Content', optional: true },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ content: { kind: 'imageUrl', url: '', alt: '' } }),
  // Uploaded images or videos are part of the result, so their content is part of the cache key.
  dependencies: (config, ctx) => {
    const ids = [config.content, ...(config.items ?? []).map((i) => i.content)].flatMap((c) => ('fileId' in c && c.fileId ? [c.fileId] : []));
    return ids.length ? ids.map((id) => ctx.files[id]?.hash ?? 'missing') : undefined;
  },
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const whereValue = inputs.where;
    const kind = whereValue === undefined ? 'none' : valueKind(whereValue);
    if (config.items?.length) return insertItems(whereValue, kind, config.items, ctx.files);

    // A document (or HTML) means all of it; a selection, what it picked.
    const converted = inputs.content === undefined ? undefined : await convertValue(inputs.content, { documentToSelection: config.pairs ? 'blocks' : 'document' });
    const selection: Selection | undefined = converted?.selection;
    const unused = selection && config.content.kind !== 'selection' ? [SEVERAL_TEXT] : [];
    const merge = (own: string[]) => [...(converted?.warnings ?? []).filter((w) => !own.includes(w)), ...own, ...unused];
    const info: Record<string, string | number> = { what: describeInsertion(config.content) };
    if (selection) info.from = selection.document.meta.fileName ?? 'another node';
    const outputs: Record<string, unknown> = {};
    // Not a port: what is inserted, for the preview's "Content" view.
    if (selection && config.content.kind === 'selection') outputs.content = await contentDocument(selection, config.content);

    if (kind === 'none') {
      const alone = await contentAlone(config.content, ctx.files, selection);
      if ('waiting' in alone) return { outputs: {}, waiting: alone.waiting };
      return { outputs: { ...outputs, document: alone.document }, warnings: merge(alone.warnings), info: { ...info, alone: 1 } };
    }

    // In place of what was matched: a Selection's matches, or the places a Point stands for.
    const place = config.place ?? (kind === 'selection' ? 'replace' : undefined);
    if ((place === 'replace' || place === 'inside') && (kind === 'selection' || kind === 'point')) {
      const target = kind === 'selection' ? (whereValue as Selection) : selectionAtPoint(whereValue as PointValue);
      const mode = { target: place === 'inside' ? ('inside' as const) : ('element' as const), pairs: config.pairs };
      if (config.content.kind === 'selection') {
        if (!selection) {
          const r = await removeSelection(target, mode);
          return { outputs: { document: r.document }, warnings: merge(r.warnings), info: { replaced: r.replaced, removed: true } };
        }
        const { kind: _k, ...options } = config.content;
        const r = await replaceSelection(target, selection, { ...options, ...mode });
        // Match by match with a different number of parts: some matches keep the old text, or some content is lost.
        const problems = config.pairs ? r.warnings.filter((w) => /^The content has \d+ part/.test(w)) : [];
        return {
          outputs: { ...outputs, document: r.document },
          warnings: merge(r.warnings.filter((w) => !problems.includes(w))),
          ...(problems.length && { problems }),
          info: { ...info, replaced: r.replaced },
        };
      }
      const built = buildInsertion(config.content, ctx.files);
      if ('waiting' in built) return { outputs: {}, waiting: built.waiting };
      if ('error' in built) throw new Error(built.error);
      const r = await replaceWithContent(target, built, mode);
      return { outputs: { document: r.document }, warnings: merge(r.warnings), info: { ...info, replaced: r.replaced } };
    }

    // Next to: a Point (its place, or this node's), a Selection's matches, or a point picked in the preview.
    let doc: CmsDocument;
    let where: InsertWhere;
    if (kind === 'point') {
      const point = whereValue as PointValue;
      doc = point.document;
      where = place && place !== 'replace' && place !== 'inside' ? withPlace(point.where, place) : point.where;
    } else if (kind === 'selection') {
      const sel = whereValue as Selection;
      doc = sel.document;
      where = { mode: 'matches', matches: sel.matches.map((m) => m.match), place: place as InsertPlace };
    } else {
      doc = kind === 'html' ? parseHtml(whereValue as string) : (whereValue as CmsDocument);
      if (!config.point) return { outputs: {}, waiting: 'Select this Insert node and click in the preview where the content goes' };
      where = { mode: 'point', point: config.point };
    }
    const result = await insertContent(doc, where, config.content, ctx.files, selection);
    if (result.waiting) return { outputs: {}, waiting: result.waiting };
    if (result.needsAttention) info.needsAttention = 1;
    return { outputs: { ...outputs, document: result.document }, warnings: merge(result.warnings), info: { ...info, inserted: result.inserted } };
  },
};

/** Several items into the document coming into Where, one after another, each at its own place. */
async function insertItems(whereValue: unknown, kind: string, items: InsertItem[], files: Parameters<typeof insertContent>[3]): Promise<NodeOutput> {
  if (kind === 'none') return { outputs: {}, waiting: 'Connect the document the items go into to Where' };
  let doc =
    kind === 'point' ? (whereValue as PointValue).document
    : kind === 'selection' ? (whereValue as Selection).document
    : kind === 'html' ? parseHtml(whereValue as string)
    : (whereValue as CmsDocument);
  const warnings: string[] = [];
  const problems: string[] = [];
  let inserted = 0;
  for (const [i, item] of items.entries()) {
    const name = `Item ${i + 1}${item.label ? ` (${item.label})` : ''}`;
    const r = await insertContent(doc, { mode: 'selector', selector: item.selector, place: item.place }, item.content, files);
    if (r.waiting) {
      warnings.push(`${name}: ${r.waiting}`);
      continue;
    }
    for (const w of r.warnings) if (!/matched nothing/.test(w)) warnings.push(`${name}: ${w}`);
    if (r.inserted === 0) problems.push(`${name}: its place was not found`);
    inserted += r.inserted;
    doc = r.document;
  }
  return { outputs: { document: doc }, warnings, ...(problems.length && { problems }), info: { items: items.length, inserted } };
}

/** A document of just the content added (wrapped and styled as it will be, headings not yet moved). */
async function contentDocument(selection: Selection, content: Extract<InsertContent, { kind: 'selection' }>): Promise<CmsDocument> {
  const built = await copyContent(selection, content);
  const source = selection.document;
  return {
    kind: 'document',
    tree: { type: 'root', children: built.nodes as ElementContent[] },
    meta: { origin: source.meta.origin, fileName: source.meta.fileName, styles: built.styles ?? [], warnings: [], snippetAssets: built.snippetAssets },
    assets: Object.fromEntries(built.assets.map((a) => [a.id, a])),
  };
}
