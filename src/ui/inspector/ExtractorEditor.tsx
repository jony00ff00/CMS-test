import type { ExtractorConfig, GraphNode, SelectorConfig } from '../../engine';
import { editorStore } from '../../store/editor-store';
import { CheckboxField } from './fields';
import { ManualSelections, SELECTOR_MODES, SelectorFields, useInputDocument } from './SelectorEditor';

/** A point makes no sense here: an Extractor keeps content, it does not place anything. */
const MODES = SELECTOR_MODES.filter((m) => m.value !== 'point');

export function ExtractorEditor({ node }: { node: GraphNode }) {
  const input = useInputDocument(node.id);
  const config = node.config as ExtractorConfig;
  const manual = config.mode === 'manual';
  const set = (next: ExtractorConfig) => editorStore.getState().updateConfig(node.id, next);
  return (
    <>
      <p className="muted small">
        Keeps only what this picks, in document order; everything else is removed.{' '}
        {manual ? 'Select text in the preview’s “Pick” view to add it; “Kept” shows the result.' : 'The preview shows what is kept.'}
      </p>
      <SelectorFields
        config={node.config as SelectorConfig}
        input={input}
        modes={MODES}
        // Keeping the surrounding elements belongs to the node, not to the selector: keep it when the mode changes.
        onChange={(next) => set({ ...next, ...(config.keepContext === false && { keepContext: false }) } as ExtractorConfig)}
        manual={(c, patch) => <ManualSelections node={node} config={c} onChange={(anchors) => patch({ anchors })} />}
      />
      <CheckboxField
        label="Keep the elements around what it picks"
        checked={config.keepContext !== false}
        hint={'So the page’s CSS still applies: text from a <p class="tip"> stays in one, and a callout around it comes along (without its other content). Off: only the picked content itself.'}
        onChange={(keep) => set({ ...config, keepContext: keep ? undefined : false } as ExtractorConfig)}
      />
    </>
  );
}
