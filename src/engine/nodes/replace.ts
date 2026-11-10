import { convertValue } from '../convert';
import type { NodeDefinition, NodeOutput } from '../graph';
import { replaceSelection, type ReplaceOptions } from '../insert';
import type { Selection } from '../types';

export type ReplaceNodeConfig = ReplaceOptions;

/**
 * Replaces what a Selector picked with content from another node (a selection, a whole document such as an
 * Extractor's, or HTML), from this document or another one.
 */
export const replace: NodeDefinition<ReplaceNodeConfig> = {
  type: 'replace',
  label: 'Replace',
  description: 'Replaces the selected parts of a document with content from another node',
  inputs: [
    { name: 'selection', type: 'selection', label: 'Selection' },
    { name: 'content', type: 'any', label: 'Content' },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const selection = inputs.selection as Selection;
    // A document (or HTML) means all of it; a selection, what it picked.
    const converted = await convertValue(inputs.content);
    const result = await replaceSelection(selection, converted.selection, config);
    const warnings = [...converted.warnings.filter((w) => !result.warnings.includes(w)), ...result.warnings];
    return {
      outputs: { document: result.document },
      warnings,
      info: { replaced: result.replaced, ...(converted.selection.document.meta.fileName && { from: converted.selection.document.meta.fileName }) },
    };
  },
};
