import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, parseHtml, runSelector, textOf, indexDocument, type CmsDocument } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildScrollyExample, PROJECT_FILE } from '../../scripts/make-example-scrolly';

const texts = (doc: CmsDocument, selector: string) => {
  const ix = indexDocument(doc);
  return runSelector(doc, { mode: 'css', selector }).matches.map((m) => textOf(ix, m.match).trim());
};

async function run(project: unknown) {
  const { project: p, warnings } = parseProject(JSON.stringify(project));
  const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
  return { p, warnings, results };
}

describe('example: a scrolly from Word text and HTML code', () => {
  it('every node runs without warnings, and every text slot gets the Word text', async () => {
    const { p, warnings, results } = await run(buildScrollyExample());
    expect(warnings).toEqual([]);
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status, results[n.id].warnings]).toEqual([n.id, 'ok', []]);
    expect(results['fill-header'].info.replaced).toBe(3);
    expect(results['fill-steps'].info.replaced).toBe(10);
    expect(results['fill-footer'].info.replaced).toBe(2);

    const word = results.text.outputs.document as CmsDocument;
    const page = results['fill-footer'].outputs.document as CmsDocument;
    // The header and the cards say what the Word document says, in order.
    expect(texts(page, '.gs-kicker, .gs-headline, .gs-dek')).toEqual(texts(word, '.kicker, .title, .dek'));
    expect(texts(page, '.gs-card')).toEqual(texts(word, 'h2 + p').slice(0, 10));
    expect(texts(page, '.gs-card strong')).toEqual(['Anwar Ibrahim', 'Ahmad Zahid Hamidi', 'Abdul Hadi Awang', 'Muhyiddin Yassin', 'Abang Johari Openg and Hajiji Noor']);
    // The footer: the note in italics, the link keeps its address.
    expect(texts(page, '.gs-footer em')[0]).toMatch(/^Scenario analysis\./);
    expect(runSelector(page, { mode: 'css', selector: '.gs-footer a[href="#full-brief"]' }).matches).toHaveLength(1);
  });

  it('the code stays the code: its style and script inside the element, the classes and data attributes unchanged', async () => {
    const { results } = await run(buildScrollyExample());
    const html = results.page.outputs.html as string;
    const page = parseHtml(html, { keepCode: true });
    expect(runSelector(page, { mode: 'css', selector: 'ge16-scrolly#ge16-scrolly > style' }).matches).toHaveLength(1);
    expect(runSelector(page, { mode: 'css', selector: 'ge16-scrolly#ge16-scrolly > script' }).matches).toHaveLength(1);
    expect(runSelector(page, { mode: 'css', selector: '.gs-step[data-step] > .gs-card > p' }).matches).toHaveLength(10);
    expect(html).toContain('<title>Hung by Design · GE16 (short)</title>');
    // The script's own "editor-safe" rules still hold (no less-than signs or backticks were added to it).
    const script = /<script>([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf('<ge16-scrolly')))![1];
    expect(script).toBe(/<script>([\s\S]*?)<\/script>/.exec(readFileSync('examples/scrolly/ge16-scrolly-short.html', 'utf8'))![1]);
  });

  it('edited text shows up in the scrolly: a step with two paragraphs, a new headline, a renamed link', async () => {
    const project = buildScrollyExample();
    const steps = Array.from({ length: 10 }, (_, i) => `<h2>Step ${i + 1}</h2><p>New text ${i + 1}.</p>${i === 1 ? '<p>A second paragraph.</p>' : ''}`).join('');
    const edited = `<p class="kicker">Kicker 2</p><p class="title">A new headline</p><p class="dek">New dek.</p>${steps}<h2>Footer</h2><p><em>New note.</em></p><p>Read it all</p>`;
    const text = project.files.find((f) => f.id === 'scrolly-text')!;
    Object.assign(text, { name: 'edited.html', data: edited, encoding: 'text' });
    const { results } = await run(project);
    const page = results['fill-footer'].outputs.document as CmsDocument;
    expect(texts(page, '.gs-kicker, .gs-headline, .gs-dek')).toEqual(['Kicker 2', 'A new headline', 'New dek.']);
    expect(texts(page, '.gs-card')[0]).toBe('New text 1.');
    expect(texts(page, '.gs-step[data-step="distribution"] .gs-card p')).toEqual(['New text 2.', 'A second paragraph.']);
    expect(texts(page, '.gs-footer > p')).toEqual(['New note.', 'Read it all']);
    expect(runSelector(page, { mode: 'css', selector: '.gs-footer a[href="#full-brief"]' }).matches).toHaveLength(1);
  });

  it('the committed project file is up to date (run `npm run example:scrolly` after changing the example)', () => {
    const saved = JSON.parse(readFileSync(PROJECT_FILE, 'utf8'));
    expect(saved).toEqual(JSON.parse(JSON.stringify(buildScrollyExample())));
  });
});
