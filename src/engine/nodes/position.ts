import { convertValue } from '../convert';
import type { NodeDefinition, NodeOutput } from '../graph';
import { insertContent, type InsertionPoint, type ReplaceOptions } from '../insert';
import type { CmsDocument } from '../types';

/** A point picked in the preview (like a Selector in point mode), and how the content goes in there. */
export type PositionNodeConfig = ReplaceOptions & { point?: InsertionPoint };

/**
 * Puts content (a selection, a whole document such as an Extractor's or an Object's, or HTML) into a document at
 * one point picked in the preview: a Selector in point mode and an Object in one node.
 */
export const position: NodeDefinition<PositionNodeConfig> = {
  type: 'position',
  label: 'Position',
  description: 'Adds content from another node at a point you click in the preview',
  inputs: [
    { name: 'document', type: 'document', label: 'Document' },
    { name: 'content', type: 'any', label: 'Content' },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const doc = inputs.document as CmsDocument;
    const { point, ...options } = config;
    const converted = await convertValue(inputs.content);
    const result = await insertContent(doc, { mode: 'point', point }, { kind: 'selection', ...options }, ctx.files, converted.selection);
    if (result.waiting) return { outputs: {}, waiting: 'Select this Position node and click in the preview where the content goes' };
    const info: Record<string, string | number> = { inserted: result.inserted };
    const name = converted.selection.document.meta.fileName;
    if (name) info.from = name;
    if (result.needsAttention) info.needsAttention = 1;
    const warnings = [...converted.warnings.filter((w) => !result.warnings.includes(w)), ...result.warnings];
    return { outputs: { document: result.document }, warnings, info };
  },
};
