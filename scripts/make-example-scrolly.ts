// Generates the "scrolly from Word text + code" example: the text of a scrollytelling graphic is written in Word
// (examples/scrolly/ge16-scrolly-short-text.docx), its code (markup, CSS, JavaScript) is an HTML file made by a
// developer (examples/scrolly/ge16-scrolly-short.html). The project puts the Word text into the code's text slots.
// Run with `npm run example:scrolly`. Writes examples/ge16-scrolly.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFile, type CanvasNote, type Graph, type GraphNode, type NodeGroup } from '../src/engine';
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

export function scrollyGraph(codeId: string, textId: string): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 260, y: 40 + row * 200 });
  const replace = { target: 'inside', pairs: true, styles: false };
  const nodes: GraphNode[] = [
    { id: 'code', type: 'documentSource', name: 'Scrolly code (HTML)', position: at(0, 0), config: { fileId: codeId, html: { keepCode: true } } },
    { id: 'text', type: 'documentSource', name: 'Scrolly text (Word)', position: at(0, 2), config: { fileId: textId, docx: { styleMap: STYLE_MAP } } },

    // Header: kicker, headline, dek.
    { id: 'header-slots', type: 'selector', name: 'Header slots', position: at(1, 0), config: { mode: 'css', selector: '.gs-kicker, .gs-headline, .gs-dek' } },
    { id: 'header-text', type: 'selector', name: 'Header text', position: at(1, 1), config: { mode: 'css', selector: '.kicker, .title, .dek' } },
    { id: 'fill-header', type: 'replace', name: 'Fill the header', position: at(2, 0), config: { ...replace } },

    // Steps: one card per step, in order.
    { id: 'step-slots', type: 'selector', name: 'Step cards', position: at(3, 0), config: { mode: 'css', selector: '.gs-step .gs-card' } },
    { id: 'step-text', type: 'selector', name: 'Step text', position: at(3, 1), config: { mode: 'heading', text: 'Step', match: 'contains', includeHeading: false } },
    { id: 'fill-steps', type: 'replace', name: 'Fill the steps', position: at(4, 0), config: { ...replace } },

    // Footer: the note and the link's text (the link itself stays).
    { id: 'footer-slots', type: 'selector', name: 'Footer slots', position: at(5, 0), config: { mode: 'css', selector: '.gs-footer > p:first-child, .gs-footer a' } },
    { id: 'footer-text', type: 'selector', name: 'Footer text', position: at(5, 1), config: { mode: 'css', selector: 'h2:last-of-type ~ p' } },
    { id: 'fill-footer', type: 'replace', name: 'Fill the footer', position: at(6, 0), config: { ...replace } },

    { id: 'page', type: 'output', name: 'Scrolly page', position: at(7, 0), config: { format: 'html', fullDocument: true, inlineAssets: true } },
  ];
  const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  const edges = [
    edge('code', 'document', 'header-slots', 'document'),
    edge('text', 'document', 'header-text', 'document'),
    edge('header-slots', 'selection', 'fill-header', 'selection'),
    edge('header-text', 'selection', 'fill-header', 'content'),

    edge('fill-header', 'document', 'step-slots', 'document'),
    edge('text', 'document', 'step-text', 'document'),
    edge('step-slots', 'selection', 'fill-steps', 'selection'),
    edge('step-text', 'selection', 'fill-steps', 'content'),

    edge('fill-steps', 'document', 'footer-slots', 'document'),
    edge('text', 'document', 'footer-text', 'document'),
    edge('footer-slots', 'selection', 'fill-footer', 'selection'),
    edge('footer-text', 'selection', 'fill-footer', 'content'),

    edge('fill-footer', 'document', 'page', 'document'),
  ];
  const groups: NodeGroup[] = [
    { id: 'group-header', name: 'Header', nodeIds: ['header-slots', 'header-text', 'fill-header'], color: '#2563eb' },
    { id: 'group-steps', name: 'Steps', nodeIds: ['step-slots', 'step-text', 'fill-steps'], color: '#7c3aed' },
    { id: 'group-footer', name: 'Footer', nodeIds: ['footer-slots', 'footer-text', 'fill-footer'], color: '#0d9488' },
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
