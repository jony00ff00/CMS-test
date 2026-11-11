import { applyChanges, type ChangesConfig } from '../changes';
import type { NodeDefinition } from '../graph';
import type { CmsDocument } from '../types';

/**
 * Decides about a Word file's tracked changes and comments (read in review mode): what stays a suggestion, what
 * is accepted or rejected, which comment threads go, who the authors are in the editor, and the time zone of
 * dates the file gives without one.
 */
export const changes: NodeDefinition<ChangesConfig> = {
  type: 'changes',
  label: 'Changes',
  description: 'Keeps, accepts or rejects tracked changes and comments from a Word file in review mode',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  // Changes nobody can see in the content (none here: hidden ones are always accepted) and nothing else decided.
  defaultConfig: () => ({ dropResolved: true }),
  async evaluate(inputs, config) {
    const result = applyChanges(inputs.document as CmsDocument, config);
    return { outputs: { document: result.document }, warnings: result.warnings, info: { ...result.counts } };
  },
};
