// Generates the "Word part to two columns" example: a Word document with pictures among the text of one section,
// and a project file whose nodes turn that section into two columns, text on the left and pictures on the right.
// Run with `npm run example:two-columns`. Writes examples/word-two-columns.docx and .node-cms.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { storeFile, type Graph, type GraphNode, type Snippet } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

// ---------------------------------------------------------------------------------------------
// Pictures: small PNGs drawn here, so the example needs no outside files.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
type RGB = [number, number, number];
function png(width: number, height: number, pixel: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())]);
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

const W = 360;
const H = 240;
/** A sky, a hill and round "plants" of a given size and colour. */
function scene(sky: [RGB, RGB], ground: RGB, plant: RGB, plants: { x: number; r: number }[], sun?: RGB): Buffer {
  return png(W, H, (x, y) => {
    const hill = 150 + 18 * Math.sin(x / 55);
    for (const p of plants) {
      const cy = hill - p.r * 0.6;
      if ((x - p.x) ** 2 + (y - cy) ** 2 < p.r ** 2) return mix(plant, [255, 255, 255], ((y - cy + p.r) / (2 * p.r)) * 0.25);
      if (Math.abs(x - p.x) < 2 && y > cy && y < hill + 4) return [92, 64, 40];
    }
    if (y > hill) return mix(ground, [40, 30, 20], (y - hill) / (H - hill) * 0.5);
    if (sun && (x - 290) ** 2 + (y - 55) ** 2 < 26 ** 2) return sun;
    return mix(sky[0], sky[1], y / hill);
  });
}
const PICTURES = [
  { name: 'Prepared soil with the first seeds', data: scene([[186, 220, 245], [235, 245, 250]], [120, 84, 52], [134, 186, 92], [{ x: 90, r: 5 }, { x: 170, r: 5 }, { x: 250, r: 5 }], [255, 214, 102]) },
  { name: 'Young sprouts a week later', data: scene([[150, 205, 240], [225, 240, 248]], [112, 80, 50], [86, 168, 74], [{ x: 70, r: 14 }, { x: 150, r: 18 }, { x: 230, r: 15 }, { x: 300, r: 12 }]) },
  { name: 'The garden in full bloom', data: scene([[120, 180, 235], [250, 225, 200]], [96, 140, 70], [222, 92, 132], [{ x: 60, r: 26 }, { x: 140, r: 32 }, { x: 225, r: 28 }, { x: 305, r: 22 }], [255, 190, 80]) },
];

// ---------------------------------------------------------------------------------------------
// The Word document.

const picture = (i: number) =>
  new Paragraph({
    children: [new ImageRun({ type: 'png', data: PICTURES[i].data, transformation: { width: W, height: H }, altText: { name: PICTURES[i].name, title: PICTURES[i].name, description: PICTURES[i].name } })],
  });

async function wordDocument(): Promise<Buffer> {
  const p = (text: string) => new Paragraph({ children: [new TextRun(text)] });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'The Node Garden Handbook', heading: HeadingLevel.HEADING_1 }),
        p('This handbook takes you from bare soil to a garden that looks after itself. Read it in order the first time; later, jump to the part you need.'),
        new Paragraph({ text: 'Before you start', heading: HeadingLevel.HEADING_2 }),
        p('Choose a sunny spot with soil that drains well. A small bed of two by three metres is plenty for a first garden.'),
        new Paragraph({ text: 'Planting your first garden', heading: HeadingLevel.HEADING_2 }),
        p('Loosen the soil to the depth of a spade and work in a layer of compost. Rake it level, then mark rows about thirty centimetres apart.'),
        picture(0),
        p('Sow the seeds thinly along each row and cover them with a finger’s depth of fine soil. Water gently, so the seeds stay where you put them.'),
        p('Keep the soil moist but not wet. In warm weather the first sprouts appear within a week; in cool weather, give them two.'),
        picture(1),
        p('When the seedlings have two true leaves, thin them so each plant has room to grow. The thinnings make a good salad.'),
        p('From then on, water at the roots in the morning and pull weeds while they are small. Within a couple of months the bed fills out and flowers.'),
        picture(2),
        new Paragraph({ text: 'Looking after it', heading: HeadingLevel.HEADING_2 }),
        p('Cut back flowers as they fade, feed the soil with compost each spring, and keep notes of what grew well, so next year is easier still.'),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------------------------
// The project: which nodes, and how they are connected.

