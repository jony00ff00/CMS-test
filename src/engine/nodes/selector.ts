import type { NodeDefinition } from '../graph';
import { runSelector, type SelectorConfig } from '../selectors';
import type { CmsDocument } from '../types';

export const selector: NodeDefinition<SelectorConfig> = {
  type: 'selector',
  label: 'Selector',
  description: 'Picks parts of a document by CSS, regex, heading, JSON field or by hand',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'selection', type: 'selection', label: 'Selection' }],
  defaultConfig: () => ({ mode: 'css', selector: 'h2' }),
  async evaluate(inputs, config) {
    const selection = runSelector(inputs.document as CmsDocument, config);
    return { outputs: { selection }, warnings: selection.warnings, info: { matches: selection.matches.length } };
  },
};
