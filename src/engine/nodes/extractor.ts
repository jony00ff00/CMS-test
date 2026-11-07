import { documentFromSelection } from '../convert';
import type { NodeDefinition } from '../graph';
import { runSelector, type SelectorConfig } from '../selectors';
import type { CmsDocument } from '../types';

/**
 * A Selector's settings, plus whether the elements around what is picked come along (default yes): text from a
 * `<p class="tip">` then stays in one, so the page's CSS for it (and for wrappers such as a callout) still applies.
 */
export type ExtractorConfig = SelectorConfig & { keepContext?: boolean };

/** Picks parts of a document like a Selector, and passes on only those parts: everything else is removed. */
export const extractor: NodeDefinition<ExtractorConfig> = {
  type: 'extractor',
  label: 'Extractor',
  description: 'Keeps only the parts it picks (like a Selector) and removes the rest',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ mode: 'css', selector: 'h2' }),
  async evaluate(inputs, config) {
    const selection = runSelector(inputs.document as CmsDocument, config);
    const { document: kept, warnings } = await documentFromSelection(selection, { context: config.keepContext !== false });
    return {
      // `selection` is not a port: the preview highlights it, and hand-made selections show whether they were found.
      outputs: { document: kept, selection },
      warnings: selection.matches.length
        ? [...selection.warnings, ...warnings.filter((w) => !selection.warnings.includes(w))]
        : [...selection.warnings, 'Nothing matched, so nothing is kept'],
      info: { matches: selection.matches.length, kept: kept.tree.children.length },
    };
  },
};
