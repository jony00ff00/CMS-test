import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { Inspector } from './inspector/Inspector';
import { NoticeToast } from './Notice';
import { useUndoShortcuts } from './canvas/ProjectToolbar';
import { Preview } from './preview/Preview';
import { clampHeight, PREVIEW_HEIGHT } from './preview/PreviewResizer';
import { useEditor } from '../store/editor-store';
import { nodeLabel } from './node-label';
import { PanelRail, useMinimisedPanels } from './panels';

const HEIGHT_KEY = 'node-cms:preview-height';

/** The preview's height, remembered in this browser (a convenience; it is fine when storage is blocked). */
function usePreviewHeight() {
  const [height, setHeight] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(HEIGHT_KEY));
      return saved ? clampHeight(saved) : PREVIEW_HEIGHT.default;
    } catch {
      return PREVIEW_HEIGHT.default;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      // storage blocked: the height is just not remembered
    }
  }, [height]);
  // Keep it within the window when the window gets smaller.
  useEffect(() => {
    const fit = () => setHeight((h) => clampHeight(h));
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return [height, setHeight] as const;
}

export function App() {
  useUndoShortcuts();
  const [height, setHeight] = usePreviewHeight();
  const [detached, setDetached] = useState(false);
  const onDetachedChange = useCallback((d: boolean) => setDetached(d), []);
  const [minimised, setMinimised] = useMinimisedPanels();
  const selected = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const style = {
    '--preview-height': detached || minimised.preview ? 'auto' : `${height}px`,
    '--palette-width': minimised.palette ? 'var(--rail-width)' : '220px',
    '--inspector-width': minimised.inspector ? 'var(--rail-width)' : '340px',
  } as CSSProperties;
  return (
    <ReactFlowProvider>
      <div className="app" style={style}>
        {minimised.palette ? (
          <PanelRail panel="palette" onRestore={() => setMinimised('palette', false)} />
        ) : (
          <Palette onMinimise={() => setMinimised('palette', true)} />
        )}
        <Canvas />
        {minimised.inspector ? (
          <PanelRail panel="inspector" note={selected && nodeLabel(selected)} onRestore={() => setMinimised('inspector', false)} />
        ) : (
          <Inspector onMinimise={() => setMinimised('inspector', true)} />
        )}
        {/* The preview stays mounted when minimised: it may be showing in its own window. */}
        <Preview
          height={height}
          onHeightChange={setHeight}
          onDetachedChange={onDetachedChange}
          minimised={minimised.preview}
          onMinimisedChange={(m) => setMinimised('preview', m)}
        />
        <NoticeToast />
      </div>
    </ReactFlowProvider>
  );
}
