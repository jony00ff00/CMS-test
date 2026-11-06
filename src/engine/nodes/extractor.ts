import { documentFromSelection } from '../convert';
import type { NodeDefinition } from '../graph';
import { runSelector, type SelectorConfig } from '../selectors';
import type { CmsDocument } from '../types';

/** Picks parts of a document like a Selector, and passes on only those parts: everything else is removed. */
export const extractor: NodeDefinition<SelectorConfig> = {
  type: 'extractor',
  label: 'Extractor',
  description: 'Keeps only the parts it picks (like a Selector) and removes the rest',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ mode: 'css', selector: 'h2' }),
  async evaluate(inputs, config) {
    const selection = runSelector(inputs.document as CmsDocument, config);
    const { document: kept, warnings } = await documentFromSelection(selection);
    return {
      outputs: { document: kept },
      warnings: selection.matches.length
        ? [...selection.warnings, ...warnings.filter((w) => !selection.warnings.includes(w))]
        : [...selection.warnings, 'Nothing matched, so nothing is kept'],
      info: { matches: selection.matches.length, kept: kept.tree.children.length },
    };
  },
};
