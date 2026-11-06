import type { GraphNode, SelectorConfig } from '../../engine';
import { editorStore } from '../../store/editor-store';
import { ManualSelections, SELECTOR_MODES, SelectorFields, useInputDocument } from './SelectorEditor';

/** A point makes no sense here: an Extractor keeps content, it does not place anything. */
const MODES = SELECTOR_MODES.filter((m) => m.value !== 'point');

export function ExtractorEditor({ node }: { node: GraphNode }) {
  const input = useInputDocument(node.id);
  const manual = (node.config as SelectorConfig).mode === 'manual';
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
        onChange={(next) => editorStore.getState().updateConfig(node.id, next)}
        manual={(c, patch) => <ManualSelections node={node} config={c} onChange={(anchors) => patch({ anchors })} />}
      />
    </>
  );
}
