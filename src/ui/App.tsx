import { Background, Controls, ReactFlow } from '@xyflow/react';
import { ENGINE_VERSION } from '../engine';

const PALETTE = ['Document Source', 'Selector', 'Snippet', 'Output'];

export function App() {
  return (
    <div className="app">
      <aside className="panel palette" aria-label="Node palette">
        <h2>Nodes</h2>
        <ul>
          {PALETTE.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </aside>
      <main className="canvas" aria-label="Canvas">
        <ReactFlow nodes={[]} edges={[]} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </main>
      <aside className="panel inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        <p className="muted">Select a node to edit it.</p>
      </aside>
      <section className="preview" aria-label="Preview">
        <h2>Preview</h2>
        <p className="muted">Engine v{ENGINE_VERSION}</p>
      </section>
    </div>
  );
}
