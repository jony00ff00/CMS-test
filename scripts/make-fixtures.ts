// Generates the test documents in tests/fixtures. Run with `npm run fixtures`.
// The same content (src/samples.ts, also used by the app's example) is written as HTML, DOCX and JSON
// so tests can compare sources.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PNG_BASE64, SAMPLE_CONTENT as content, sampleHtml as html, sampleJson as json } from '../src/samples';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

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
