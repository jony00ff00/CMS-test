import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, parseHtml, runSelector } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildTwoOutputsExample, chartScript, PROJECT_FILE } from '../../scripts/make-example-two-outputs';

async function run() {
  const { project: p, warnings } = parseProject(JSON.stringify(await buildTwoOutputsExample()));
  const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
  return { p, warnings, results };
}
const count = (html: string, css: string) => runSelector(parseHtml(html, { keepCode: true }), { mode: 'css', selector: css }).matches.length;

describe('example: one Word document, two outputs', () => {
  it('every node runs without warnings', async () => {
    const { p, warnings, results } = await run();
    expect(warnings).toEqual([]);
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status, results[n.id].warnings]).toEqual([n.id, 'ok', []]);
    expect(p.graph.notes).toHaveLength(1);
  });

  it('the static page: three charts from the tables, three pictures, no videos, no animation code', async () => {
    const html = (await run()).results.static.outputs.html as string;
    expect(count(html, 'figure.cms-chart > table')).toBe(3);
    expect([...html.matchAll(/data-chart="(\w+)"/g)].map((m) => m[1])).toEqual(['bar', 'line', 'donut']);
    expect(count(html, 'img')).toBe(3);
    expect(count(html, 'video')).toBe(0);
    expect(html).toContain('var INTERACTIVE = false;');
    expect(html).not.toContain('var INTERACTIVE = true;');
    expect(html).not.toMatch(/transition:/);
  });

  it('the interactive page: the same text and tables, animated charts, and each picture a looping video', async () => {
    const { results } = await run();
    const html = results.interactive.outputs.html as string;
    expect(count(html, 'figure.cms-chart > table')).toBe(3);
    expect(count(html, 'img')).toBe(0);
    expect(count(html, 'video[autoplay][loop][muted][src^="data:video/webm;base64,"]')).toBe(3);
    // The videos replace the pictures' paragraphs (no <video> inside a <p>), and the captions stay.
    expect(count(html, 'p video')).toBe(0);
    expect(html).toContain('<em>The beds at dawn in May.</em>');
    expect(html).toContain('var INTERACTIVE = true;');
    expect(html).toMatch(/\.cms-chart-bar\{transition:/);
    // Same words in both pages.
    const words = (h: string) => parseHtml(h).tree.children.length;
    expect(words(html)).toBe(words(results.static.outputs.html as string));
  });

  it('the chart script is plain browser JavaScript', () => {
    expect(() => new Function(chartScript(true))).not.toThrow();
    expect(() => new Function(chartScript(false))).not.toThrow();
  });

  it('the committed project file is up to date (run `npm run example:two-outputs` after changing the example)', async () => {
    expect(JSON.parse(readFileSync(PROJECT_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(await buildTwoOutputsExample())));
  });
});
