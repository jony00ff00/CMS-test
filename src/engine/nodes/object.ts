import type { ElementContent } from 'hast';
import { convertValue } from '../convert';
import type { NodeDefinition, NodeOutput } from '../graph';
import { contentAlone, copyContent, describeInsertion, insertContent, type InsertContent, type PointValue } from '../insert';
import type { CmsDocument, Selection } from '../types';

export interface ObjectNodeConfig {
  /** What the Object holds: code, an image or video (uploaded or by address), or selected content. */
  content: InsertContent;
}

/**
 * Holds content (code, image, video, linked image or video, or a copy of selected content) and puts it into a
 * document at a Point from a Selector: a point picked in the preview, or next to every match.
 */
export const object: NodeDefinition<ObjectNodeConfig> = {
  type: 'object',
  label: 'Object',
  description: 'Text, code, an image, a video or content from another node, added at a Point from a Selector (or on its own)',
  inputs: [
    // Without a Point, the Object gives its content alone, as a document of its own.
    { name: 'point', type: 'point', label: 'Point', optional: true },
    // Only for "Content from another node": what to copy in (a selection or a whole document, e.g. an
    // Extractor's), from this document or another one.
    { name: 'content', type: 'any', label: 'Content', optional: true },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ content: { kind: 'imageUrl', url: '', alt: '' } }),
  // An uploaded image or video is part of the result, so its content is part of the cache key.
  dependencies: (config, ctx) => {
    const fileId = 'fileId' in config.content ? config.content.fileId : undefined;
    return fileId ? (ctx.files[fileId]?.hash ?? 'missing') : undefined;
  },
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const point = inputs.point as PointValue | undefined;
    // A document (or HTML) means all of it; a selection, what it picked.
    const converted = inputs.content === undefined ? undefined : await convertValue(inputs.content);
    const selection: Selection | undefined = converted?.selection;
    if (!point) {
      const alone = await contentAlone(config.content, ctx.files, selection);
      if ('waiting' in alone) return { outputs: {}, waiting: alone.waiting };
      const warnings = [...(converted?.warnings ?? []).filter((w) => !alone.warnings.includes(w)), ...alone.warnings];
      if (selection && config.content.kind !== 'selection') warnings.push('Content is connected but not used: choose "Content from another node" to add it');
      const info: Record<string, string | number> = { what: describeInsertion(config.content), alone: 1 };
      if (selection) info.from = selection.document.meta.fileName ?? 'another node';
      const outputs: Record<string, unknown> = { document: alone.document };
      if (selection && config.content.kind === 'selection') outputs.content = alone.document;
      return { outputs, warnings, info };
    }
    const result = await insertContent(point.document, point.where, config.content, ctx.files, selection);
    if (result.waiting) return { outputs: {}, waiting: result.waiting };
    const info: Record<string, string | number> = { what: describeInsertion(config.content), inserted: result.inserted };
    if (result.needsAttention) info.needsAttention = 1;
    const warnings = [...(converted?.warnings ?? []).filter((w) => !result.warnings.includes(w)), ...result.warnings];
    if (selection && config.content.kind !== 'selection') warnings.push('Content is connected but not used: choose "Content from another node" to add it');
    const outputs: Record<string, unknown> = { document: result.document };
    // Not a port: what is inserted, for the preview's "Content" view.
    if (selection && config.content.kind === 'selection') outputs.content = await contentDocument(selection, config.content);
    if (selection) info.from = selection.document.meta.fileName ?? 'another node';
    return { outputs, warnings, info };
  },
};

/** A document of just the content an Object adds (wrapped and styled as it will be, headings not yet moved). */
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
