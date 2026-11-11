import { convertValue } from '../convert';
import type { NodeDefinition, NodeOutput } from '../graph';
import { removeSelection, replaceSelection, type ReplaceMode, type ReplaceOptions } from '../insert';
import type { Selection } from '../types';

export type ReplaceNodeConfig = ReplaceOptions & ReplaceMode;

/**
 * Replaces what a Selector picked with content from another node (a selection, a whole document such as an
 * Extractor's, or HTML), from this document or another one. With nothing connected to Content, it removes them.
 */
export const replace: NodeDefinition<ReplaceNodeConfig> = {
  type: 'replace',
  label: 'Replace',
  description: 'Replaces the selected parts of a document with content from another node, or removes them',
  inputs: [
    { name: 'selection', type: 'selection', label: 'Selection' },
    { name: 'content', type: 'any', label: 'Content', optional: true },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const selection = inputs.selection as Selection;
    if (!('content' in inputs)) {
      const result = await removeSelection(selection, config);
      return { outputs: { document: result.document }, warnings: result.warnings, info: { replaced: result.replaced, removed: true } };
    }
    // A document (or HTML) means all of it; a selection, what it picked.
    // Match by match, a document's blocks are its parts.
    const converted = await convertValue(inputs.content, { documentToSelection: config.pairs ? 'blocks' : 'document' });
    const result = await replaceSelection(selection, converted.selection, config);
    const warnings = [...converted.warnings.filter((w) => !result.warnings.includes(w)), ...result.warnings];
    return {
      outputs: { document: result.document },
      warnings,
      info: { replaced: result.replaced, ...(converted.selection.document.meta.fileName && { from: converted.selection.document.meta.fileName }) },
    };
  },
};
