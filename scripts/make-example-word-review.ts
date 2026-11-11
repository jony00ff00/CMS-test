// Generates the "Word review → CKEditor 5" example: a Word file with tracked changes, comments and inconsistent
// formatting (examples/word-review/hung-by-design-review.docx, a reviewed brief with the reviewer's name and account
// id removed) becomes CKEditor 5 collaboration data with one house style, its changes and comments intact.
// A second project, word-review-numbered.node-cms.json, is the same with every paragraph numbered in one running
// sequence (headings and tables not) and all text in the editor's one font and size (no highlights or colours); its
// CKEditor 5 import file is written next to the Word file.
// Run with `npm run example:word-review`. Writes both projects and examples/word-review/*.ckeditor-import.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFile, type Graph, type GraphNode } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
export const WORD_FILE = join(dir, 'word-review', 'hung-by-design-review.docx');
export const PROJECT_FILE = join(dir, 'word-review.node-cms.json');
export const NUMBERED_PROJECT_FILE = join(dir, 'word-review-numbered.node-cms.json');
export const NUMBERED_OUTPUT_FILE = join(dir, 'word-review', 'hung-by-design-numbered.ckeditor-import.json');

export function wordReviewGraph(fileId: string, numbered = false): Graph {
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
    numbered
      ? {
          id: 'format',
          type: 'formatting',
          name: 'House style, numbered paragraphs',
          position: at(2),
          // Every paragraph numbered (one comment explains it, at the first one, instead of one per paragraph). Fonts,
          // sizes, highlights and colours always go, so all text has the editor's own font and size.
          config: { numberParagraphs: true, labels: 'rule' },
        }
      : { id: 'format', type: 'formatting', name: 'House style', position: at(2), config: {} },
    {
      id: 'ckeditor',
      type: 'output',
      name: 'CKEditor 5 import',
      position: at(3),
      config: {
        format: 'ckeditor',
        fullDocument: true,
        inlineAssets: true,
        ckeditor: numbered
          ? { documentId: 'ge16-hung-by-design-numbered', headings: ['h2', 'h3', 'h4'], listProperties: true }
          : { documentId: 'ge16-hung-by-design', headings: ['h2', 'h3', 'h4'] },
      },
    },
  ];
  const edge = (source: string, target: string) => ({ id: `${source}>${target}`, source, sourcePort: 'document', target, targetPort: 'document' });
  return { nodes, edges: [edge('word', 'changes'), edge('changes', 'format'), edge('format', 'ckeditor')] };
}

export async function buildWordReviewExample(numbered = false) {
  const file = storeFile('hung-by-design-review.docx', new Uint8Array(readFileSync(WORD_FILE)), 'word-review');
  const graph = wordReviewGraph(file.id, numbered);
  // The "Test" comment (in a table cell) is dropped: find its id in the file.
  const { importDocxReview } = await import('../src/engine');
  const doc = await importDocxReview(file.data as Uint8Array, { fileName: file.name });
  const test = Object.values(doc.meta.review!.comments).find((c) => c.html === '<p>Test</p>');
  (graph.nodes[1].config as { dropComments: string[] }).dropComments = test ? [test.id] : [];
  return toProjectFile({ graph, files: { [file.id]: file }, library: seedLibrary() }, new Date('2026-11-11T00:00:00Z'));
}

/** The CKEditor 5 import file the numbered project makes (its Output's download). */
export async function numberedOutput(): Promise<string> {
  const project = await buildWordReviewExample(true);
  const { parseProject } = await import('../src/store/project');
  const { GraphEvaluator, nodeRegistry } = await import('../src/engine');
  const { project: p } = parseProject(JSON.stringify(project));
  const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
  if (results.ckeditor.status !== 'ok') throw new Error(`The numbered example did not run: ${results.ckeditor.message}`);
  return `${results.ckeditor.outputs.json as string}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PROJECT_FILE, `${JSON.stringify(await buildWordReviewExample(), null, 2)}\n`);
  writeFileSync(NUMBERED_PROJECT_FILE, `${JSON.stringify(await buildWordReviewExample(true), null, 2)}\n`);
  writeFileSync(NUMBERED_OUTPUT_FILE, await numberedOutput());
  console.log('wrote examples/word-review.node-cms.json, examples/word-review-numbered.node-cms.json and examples/word-review/hung-by-design-numbered.ckeditor-import.json');
}
