import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { Inspector } from './inspector/Inspector';
import { NoticeToast } from './Notice';
import { useUndoShortcuts } from './canvas/ProjectToolbar';
import { Preview } from './preview/Preview';
import { clampHeight, PREVIEW_HEIGHT } from './preview/PreviewResizer';

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
  const style = { '--preview-height': detached ? 'auto' : `${height}px` } as CSSProperties;
  return (
    <ReactFlowProvider>
      <div className="app" style={style}>
        <Palette />
        <Canvas />
        <Inspector />
        <Preview height={height} onHeightChange={setHeight} onDetachedChange={onDetachedChange} />
        <NoticeToast />
      </div>
    </ReactFlowProvider>
  );
}
