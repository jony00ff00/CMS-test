import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { Inspector } from './inspector/Inspector';
import { NoticeToast } from './Notice';
import { useUndoShortcuts } from './canvas/ProjectToolbar';
import { Preview } from './preview/Preview';

export function App() {
  useUndoShortcuts();
  return (
    <ReactFlowProvider>
      <div className="app">
        <Palette />
        <Canvas />
        <Inspector />
        <Preview />
        <NoticeToast />
      </div>
    </ReactFlowProvider>
  );
}
