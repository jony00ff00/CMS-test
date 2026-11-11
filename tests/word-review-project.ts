// A project with the reviewed Word sample (examples/word-review), for browser tests while the example is built.
import { readFileSync } from 'node:fs';
import { storeFile, type GraphNode } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

export function reviewProjectFile(nodes: GraphNode[] = [], edges: { id: string; source: string; sourcePort: string; target: string; targetPort: string }[] = []) {
  const file = storeFile('hung-by-design-review.docx', new Uint8Array(readFileSync('examples/word-review/hung-by-design-review.docx')), 'word');
  const project = toProjectFile({
    graph: {
      nodes: [{ id: 'word', type: 'documentSource', name: 'Word (review mode)', position: { x: 40, y: 80 }, config: { fileId: file.id, docx: { review: true } } }, ...nodes],
      edges,
    },
    files: { [file.id]: file },
    library: seedLibrary(),
  });
  return { name: 'word-review.node-cms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) };
}
