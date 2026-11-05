import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './ui/styles.css';
import { App } from './ui/App';
import { preloadCodeEditor } from './ui/inspector/fields';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// CodeMirror is large, so it is a separate file; fetch it once the app has started.
(window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 500)))(() => preloadCodeEditor());