/** The layout, kept in the library so it can be used on other documents too. */
export const TWO_COLUMNS: Snippet = {
  kind: 'snippet',
  id: 'two-columns',
  name: 'Two columns with pictures',
  description: 'Puts the content in a text column, next to an empty column for pictures',
  version: 1,
  mode: 'wrap',
  template:
    '<div class="cms-two-col cms-two-col--{{params.side}}" style="--cms-media-width: {{params.mediaWidth}}">\n' +
    '  <div class="cms-two-col-text">{{content}}</div>\n' +
    '  <div class="cms-two-col-media"></div>\n' +
    '</div>',
  params: [
    { name: 'mediaWidth', label: 'Width of the picture column', type: 'text', default: '40%' },
    { name: 'side', label: 'Pictures on the', type: 'select', options: ['right', 'left'], default: 'right' },
  ],
  css: [
    '.cms-two-col{display:grid;grid-template-columns:minmax(0,1fr) var(--cms-media-width,40%);gap:1.5rem;align-items:start;margin:1rem 0}',
    '.cms-two-col--left{grid-template-columns:var(--cms-media-width,40%) minmax(0,1fr)}',
    '.cms-two-col--left .cms-two-col-media{order:-1}',
    '.cms-two-col-text>:first-child{margin-top:0}',
    '.cms-two-col-media{display:grid;gap:1rem}',
    '.cms-two-col-media p{margin:0}',
    '.cms-two-col-media img{display:block;width:100%;height:auto;border-radius:6px}',
    '@media (max-width:520px){.cms-two-col,.cms-two-col--left{grid-template-columns:1fr}.cms-two-col-media{order:0}}',
  ].join('\n'),
};

/** The CSS path the pictures of the changed part have once it is in two columns. */
const PICTURES_IN_TEXT = '.cms-two-col-text p:has(img)';

export function exampleGraph(fileId: string): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 260, y: 60 + row * 190 });
  const nodes: GraphNode[] = [
    { id: 'documentSource-1', type: 'documentSource', name: 'Word document', position: at(0, 0), config: { fileId } },
    {
      id: 'selector-2',
      type: 'selector',
      name: 'The part to change',
      position: at(1, 0),
      // The section under this heading (the heading itself stays above the columns).
      config: { mode: 'heading', text: 'Planting', match: 'contains', includeHeading: false },
    },
    {
      id: 'snippet-3',
      type: 'snippet',
      name: 'Two columns',
      position: at(2, 0),
      config: { snippet: structuredClone(TWO_COLUMNS), ref: { id: TWO_COLUMNS.id, version: 1 }, params: { mediaWidth: '40%', side: 'right' } },
    },
    { id: 'selector-4', type: 'selector', name: 'Pictures in the text', position: at(3, 0), config: { mode: 'css', selector: PICTURES_IN_TEXT } },
    {
      id: 'snippet-5',
      type: 'snippet',
      name: 'Take them out of the text',
      position: at(4, 0),
      config: {
        snippet: { kind: 'snippet', id: 'remove', name: 'Remove', description: 'Removes the selected content', version: 1, mode: 'replace', template: '', params: [] },
      },
    },
    {
      id: 'selector-6',
      type: 'selector',
      name: 'The picture column',
      position: at(5, 0),
      config: { mode: 'css', selector: '.cms-two-col-media', place: 'end' },
    },
    {
      id: 'object-7',
      type: 'object',
      name: 'Pictures on the right',
      position: at(6, 1),
      // A copy of what "Pictures in the text" selects, in the picture column.
      config: { content: { kind: 'selection', wrap: 'none', styles: false } },
    },
    { id: 'output-8', type: 'output', name: 'Web page', position: at(7, 0), config: { format: 'html', fullDocument: true, inlineAssets: true } },
  ];
  const edge = (id: string, source: string, sourcePort: string, target: string, targetPort: string) => ({ id, source, sourcePort, target, targetPort });
  const edges = [
    edge('e1', 'documentSource-1', 'document', 'selector-2', 'document'),
    edge('e2', 'selector-2', 'selection', 'snippet-3', 'selection'),
    edge('e3', 'snippet-3', 'document', 'selector-4', 'document'),
    edge('e4', 'selector-4', 'selection', 'snippet-5', 'selection'),
    edge('e5', 'snippet-5', 'document', 'selector-6', 'document'),
    edge('e6', 'selector-6', 'point', 'object-7', 'point'),
    edge('e7', 'selector-4', 'selection', 'object-7', 'content'),
    edge('e8', 'object-7', 'document', 'output-8', 'document'),
  ];
  const groups = [
    { id: 'group-1', name: 'Pictures to the right column', nodeIds: ['selector-4', 'snippet-5', 'selector-6', 'object-7'], color: '#0891b2' },
  ];
  return { nodes, edges, groups };
}

export async function buildExample() {
  const docx = new Uint8Array(await wordDocument());
  const file = storeFile('garden-handbook.docx', docx, 'garden-handbook');
  const library = seedLibrary();
  library[TWO_COLUMNS.id] = [structuredClone(TWO_COLUMNS)];
  const project = toProjectFile({ graph: exampleGraph(file.id), files: { [file.id]: file }, library }, new Date('2026-11-10T00:00:00Z'));
  return { docx, project };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { docx, project } = await buildExample();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'garden-handbook.docx'), docx);
  writeFileSync(join(outDir, 'word-two-columns.node-cms.json'), `${JSON.stringify(project, null, 2)}\n`);
  console.log('wrote examples/garden-handbook.docx and examples/word-two-columns.node-cms.json');
}
