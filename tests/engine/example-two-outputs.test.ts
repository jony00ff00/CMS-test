import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, importSource, nodeRegistry, parseHtml, runSelector, serialize } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildTwoOutputsExample, chartScript, PROJECT_FILE, WORD_FILE } from '../../scripts/make-example-two-outputs';

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

  it('the Word document has the text and tables only: no pictures or videos', async () => {
    const doc = await importSource({ name: 'garden-year.docx', data: new Uint8Array(readFileSync(WORD_FILE)) });
    expect(count(serialize(doc), 'img, video')).toBe(0);
    expect(count(serialize(doc), 'table')).toBe(3);
  });

  it('the CMS adds the pictures (static) and videos (interactive) in the same places, with their captions', async () => {
    const { results } = await run();
    // What follows each picture / video: the introduction is before the first, the sections after the others.
    const order = (html: string, tag: string) =>
      [...html.matchAll(new RegExp(`<figure[^>]*><${tag}[^>]*>(?:</video>)?<figcaption>([^<]+)</figcaption></figure>(<[^>]+>[^<]{0,30})`, 'g'))].map((m) => [m[1], m[2]]);
    const expected = [
      ['The beds at dawn in May.', '<h2>Harvest by month'],
      ['Our three hives, kept by volunteers since March.', '<h2>Rainfall and soil moisture'],
      ['Autumn rain filling the ponds.', '<h2>Where the harvest went'],
    ];
    expect(order(results.static.outputs.html as string, 'img')).toEqual(expected);
    expect(order(results.interactive.outputs.html as string, 'video')).toEqual(expected);
    expect((results.static.outputs.html as string)).toContain('alt="The vegetable beds at dawn, with the sun rising behind the hills"');
    for (const id of ['picture-dawn', 'picture-hives', 'picture-rain', 'video-dawn', 'video-hives', 'video-rain']) expect(results[id].info).toMatchObject({ inserted: 1 });
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

  it('the interactive page: the same text and tables, animated charts, and a looping video for each picture', async () => {
    const { results } = await run();
    const html = results.interactive.outputs.html as string;
    expect(count(html, 'figure.cms-chart > table')).toBe(3);
    expect(count(html, 'img')).toBe(0);
    expect(count(html, 'video[autoplay][loop][muted][src^="data:video/webm;base64,"]')).toBe(3);
    // The videos are blocks of their own (never inside a <p>), with their captions.
    expect(count(html, 'p video')).toBe(0);
    expect(count(html, 'figure > video + figcaption')).toBe(3);
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
