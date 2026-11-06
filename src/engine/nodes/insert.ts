import type { NodeDefinition, NodeOutput } from '../graph';
import { describeInsertion, insertContent, type InsertContent, type InsertWhere } from '../insert';
import type { CmsDocument, Selection } from '../types';

export interface InsertNodeConfig {
  content: InsertContent;
  where: InsertWhere;
}

export const insert: NodeDefinition<InsertNodeConfig> = {
  type: 'insert',
  label: 'Insert',
  description: 'Adds code, an image, a video or selected content at a point you pick or next to each match',
  inputs: [
    { name: 'document', type: 'document', label: 'Document' },
    // Only for "Selected content": what to copy in (from this document or another one).
    { name: 'selection', type: 'selection', label: 'Selection', optional: true },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ content: { kind: 'imageUrl', url: '', alt: '' }, where: { mode: 'point' } }),
  // An uploaded image or video is part of the result, so its content is part of the cache key.
  dependencies: (config, ctx) => {
    const fileId = 'fileId' in config.content ? config.content.fileId : undefined;
    return fileId ? (ctx.files[fileId]?.hash ?? 'missing') : undefined;
  },
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const selection = inputs.selection as Selection | undefined;
    const result = await insertContent(inputs.document as CmsDocument, config.where, config.content, ctx.files, selection);
    if (result.waiting) return { outputs: {}, waiting: result.waiting };
    const info: Record<string, string | number> = { what: describeInsertion(config.content), inserted: result.inserted };
    if (result.needsAttention) info.needsAttention = 1;
    const warnings = [...result.warnings];
    if (selection && config.content.kind !== 'selection') warnings.push('A selection is connected but not used: choose "Selected content" to insert it');
    return { outputs: { document: result.document }, warnings, info };
  },
};
