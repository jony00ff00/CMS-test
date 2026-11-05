import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './canvas/Palette';
import { Inspector } from './inspector/Inspector';
import { NoticeToast } from './Notice';
import { Preview } from './preview/Preview';

export function App() {
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
