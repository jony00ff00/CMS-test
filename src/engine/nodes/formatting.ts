import { applyFormatting, type FormattingConfig } from '../formatting';
import type { NodeDefinition } from '../graph';
import type { CmsDocument } from '../types';

/**
 * One house style for a Word file read in review mode: each format found (style + direct formatting) becomes a
 * heading, paragraph, list item, quote or nothing; inline formatting is reduced to what the editor keeps; what
 * changed is labelled with comments for review.
 */
export const formatting: NodeDefinition<FormattingConfig> = {
  type: 'formatting',
  label: 'Formatting',
  description: 'Gives a Word file in review mode one house style, and labels what changed for review',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs, config) {
    const result = applyFormatting(inputs.document as CmsDocument, config);
    return { outputs: { document: result.document }, warnings: result.warnings, info: { ...result.info } };
  },
};
