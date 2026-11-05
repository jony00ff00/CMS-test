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
