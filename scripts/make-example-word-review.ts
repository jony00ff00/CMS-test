// Generates the "Word review → CKEditor 5" example: a Word file with tracked changes, comments and inconsistent
// formatting (examples/word-review/hung-by-design-review.docx, a reviewed brief with the reviewer's name and account
// id removed) becomes CKEditor 5 collaboration data with one house style, its changes and comments intact.
// Run with `npm run example:word-review`. Writes examples/word-review.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFile, type Graph, type GraphNode } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
export const WORD_FILE = join(dir, 'word-review', 'hung-by-design-review.docx');
export const PROJECT_FILE = join(dir, 'word-review.node-cms.json');

export function wordReviewGraph(fileId: string): Graph {
  const at = (col: number) => ({ x: 40 + col * 300, y: 120 });
  const nodes: GraphNode[] = [
    { id: 'word', type: 'documentSource', name: 'Brief under review (Word)', position: at(0), config: { fileId, docx: { review: true } } },
    {
      id: 'changes',
      type: 'changes',
      name: 'Changes and comments',
      position: at(1),
      // Everything stays a suggestion; the "Test" comment goes; the reviewer gets a user id (set yours here).
      config: { dropResolved: true, dropComments: [], users: { Reviewer: { id: 'reviewer-1', name: 'Reviewer' } } },
    },
    { id: 'format', type: 'formatting', name: 'House style', position: at(2), config: {} },
    {
      id: 'ckeditor',
      type: 'output',
      name: 'CKEditor 5 import',
      position: at(3),
      config: { format: 'ckeditor', fullDocument: true, inlineAssets: true, ckeditor: { documentId: 'ge16-hung-by-design', headings: ['h2', 'h3', 'h4'] } },
    },
  ];
  const edge = (source: string, target: string) => ({ id: `${source}>${target}`, source, sourcePort: 'document', target, targetPort: 'document' });
  return { nodes, edges: [edge('word', 'changes'), edge('changes', 'format'), edge('format', 'ckeditor')] };
}

export async function buildWordReviewExample() {
  const file = storeFile('hung-by-design-review.docx', new Uint8Array(readFileSync(WORD_FILE)), 'word-review');
  const graph = wordReviewGraph(file.id);
  // The "Test" comment (in a table cell) is dropped: find its id in the file.
  const { importDocxReview } = await import('../src/engine');
  const doc = await importDocxReview(file.data as Uint8Array, { fileName: file.name });
  const test = Object.values(doc.meta.review!.comments).find((c) => c.html === '<p>Test</p>');
  (graph.nodes[1].config as { dropComments: string[] }).dropComments = test ? [test.id] : [];
  return toProjectFile({ graph, files: { [file.id]: file }, library: seedLibrary() }, new Date('2026-11-11T00:00:00Z'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PROJECT_FILE, `${JSON.stringify(await buildWordReviewExample(), null, 2)}\n`);
  console.log('wrote examples/word-review.node-cms.json');
}
