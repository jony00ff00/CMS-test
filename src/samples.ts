// Sample content, used by the app's "Load example" and by scripts/make-fixtures.ts (the test files).
// Plain TypeScript with no dependencies, so both can import it.

/** A 2x2 red PNG, small enough to inline. */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMDAAAAMAAH0nkv8AAAAAElFTkSuQmCC';

export const SAMPLE_CONTENT = {
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

export function sampleHtml(): string {
  const content = SAMPLE_CONTENT;
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

export function sampleJson(): string {
  const content = SAMPLE_CONTENT;
  return (
    JSON.stringify(
      {
        title: content.title,
        summary: `${content.intro}\n\nEach node does one job.`,
        articles: content.sections.map((s) => ({ title: s.heading, body: `<p>${s.body}</p>` })),
        faq: [
          { q: 'Can I use JSON?', a: 'Yes. Map **string fields** with JSONPath.' },
          { q: 'Is the source changed?', a: 'No. Nodes never change their inputs.\n\n- Sources stay intact\n- Output is new' },
        ],
        meta: { id: 'guide-001', tags: ['nodes', 'cms'] },
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * A sample slide deck (written as tests/fixtures/sample.pptx). 12 text slides, so slide 10 must sort after slide 2,
 * then a table, a picture and a chart (`extras`, slides 13–15).
 */
export const SAMPLE_DECK = {
  title: SAMPLE_CONTENT.title,
  subtitle: 'A short tour in slides',
  slides: [
    ...SAMPLE_CONTENT.sections.map((s) => ({ title: s.heading, bullets: s.body.split('. ').map((b) => b.replace(/\.$/, '')), notes: `Talk about ${s.heading.toLowerCase()}.` })),
    { title: 'How it works', bullets: ['Sources', ['HTML, Word and JSON', ['And now PowerPoint']], 'Selectors'], notes: '' },
    { title: 'Steps', numbered: SAMPLE_CONTENT.steps, notes: 'Go through the steps slowly.' },
    { title: 'Hidden extra', bullets: ['Only for the long version'], notes: '', hidden: true },
    ...Array.from({ length: 5 }, (_, i) => ({ title: `Topic ${i + 1}`, bullets: [`Point ${i + 1}`], notes: '' })),
    { title: 'Thanks', bullets: [], notes: 'Questions?', link: { text: 'Read the docs', url: 'https://example.com/docs' } },
  ],
  extras: {
    table: { title: 'Nodes', rows: SAMPLE_CONTENT.table, merged: 'Everything else' },
    picture: { title: 'Our logo', alt: 'Logo', link: 'https://example.com/' },
    chart: { title: 'Growth', name: 'Gardens', categories: ['2024', '2025', '2026'], values: [3, 7, 12] },
  },
};

/** A second document for the "Two documents" example: a section of it is copied into the guide. */
export function sampleNotesHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Gardener's notes</title>
<style>.tip { color: #166534; font-weight: 600; }</style></head>
<body>
  <h1>Gardener's notes</h1>
  <p>Notes from the greenhouse.</p>
  <h2>Watering</h2>
  <p class="tip">Water a new node once, then let it settle.</p>
  <p>Old nodes need less water than new ones.</p>
  <h3>In winter</h3>
  <p>Water every other week.</p>
  <h2>Pests</h2>
  <p>Loops are the worst pest: the canvas refuses them.</p>
</body>
</html>
`;
}
