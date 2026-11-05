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
    const info: Record<string, number> = { matches: selection.matches.length };
    if (config.mode === 'manual') {
      // Saved selections that could not be found in this version of the document.
      const found = new Set(selection.matches.map((m) => m.anchorId));
      const missing = config.anchors.filter((a) => !found.has(a.id)).length;
      if (missing) info.needsAttention = missing;
    }
    return { outputs: { selection }, warnings: selection.warnings, info };
  },
};
