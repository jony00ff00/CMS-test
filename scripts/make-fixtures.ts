// Generates the test documents in tests/fixtures. Run with `npm run fixtures`.
// The same content is written as HTML, DOCX and JSON so tests can compare sources.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

// A 2x2 red PNG, small enough to inline.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMDAAAAMAAH0nkv8AAAAAElFTkSuQmCC';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

const content = {
  title: 'Field Guide to Node Gardens',
  intro: 'Node gardens grow best in well-structured documents.',
  sections: [
    { heading: 'Getting started', body: 'Plant a source node first. Then connect a selector to it.' },
    { heading: 'Pricing', body: 'The basic plan costs nothing. The pro plan adds snippets.' },
  ],
  quote: 'Every node does one job well.',
  steps: ['Upload a document', 'Select some text', 'Apply a snippet'],
  table: [
    ['Node', 'Input', 'Output'],
    ['Source', 'File', 'Document'],
    ['Selector', 'Document', 'Selection'],
  ],
};

function html(): string {
  const sections = content.sections.map((s) => `  <h2>${s.heading}</h2>\n  <p>${s.body}</p>`).join('\n');
  const steps = content.steps.map((s) => `    <li>${s}</li>`).join('\n');
  const [head, ...rows] = content.table;
  const tr = (cells: string[], tag: string) => `      <tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${content.title}</title></head>
<body>
  <h1>${content.title}</h1>
  <p>${content.intro.replace('well-structured', '<strong>well-structured</strong>').replace('grow best', '<em>grow best</em>')}</p>
${sections}
  <blockquote><p>${content.quote}</p></blockquote>
  <p><img src="data:image/png;base64,${PNG_BASE64}" alt="Logo"></p>
  <ol>
${steps}
  </ol>
  <table>
    <thead>
${tr(head, 'th')}
    </thead>
    <tbody>
${rows.map((r) => tr(r, 'td')).join('\n')}
    </tbody>
  </table>
</body>
</html>
`;
}

async function docx(): Promise<Buffer> {
  const cell = (text: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
  const doc = new Document({
    styles: {
      paragraphStyles: [{ id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { italics: true } }],
    },
    numbering: {
      config: [{ reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.' }] }],
    },
    sections: [{
      children: [
        new Paragraph({ text: content.title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun('Node gardens '),
            new TextRun({ text: 'grow best', italics: true }),
            new TextRun(' in '),
            new TextRun({ text: 'well-structured', bold: true }),
            new TextRun(' documents.'),
          ],
        }),
        ...content.sections.flatMap((s) => [
          new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: s.body }),
        ]),
        new Paragraph({ text: content.quote, style: 'Quote' }),
        new Paragraph({
          children: [new ImageRun({
            type: 'png',
            data: Buffer.from(PNG_BASE64, 'base64'),
            transformation: { width: 32, height: 32 },
            altText: { name: 'Logo', title: 'Logo', description: 'Logo' },
          })],
        }),
        ...content.steps.map((s) => new Paragraph({ text: s, numbering: { reference: 'steps', level: 0 } })),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: content.table.map((r, i) => new TableRow({ children: r.map((c) => cell(c, i === 0)) })),
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

function json(): string {
  return JSON.stringify({
    title: content.title,
    summary: `${content.intro}\n\nEach node does one job.`,
    articles: content.sections.map((s) => ({ title: s.heading, body: `<p>${s.body}</p>` })),
    faq: [
      { q: 'Can I use JSON?', a: 'Yes. Map **string fields** with JSONPath.' },
      { q: 'Is the source changed?', a: 'No. Nodes never change their inputs.\n\n- Sources stay intact\n- Output is new' },
    ],
    meta: { id: 'guide-001', tags: ['nodes', 'cms'] },
  }, null, 2) + '\n';
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const files: Record<string, string | Buffer> = {
    'sample.html': html(),
    'sample.docx': await docx(),
    'sample.json': json(),
    // Deliberately broken: trailing comma and an unclosed string.
    'sample-invalid.json': '{ "title": "Broken, "articles": [1, 2,] \n',
  };
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(outDir, name), data);
    console.log(`wrote tests/fixtures/${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
