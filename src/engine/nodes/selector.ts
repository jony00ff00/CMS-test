import type { NodeDefinition } from '../graph';
import type { InsertPlace, PointValue } from '../insert';
import { runSelector, type SelectorConfig } from '../selectors';
import type { CmsDocument } from '../types';

/** A Selector's settings: what to select, and (for its Point output) where things go relative to each match. */
export type SelectorNodeConfig = SelectorConfig & {
  /** Point output, for modes other than "point": before / after each match, or inside it at the start / end. Default after. */
  place?: InsertPlace;
};

export const selector: NodeDefinition<SelectorNodeConfig> = {
  type: 'selector',
  label: 'Selector',
  description: 'Picks parts of a document (CSS, regex, heading, JSON field, slides, by hand) or a point in it',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [
    { name: 'selection', type: 'selection', label: 'Selection' },
    { name: 'point', type: 'point', label: 'Point' },
  ],
  defaultConfig: () => ({ mode: 'css', selector: 'h2' }),
  async evaluate(inputs, config) {
    const doc = inputs.document as CmsDocument;
    if (config.mode === 'point' && !config.point) {
      return { outputs: {}, waiting: 'Click in the preview to pick the point' };
    }
    const { place, ...selectorConfig } = config;
    const selection = runSelector(doc, selectorConfig as SelectorConfig);
    const point: PointValue = {
      kind: 'point',
      document: doc,
      where:
        config.mode === 'point'
          ? { mode: 'point', point: config.point }
          : { mode: 'selector', selector: selectorConfig as SelectorConfig, place: place ?? 'after' },
    };
    const info: Record<string, number> = { matches: selection.matches.length };
    if (config.mode === 'manual') {
      // Saved selections that could not be found in this version of the document.
      const found = new Set(selection.matches.map((m) => m.anchorId));
      const missing = config.anchors.filter((a) => !found.has(a.id)).length;
      if (missing) info.needsAttention = missing;
    }
    if (config.mode === 'point' && selection.matches.length === 0) info.needsAttention = 1;
    return { outputs: { selection, point }, warnings: selection.warnings, info };
  },
};
