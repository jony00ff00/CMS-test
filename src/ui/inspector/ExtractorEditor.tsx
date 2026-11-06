import type { GraphNode, SelectorConfig } from '../../engine';
import { editorStore } from '../../store/editor-store';
import { SELECTOR_MODES, SelectorFields, useInputDocument } from './SelectorEditor';

/** Picked by hand and points need the preview of the input; the Extractor's preview shows what it keeps. */
const MODES = SELECTOR_MODES.filter((m) => m.value !== 'manual' && m.value !== 'point');

export function ExtractorEditor({ node }: { node: GraphNode }) {
  const input = useInputDocument(node.id);
  return (
    <>
      <p className="muted small">Keeps only what this picks, in document order; everything else is removed. The preview shows what is kept.</p>
      <SelectorFields
        config={node.config as SelectorConfig}
        input={input}
        modes={MODES}
        onChange={(next) => editorStore.getState().updateConfig(node.id, next)}
      />
    </>
  );
}
