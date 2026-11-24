import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, parseHtml, runSelector, textOf, indexDocument, type CmsDocument, type FillReport } from '../../src/engine';
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
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status, results[n.id].warnings, results[n.id].problems]).toEqual([n.id, 'ok', [], undefined]);
    // Code and text, one Fill template node, then two pages: the interactive one, and a static one (three nodes leave
    // the graphic and its code out and give it an article look).
    expect(p.graph.nodes.map((n) => `${n.type}:${n.id}`)).toEqual([
      'documentSource:code', 'documentSource:text', 'fillTemplate:fill', 'output:page',
      'selector:static-code', 'object:static-strip', 'snippet:static-look', 'output:static',
    ]);
    const report = results.fill.outputs.report as FillReport[];
    expect(report.map((r) => [r.id, r.slots, r.matches, r.filled])).toEqual([
      ['kicker', 1, 1, 1], ['headline', 1, 1, 1], ['dek', 1, 1, 1], ['steps', 10, 10, 10], ['footer', 2, 2, 2],
    ]);

    const word = results.text.outputs.document as CmsDocument;
    const page = results.fill.outputs.document as CmsDocument;
    // The header and the cards say what the Word document says, in order.
    expect(texts(page, '.gs-kicker, .gs-headline, .gs-dek')).toEqual(texts(word, '.kicker, .title, .dek'));
    expect(texts(page, '.gs-card')).toEqual(texts(word, 'h2 + p').slice(0, 10));
    expect(texts(page, '.gs-card strong')).toEqual(['Anwar Ibrahim', 'Ahmad Zahid Hamidi', 'Abdul Hadi Awang', 'Muhyiddin Yassin', 'Abang Johari Openg and Hajiji Noor']);
    // The footer: the note in italics, the link keeps its address.
    expect(texts(page, '.gs-footer em')[0]).toMatch(/^A scenario, not a forecast:/);
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
    const page = results.fill.outputs.document as CmsDocument;
    expect(texts(page, '.gs-kicker, .gs-headline, .gs-dek')).toEqual(['Kicker 2', 'A new headline', 'New dek.']);
    expect(texts(page, '.gs-card')[0]).toBe('New text 1.');
    expect(texts(page, '.gs-step[data-step="distribution"] .gs-card p')).toEqual(['New text 2.', 'A second paragraph.']);
    expect(texts(page, '.gs-footer > p')).toEqual(['New note.', 'Read it all']);
    expect(runSelector(page, { mode: 'css', selector: '.gs-footer a[href="#full-brief"]' }).matches).toHaveLength(1);
  });

  it('the static page: the same text as an article, with the data tables shown, and no script', async () => {
    const { results } = await run(buildScrollyExample());
    const interactive = parseHtml(results.page.outputs.html as string, { keepCode: true });
    const page = parseHtml(results.static.outputs.html as string, { keepCode: true });
    const count = (doc: CmsDocument, css: string) => runSelector(doc, { mode: 'css', selector: css }).matches.length;
    expect(results.static.outputs.html as string).not.toContain('<script');
    expect(count(page, '.gs-graphic')).toBe(0);
    expect(count(page, 'div.gs-static > ge16-scrolly')).toBe(1);
    // The same words: header, every step, the tables and the footer.
    for (const css of ['.gs-kicker, .gs-headline, .gs-dek', '.gs-card', 'table caption', '.gs-footer p']) expect(texts(page, css), css).toEqual(texts(interactive, css));
    expect(count(page, '.gs-step')).toBe(10);
    expect(results.static.outputs.html as string).toContain('.gs-static table{');
    expect(results.static.upstreamProblems).toBeUndefined();
  });

  it('the step cards follow the Word steps: more steps, more cards; fewer, fewer', async () => {
    for (const n of [12, 4]) {
      const project = buildScrollyExample();
      const steps = Array.from({ length: n }, (_, i) => `<h2>Step ${i + 1}</h2><p>Card ${i + 1}.</p>`).join('');
      const text = project.files.find((f) => f.id === 'scrolly-text')!;
      Object.assign(text, { name: 'edited.html', data: `<p class="kicker">K</p><p class="title">T</p><p class="dek">D</p>${steps}<h2>Footer</h2><p>Note</p><p>Link</p>`, encoding: 'text' });
      const { results } = await run(project);
      const page = results.fill.outputs.document as CmsDocument;
      expect(texts(page, '.gs-card'), `${n} steps`).toEqual(Array.from({ length: n }, (_, i) => `Card ${i + 1}.`));
      // Existing cards keep their own step (the graphic's state); extra ones copy the last.
      const ids = runSelector(page, { mode: 'css', selector: '.gs-step' }).matches.length;
      expect(ids).toBe(n);
      expect(results.page.upstreamProblems).toBeUndefined();
      expect(runSelector(results['static-look'].outputs.document as CmsDocument, { mode: 'css', selector: '.gs-step' }).matches).toHaveLength(n);
    }
  });

  it('a missing kicker is a problem, and the page cannot be downloaded until it is fixed', async () => {
    const project = buildScrollyExample();
    const text = project.files.find((f) => f.id === 'scrolly-text')!;
    Object.assign(text, { name: 'edited.html', data: '<p class="title">T</p><p class="dek">D</p><h2>Step 1</h2><p>One.</p>', encoding: 'text' });
    const { results } = await run(project);
    const problem = [{ nodeId: 'fill', problem: 'Slot “.gs-kicker”: nothing in the content matches, so the slot keeps the template’s text' }];
    // Both pages show it.
    expect(results.page.upstreamProblems).toEqual(problem);
    expect(results.static.upstreamProblems).toEqual(problem);
  });

  it('has notes on the canvas saying what the example is for', () => {
    const { project, warnings } = parseProject(JSON.stringify(buildScrollyExample()));
    expect(warnings).toEqual([]);
    expect(project.graph.notes?.slice(0, 1)).toEqual([
      {
        id: 'note-1',
        text: 'Example for merging text changes with pre-existing scrolly-telly code.\nAllows text to be easily updated by users, without requiring specialised tools.',
        position: { x: 40, y: -110 },
        width: 420,
      },
    ]);
  });

  it('the committed project file is up to date (run `npm run example:scrolly` after changing the example)', () => {
    const saved = JSON.parse(readFileSync(PROJECT_FILE, 'utf8'));
    expect(saved).toEqual(JSON.parse(JSON.stringify(buildScrollyExample())));
  });
});
