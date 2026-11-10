import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySnippet, GraphEvaluator, joinMatches, nodeRegistry, parseHtml, runSelector, serialize, type Snippet } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildScrollyFromTextExample, CODE_FILE, PROJECT_FILE } from '../../scripts/make-example-scrolly-from-text';

async function run(project: unknown) {
  const { project: p, warnings } = parseProject(JSON.stringify(project));
  const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
  return { p, warnings, results };
}

/** The page body without the code elements, whitespace between tags removed. */
const body = (html: string) => serialize(parseHtml(html)).replace(/>\s+</g, '><');

describe('example: the scrolly made from the Word text alone', () => {
  it('the project holds only the Word file; every node runs without warnings', async () => {
    const project = buildScrollyFromTextExample();
    expect(project.files.map((f) => f.name)).toEqual(['ge16-scrolly-short-text.docx']);
    const { p, warnings, results } = await run(project);
    expect(warnings).toEqual([]);
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status, results[n.id].warnings]).toEqual([n.id, 'ok', []]);
    expect(results['step-cards'].info.applied).toBe(10);
  });

  it('gives the same page as the developer’s HTML file (apart from the kicker, typed in capitals in Word)', async () => {
    const { results } = await run(buildScrollyFromTextExample());
    const made = (results.page.outputs.html as string);
    const expected = body(readFileSync(CODE_FILE, 'utf8'));
    expect(body(made).replace('SCENARIO · GE16', 'Scenario · GE16').replace('<h2 class="gs-headline" id="gs-headline">', '<h2 id="gs-headline" class="gs-headline">')).toBe(expected);
    // The CSS and JavaScript: in the page, marked with their snippet, the script unchanged after the few lines that
    // put the CSS inside the element.
    const original = readFileSync(CODE_FILE, 'utf8');
    const css = /<style>([\s\S]*?)<\/style>/.exec(original)![1].trim();
    const js = /<script>([\s\S]*?)<\/script>/.exec(original)![1].trim();
    expect(made).toContain(`<style data-snippet="ge16-scrolly@1">/* ge16-scrolly@1 */\n${css}</style>`);
    expect(made).toContain(js);
  });

  it('edited text and a new step name come through', async () => {
    const project = buildScrollyFromTextExample();
    const steps = Array.from({ length: 10 }, (_, i) => `<h2>Step ${i + 1}</h2><p>Text ${i + 1}.</p>`).join('');
    Object.assign(project.files[0], {
      name: 'edited.html',
      encoding: 'text',
      data: `<p class="gs-kicker">K</p><h2 class="gs-headline">New headline</h2><p class="gs-dek">D</p>${steps}<h2>Footer</h2><p><em>Note.</em></p><p>Read the full brief</p>`,
    });
    const card = project.graph.nodes.find((n) => n.id === 'step-cards')!.config as { params: { steps: string } };
    card.params.steps = card.params.steps.replace('tie', 'opening');
    const { results } = await run(project);
    const page = parseHtml(results.page.outputs.html as string);
    const sel = (css: string) => runSelector(page, { mode: 'css', selector: css }).matches.map((m) => m.text.trim());
    expect(sel('#gs-headline')).toEqual(['New headline']);
    expect(sel('.gs-step[data-step="opening"] .gs-card')).toEqual(['Text 1.']);
    expect(sel('.gs-footer a[href="#full-brief"]')).toEqual(['Read the full brief']);
  });

  it('the committed project file is up to date (run `npm run example:scrolly` after changing the example)', () => {
    expect(JSON.parse(readFileSync(PROJECT_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildScrollyFromTextExample())));
  });
});

describe('the pieces it uses', () => {
  it('a Selector can join neighbouring matches, so one wrapper goes around them', async () => {
    const doc = parseHtml('<h1>T</h1><p>a</p>\n<p>b</p><div>x</div><p>c</p>');
    const joined = joinMatches(runSelector(doc, { mode: 'css', selector: 'p' }));
    expect(joined.matches.map((m) => m.text)).toEqual(['a\nb', 'c']);
    const wrap: Snippet = { kind: 'snippet', id: 'w', name: 'W', version: 1, mode: 'wrap', template: '<section>{{content}}</section>', params: [] };
    expect(serialize((await applySnippet(joined, wrap)).document)).toBe('<h1>T</h1><section><p>a</p><p>b</p></section><div>x</div><section><p>c</p></section>');
  });

  it('{{item list index}} picks a name per match', async () => {
    const doc = parseHtml('<p>a</p><p>b</p><p>c</p>');
    const s: Snippet = { kind: 'snippet', id: 'i', name: 'I', version: 1, mode: 'wrap', template: '<div data-step="{{item params.names index}}">{{content}}</div>', params: [{ name: 'names', type: 'text', default: 'one, two' }] };
    const r = await applySnippet(runSelector(doc, { mode: 'css', selector: 'p' }), s, { params: { names: 'one, two' } });
    expect(serialize(r.document)).toBe('<div data-step="one"><p>a</p></div><div data-step="two"><p>b</p></div><div data-step=""><p>c</p></div>');
  });
});
