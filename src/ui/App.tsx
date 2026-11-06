import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { Inspector } from './inspector/Inspector';
import { NoticeToast } from './Notice';
import { useUndoShortcuts } from './canvas/ProjectToolbar';
import { Preview } from './preview/Preview';
import { clampWidth, PREVIEW_WIDTH } from './preview/PreviewResizer';
import { useEditor } from '../store/editor-store';
import { nodeLabel } from './node-label';
import { PanelRail, useMinimisedPanels } from './panels';

const WIDTH_KEY = 'node-cms:preview-width';

/** The preview sidebar's width, remembered in this browser (a convenience; it is fine when storage is blocked). */
function usePreviewWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved ? clampWidth(saved) : PREVIEW_WIDTH.default;
    } catch {
      return PREVIEW_WIDTH.default;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // storage blocked: the width is just not remembered
    }
  }, [width]);
  // Keep it within the window when the window gets smaller.
  useEffect(() => {
    const fit = () => setWidth((w) => clampWidth(w));
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return [width, setWidth] as const;
}

export function App() {
  useUndoShortcuts();
  const [width, setWidth] = usePreviewWidth();
  const [detached, setDetached] = useState(false);
  const onDetachedChange = useCallback((d: boolean) => setDetached(d), []);
  const [minimised, setMinimised] = useMinimisedPanels();
  const selected = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const style = {
    '--preview-width': minimised.preview ? 'var(--rail-width)' : detached ? '240px' : `${width}px`,
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
          width={width}
          onWidthChange={setWidth}
          onDetachedChange={onDetachedChange}
          minimised={minimised.preview}
          onMinimisedChange={(m) => setMinimised('preview', m)}
        />
        <NoticeToast />
      </div>
    </ReactFlowProvider>
  );
}
