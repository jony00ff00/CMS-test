// The JSON sample graph (the app's old "JSON example" button, now gone): Document Source with a field mapping →
// Selector → Snippet → Output. Tests open it as a project file, with the same node ids as before.
import { createEditorStore } from '../src/store/editor-store';
import { toProjectFile } from '../src/store/project';

export function jsonExampleFile() {
  const store = createEditorStore({ storage: null });
  store.getState().loadExample('json');
  const { graph, files, library } = store.getState();
  return { name: 'json-example.node-cms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(toProjectFile({ graph, files, library }))) };
}
