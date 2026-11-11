// The graph the app's "Two documents" example used to load (before that button opened the scrolly project): the
// "Watering" section of the notes, through an Extractor, into the guide before its quote, in a labelled section whose
// headings fit under the guide's "Pricing" heading. Tests open it as a project file (same node ids as before).
import { nodeRegistry, storeFile, type GraphNode, type ObjectNodeConfig } from '../src/engine';
import { sampleHtml, sampleNotesHtml } from '../src/samples';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

export function twoDocumentsProject() {
  const guide = storeFile('example.html', sampleHtml());
  const notes = storeFile('notes.html', sampleNotesHtml());
  const at = (col: number, row: number) => ({ x: 40 + col * 280, y: 60 + row * 200 });
  const nodes: GraphNode[] = [
    { id: 'documentSource-1', type: 'documentSource', name: 'Guide', position: at(0, 0), config: { fileId: guide.id } },
    { id: 'documentSource-2', type: 'documentSource', name: 'Notes', position: at(0, 1), config: { fileId: notes.id } },
    { id: 'selector-3', type: 'selector', name: 'Before the quote', position: at(1, 0), config: { mode: 'css', selector: 'blockquote', place: 'before' } },
    { id: 'extractor-4', type: 'extractor', name: 'Watering section', position: at(1, 1), config: { mode: 'heading', text: 'Watering', includeHeading: true } },
    { id: 'object-5', type: 'object', position: at(2, 0), config: { content: { kind: 'selection', wrap: 'section', headings: 'fit' } } satisfies ObjectNodeConfig },
    { id: 'output-6', type: 'output', position: at(3, 0), config: nodeRegistry.output.defaultConfig() },
  ];
  const edges = [
    { id: 'e1', source: 'documentSource-1', sourcePort: 'document', target: 'selector-3', targetPort: 'document' },
    { id: 'e2', source: 'documentSource-2', sourcePort: 'document', target: 'extractor-4', targetPort: 'document' },
    { id: 'e3', source: 'selector-3', sourcePort: 'point', target: 'object-5', targetPort: 'point' },
    { id: 'e4', source: 'extractor-4', sourcePort: 'document', target: 'object-5', targetPort: 'content' },
    { id: 'e5', source: 'object-5', sourcePort: 'document', target: 'output-6', targetPort: 'document' },
  ];
  return toProjectFile({ graph: { nodes, edges }, files: { [guide.id]: guide, [notes.id]: notes }, library: seedLibrary() });
}

/** For Playwright's `setInputFiles` on the "Project file" input. */
export const twoDocumentsFile = () => ({
  name: 'two-documents.node-cms.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(twoDocumentsProject())),
});
