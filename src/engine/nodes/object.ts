import type { NodeDefinition, NodeOutput } from '../graph';
import { describeInsertion, insertContent, type InsertContent, type PointValue } from '../insert';
import type { Selection } from '../types';

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
  description: 'Code, an image, a video or selected content, added at a Point from a Selector',
  inputs: [
    { name: 'point', type: 'point', label: 'Point' },
    // Only for "Selected content": what to copy in (from this document or another one).
    { name: 'selection', type: 'selection', label: 'Selection', optional: true },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ content: { kind: 'imageUrl', url: '', alt: '' } }),
  // An uploaded image or video is part of the result, so its content is part of the cache key.
  dependencies: (config, ctx) => {
    const fileId = 'fileId' in config.content ? config.content.fileId : undefined;
    return fileId ? (ctx.files[fileId]?.hash ?? 'missing') : undefined;
  },
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const point = inputs.point as PointValue;
    const selection = inputs.selection as Selection | undefined;
    const result = await insertContent(point.document, point.where, config.content, ctx.files, selection);
    if (result.waiting) return { outputs: {}, waiting: result.waiting };
    const info: Record<string, string | number> = { what: describeInsertion(config.content), inserted: result.inserted };
    if (result.needsAttention) info.needsAttention = 1;
    const warnings = [...result.warnings];
    if (selection && config.content.kind !== 'selection') warnings.push('A selection is connected but not used: choose "Selected content" to add it');
    return { outputs: { document: result.document }, warnings, info };
  },
};
