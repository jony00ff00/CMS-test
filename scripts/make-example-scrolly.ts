// Generates the "scrolly from Word text + code" example: the text of a scrollytelling graphic is written in Word
// (examples/scrolly/ge16-scrolly-short-text.docx), its code (markup, CSS, JavaScript) is an HTML file made by a
// developer (examples/scrolly/ge16-scrolly-short.html). One Fill template node puts the Word text into the code's
// text slots, with one step card per "Step" heading in the Word file.
// Run with `npm run example:scrolly`. Writes examples/ge16-scrolly.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFile, type CanvasNote, type FillRow, type Graph, type GraphNode } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
export const CODE_FILE = join(dir, 'scrolly', 'ge16-scrolly-short.html');
export const TEXT_FILE = join(dir, 'scrolly', 'ge16-scrolly-short-text.docx');
export const PROJECT_FILE = join(dir, 'ge16-scrolly.node-cms.json');

/** The Word document's own paragraph styles, as classes, so selectors can find the kicker, title and dek. */
const STYLE_MAP = [
  "p[style-name='Kicker'] => p.kicker:fresh",
  "p[style-name='Title'] => p.title:fresh",
  "p[style-name='Dek'] => p.dek:fresh",
  "p[style-name='Note'] => p.note:fresh",
];

/** How the Word text fills the code: one row per slot, and one copy of the step card per "Step" heading. */
export const FILL_ROWS: FillRow[] = [
  // Header: the Word styles Kicker, Title and Dek (classes from the style map) into the code's slots.
  { id: 'kicker', slot: '.gs-kicker', from: { mode: 'css', selector: '.kicker' }, required: true },
  { id: 'headline', slot: '.gs-headline', from: { mode: 'css', selector: '.title' }, required: true },
  { id: 'dek', slot: '.gs-dek', from: { mode: 'css', selector: '.dek' }, required: true },
  // Steps: a card per "Step" heading section, in order. A writer who adds or removes a step adds or removes a card.
  {
    id: 'steps',
    repeat: '.gs-step',
    items: { mode: 'heading', text: 'Step', match: 'contains', includeHeading: false },
    rows: [{ id: 'card', slot: '.gs-card', from: { mode: 'all', scope: 'document' }, required: true }],
    min: 1,
  },
  // Footer: the note and the link's text (the link itself stays).
  { id: 'footer', slot: '.gs-footer > p:first-child, .gs-footer a', from: { mode: 'css', selector: 'h2:last-of-type ~ p' } },
];

export function scrollyGraph(codeId: string, textId: string): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 300, y: 40 + row * 200 });
  const nodes: GraphNode[] = [
    { id: 'code', type: 'documentSource', name: 'Scrolly code (HTML)', position: at(0, 0), config: { fileId: codeId, html: { keepCode: true } } },
    { id: 'text', type: 'documentSource', name: 'Scrolly text (Word)', position: at(0, 1), config: { fileId: textId, docx: { styleMap: STYLE_MAP } } },
    { id: 'fill', type: 'fillTemplate', name: 'Fill the scrolly', position: at(1, 0.5), config: { rows: FILL_ROWS } },
    { id: 'page', type: 'output', name: 'Scrolly page', position: at(2, 0.5), config: { format: 'html', fullDocument: true, inlineAssets: true, strict: true } },
  ];
  const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  const edges = [
    edge('code', 'document', 'fill', 'template'),
    edge('text', 'document', 'fill', 'content'),
    edge('fill', 'document', 'page', 'document'),
  ];
  // A note on the canvas, above the flow, says what the example is for.
  const notes: CanvasNote[] = [
    {
      id: 'note-1',
      text: 'Example for merging text changes with pre-existing scrolly-telly code.\nAllows text to be easily updated by users, without requiring specialised tools.',
      position: { x: 40, y: -110 },
      width: 420,
    },
  ];
  return { nodes, edges, notes };
}

export function buildScrollyExample() {
  const code = storeFile('ge16-scrolly-short.html', readFileSync(CODE_FILE, 'utf8'), 'scrolly-code');
  const text = storeFile('ge16-scrolly-short-text.docx', new Uint8Array(readFileSync(TEXT_FILE)), 'scrolly-text');
  return toProjectFile(
    { graph: scrollyGraph(code.id, text.id), files: { [code.id]: code, [text.id]: text }, library: seedLibrary() },
    new Date('2026-11-10T00:00:00Z'),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PROJECT_FILE, `${JSON.stringify(buildScrollyExample(), null, 2)}\n`);
  console.log('wrote examples/ge16-scrolly.node-cms.json');
}
