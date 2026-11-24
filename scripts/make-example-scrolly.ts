// Generates the "scrolly from Word text + code" example: the text of a scrollytelling graphic is written in Word
// (examples/scrolly/ge16-scrolly-short-text.docx), its code (markup, CSS, JavaScript) is an HTML file made by a
// developer (examples/scrolly/ge16-scrolly-short.html). One Fill template node puts the Word text into the code's
// text slots, with one step card per "Step" heading in the Word file.
// Run with `npm run example:scrolly`. Writes examples/ge16-scrolly.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeRegistry, storeFile, type CanvasNote, type FillRow, type Graph, type GraphNode, type NodeGroup } from '../src/engine';
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

/**
 * The static page's look: the scrolly's code is left out, so the page reads as an article (header, each step's text,
 * the data tables, the footer) and needs no JavaScript.
 */
export const STATIC_CSS = [
  '.gs-static{max-width:42rem;margin:2.5rem auto;padding:0 1rem;font:1.05rem/1.65 Georgia,"Times New Roman",serif;color:#1f2937}',
  '.gs-static .gs-kicker{margin:0 0 .5rem;font:600 .75rem/1.4 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#6b7280}',
  '.gs-static .gs-headline{margin:0 0 .75rem;font-size:2.4rem;line-height:1.1}',
  '.gs-static .gs-dek{margin:0 0 2rem;font-size:1.2rem;color:#4b5563}',
  '.gs-static .gs-step{margin:0 0 1.1rem}',
  '.gs-static .gs-card p{margin:0 0 .6rem}',
  '.gs-static .gs-sr-only{margin:2rem 0}',
  '.gs-static table{width:100%;margin:0 0 1.75rem;border-collapse:collapse;font:.9rem/1.45 system-ui,sans-serif}',
  '.gs-static caption{margin-bottom:.5rem;text-align:left;font-weight:600}',
  '.gs-static th,.gs-static td{padding:.4rem .5rem;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}',
  '.gs-static thead th{border-bottom:2px solid #9ca3af}',
  '.gs-static .gs-footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;font-size:.9rem;color:#4b5563}',
].join('\n');

export function scrollyGraph(codeId: string, textId: string): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 280, y: 40 + row * 220 });
  const nodes: GraphNode[] = [
    { id: 'code', type: 'documentSource', name: 'Scrolly code (HTML)', position: at(0, 0), config: { fileId: codeId, html: { keepCode: true } } },
    { id: 'text', type: 'documentSource', name: 'Scrolly text (Word)', position: at(0, 1), config: { fileId: textId, docx: { styleMap: STYLE_MAP } } },
    { id: 'fill', type: 'fillTemplate', name: 'Fill the scrolly', position: at(1, 0.5), config: { rows: FILL_ROWS } },
    // The interactive page: the scrolly as its code makes it.
    { id: 'page', type: 'output', name: 'Interactive page', position: at(4, 0), config: { format: 'html', fullDocument: true, inlineAssets: true, strict: true } },
    // The static page: the same text without the scrolly's code, as an article with the data tables shown.
    { id: 'static-code', type: 'selector', name: 'Graphic and its code', position: at(2, 1), config: { mode: 'css', selector: 'ge16-scrolly > script, ge16-scrolly > style, .gs-graphic', expect: { min: 3 } } },
    { id: 'static-strip', type: 'object', name: 'Leave them out', position: at(3, 1), config: { content: { kind: 'selection' }, place: 'replace' } },
    {
      id: 'static-look',
      type: 'snippet',
      name: 'Article look',
      position: at(4, 1),
      config: { ...nodeRegistry.snippet.defaultConfig(), ref: undefined, params: undefined, custom: { className: 'gs-static', wrap: 'div' }, css: STATIC_CSS, documentScope: 'document' },
    },
    { id: 'static', type: 'output', name: 'Static page', position: at(5, 1), config: { format: 'html', fullDocument: true, inlineAssets: true, strict: true } },
  ];
  const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  const edges = [
    edge('code', 'document', 'fill', 'template'),
    edge('text', 'document', 'fill', 'content'),
    edge('fill', 'document', 'page', 'document'),
    edge('fill', 'document', 'static-code', 'document'),
    edge('static-code', 'selection', 'static-strip', 'where'),
    edge('static-strip', 'document', 'static-look', 'selection'),
    edge('static-look', 'document', 'static', 'document'),
  ];
  const groups: NodeGroup[] = [{ id: 'group-static', name: 'Static version', nodeIds: ['static-code', 'static-strip', 'static-look'], color: '#0d9488' }];
  // A note on the canvas, above the flow, says what the example is for.
  const notes: CanvasNote[] = [
    {
      id: 'note-1',
      text: 'Example for merging text changes with pre-existing scrolly-telly code.\nAllows text to be easily updated by users, without requiring specialised tools.',
      position: { x: 40, y: -110 },
      width: 420,
    },
    {
      id: 'note-2',
      text: 'Two outputs from the same filled page: the Interactive page runs the scrolly; the Static page leaves out its graphic and code and reads as an article, with the data tables shown.',
      position: { x: 640, y: -110 },
      width: 420,
      color: 'blue',
    },
  ];
  return { nodes, edges, groups, notes };
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
