// Generates the test documents in tests/fixtures. Run with `npm run fixtures`.
// The same content (src/samples.ts, also used by the app's example) is written as HTML, DOCX and JSON
// so tests can compare sources.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, HeadingLevel, ImageRun, InsertedTextRun, LevelFormat,
  Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import { PNG_BASE64, SAMPLE_CONTENT as content, SAMPLE_DECK, sampleHtml as html, sampleJson as json } from '../src/samples';

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

type Bullets = (string | Bullets)[];

/** The sample deck, with real title / body placeholders from a slide master (as PowerPoint makes them). */
async function pptx(): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.defineSlideMaster({
    title: 'TITLE_AND_CONTENT',
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.3, w: 9, h: 1 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.5, y: 1.5, w: 9, h: 3.5 }, text: '' } },
    ],
  });
  const first = pres.addSlide({ masterName: 'TITLE_AND_CONTENT' });
  first.addText(SAMPLE_DECK.title, { placeholder: 'title' });
  first.addText(SAMPLE_DECK.subtitle, { x: 0.5, y: 2, w: 9, h: 1 });
  const items = (list: Bullets, level = 0): PptxGenJS.TextProps[] =>
    list.flatMap((b) => (typeof b === 'string' ? [{ text: b, options: { bullet: true, indentLevel: level, breakLine: true } }] : items(b, level + 1)));
  for (const s of SAMPLE_DECK.slides) {
    const slide = pres.addSlide({ masterName: 'TITLE_AND_CONTENT' });
    if ('hidden' in s && s.hidden) slide.hidden = true;
    slide.addText(s.title, { placeholder: 'title' });
    if ('numbered' in s && s.numbered) {
      slide.addText(s.numbered.map((t) => ({ text: t, options: { bullet: { type: 'number' }, breakLine: true } })), { placeholder: 'body' });
    } else if (s.bullets?.length) slide.addText(items(s.bullets as Bullets), { placeholder: 'body' });
    if ('link' in s && s.link) {
      slide.addText(
        [{ text: 'More: ', options: { bold: true } }, { text: s.link.text, options: { hyperlink: { url: s.link.url } } }],
        { x: 0.5, y: 4.5, w: 9, h: 0.6 },
      );
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const { table, picture, chart } = SAMPLE_DECK.extras;
  const tableSlide = pres.addSlide({ masterName: 'TITLE_AND_CONTENT' });
  tableSlide.addText(table.title, { placeholder: 'title' });
  tableSlide.addTable(
    [
      ...table.rows.map((r, i) => r.map((text) => ({ text, options: { bold: i === 0 } }))),
      [{ text: table.merged, options: { colspan: 3 } }],
    ],
    { x: 0.5, y: 1.5, w: 9 },
  );
  const pictureSlide = pres.addSlide({ masterName: 'TITLE_AND_CONTENT' });
  pictureSlide.addText(picture.title, { placeholder: 'title' });
  pictureSlide.addImage({ data: `image/png;base64,${PNG_BASE64}`, x: 1, y: 1.5, w: 2, h: 2, altText: picture.alt, hyperlink: { url: picture.link } });
  const chartSlide = pres.addSlide({ masterName: 'TITLE_AND_CONTENT' });
  chartSlide.addText(chart.title, { placeholder: 'title' });
  chartSlide.addChart(pres.ChartType.bar, [{ name: chart.name, labels: chart.categories, values: chart.values }], {
    x: 1, y: 1.5, w: 8, h: 3.5, showTitle: true, title: chart.title,
  });
  return (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
}

/**
 * A Word file under review (docx-review.ts): an insertion and a deletion by two authors, a comment across two
 * paragraphs with a reply, a resolved comment, a comment on a point, and inconsistent formatting.
 */
async function reviewDocx(): Promise<Buffer> {
  const at = (minute: number) => `2026-11-02T09:${String(minute).padStart(2, '0')}:00Z`;
  const comment = (id: number, author: string, text: string, extra: { parentId?: number; resolved?: boolean } = {}) => ({
    id, author, initials: author[0], date: new Date(at(30 + id)), children: [new Paragraph({ children: [new TextRun(text)] })], ...extra,
  });
  const doc = new Document({
    comments: {
      children: [
        comment(1, 'Ana', 'Is this still true?'),
        comment(2, 'Ben', 'Yes, checked.', { parentId: 1 }),
        comment(3, 'Ben', 'Fixed already.', { resolved: true }),
        comment(4, 'Ana', 'Add a picture here?'),
      ],
    },
    sections: [{
      children: [
        new Paragraph({ text: 'Garden notes', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun('Water '),
            new DeletedTextRun({ text: 'daily', id: 101, author: 'Ana', date: at(1) }),
            new InsertedTextRun({ text: 'twice a week', id: 102, author: 'Ben', date: at(2) }),
            new TextRun(' in summer.'),
          ],
        }),
        new Paragraph({ children: [new CommentRangeStart(1), new TextRun('Seeds sprout in spring.')] }),
        new Paragraph({ children: [new TextRun('Pots drain best.'), new CommentRangeEnd(1), new TextRun({ children: [new CommentReference(1)] })] }),
        new Paragraph({ children: [new TextRun({ text: 'Pests', bold: true, size: 32, font: 'Calibri' })] }),
        new Paragraph({
          children: [new CommentRangeStart(3), new TextRun('Snails come at night.'), new CommentRangeEnd(3), new TextRun({ children: [new CommentReference(3)] }),
            new TextRun(' Done.'), new TextRun({ children: [new CommentReference(4)] })],
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
    'review.docx': await reviewDocx(),
    'sample.pptx': await pptx(),
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
