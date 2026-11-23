import { describe, expect, it } from 'vitest';
import {
  fillTemplate, GraphEvaluator, nodeRegistry, parseHtml, serialize, storeFile, suggestFillRows, type FillRow, type GraphEdge, type GraphNode,
} from '../../src/engine';

const TEMPLATE = `<header><p class="gs-kicker">Old kicker</p><h2 class="gs-headline">Old title</h2><p class="gs-dek">Old dek</p></header>
<div class="steps"><article class="step" data-step="a"><h3 class="step-title">A</h3><div class="card"><p>old a</p></div></article><article class="step" data-step="b"><h3 class="step-title">B</h3><div class="card"><p>old b</p></div></article></div>
<footer><p class="credit">Old credit</p></footer>`;

const content = (steps: number) =>
  parseHtml(
    `<p class="kicker">New kicker</p><p class="title">New title</p><p class="dek">New dek</p>` +
      Array.from({ length: steps }, (_, i) => `<h2>Step ${i + 1}</h2><p>Text ${i + 1}</p>`).join('') +
      `<h2>Credits</h2><p>By the desk</p>`,
  );

const steps: FillRow = {
  id: 'steps',
  repeat: '.step',
  items: { mode: 'heading', text: 'Step', includeHeading: true },
  rows: [
    { id: 'title', slot: '.step-title', from: { mode: 'css', selector: 'h2' } },
    { id: 'card', slot: '.card', from: { mode: 'css', selector: 'p' } },
  ],
};
const header: FillRow[] = [
  { id: 'kicker', slot: '.gs-kicker', from: { mode: 'css', selector: '.kicker' } },
  { id: 'headline', slot: '.gs-headline', from: { mode: 'css', selector: '.title' } },
  { id: 'dek', slot: '.gs-dek', from: { mode: 'css', selector: '.dek' } },
];
const html = (d: { tree: unknown }) => serialize(d as never);

describe('fillTemplate', () => {
  it('fills slots by name, keeping the template\'s elements and attributes', async () => {
    const r = await fillTemplate(parseHtml(TEMPLATE), content(2), { rows: header });
    const out = html(r.document);
    expect(out).toContain('<p class="gs-kicker">New kicker</p>');
    expect(out).toContain('<h2 class="gs-headline">New title</h2>');
    expect(out).toContain('<p class="gs-dek">New dek</p>');
    expect(r.problems).toEqual([]);
    expect(r.report.map((x) => x.filled)).toEqual([1, 1, 1]);
  });

  it('repeats a template element once per item, in the content\'s order', async () => {
    for (const n of [1, 2, 3, 5]) {
      const r = await fillTemplate(parseHtml(TEMPLATE), content(n), { rows: [steps] });
      const out = html(r.document);
      expect(out.match(/<article/g)?.length, `${n} steps`).toBe(n);
      for (let i = 1; i <= n; i++) expect(out).toContain(`<h3 class="step-title">Step ${i}</h3><div class="card"><p>Text ${i}</p></div>`);
      expect(out).not.toContain('old a');
      expect(r.report[0]).toMatchObject({ slots: 2, matches: n, filled: n });
    }
    // Item i keeps template element i's attributes; extra items copy the last one.
    const out = html((await fillTemplate(parseHtml(TEMPLATE), content(3), { rows: [steps] })).document);
    expect([...out.matchAll(/data-step="(\w)"/g)].map((m) => m[1])).toEqual(['a', 'b', 'b']);
    // The rest of the template stays where it was.
    expect(out.indexOf('<footer>')).toBeGreaterThan(out.lastIndexOf('</article>'));
  });

  it('removes the repeated elements when there are no items, with a warning', async () => {
    const r = await fillTemplate(parseHtml(TEMPLATE), content(0), { rows: [steps] });
    expect(html(r.document)).not.toContain('<article');
    expect(r.warnings.join()).toContain('nothing in the content matches');
  });

  it('reports problems for required rows and item counts; warnings otherwise', async () => {
    const rows: FillRow[] = [
      { id: 'missing', slot: '.nope', from: { mode: 'css', selector: '.kicker' }, required: true },
      { id: 'empty', slot: '.gs-dek', from: { mode: 'css', selector: '.nothing' }, required: true },
      { id: 'soft', slot: '.credit', from: { mode: 'css', selector: '.nothing' } },
      { ...steps, min: 3, max: 8 },
    ];
    const r = await fillTemplate(parseHtml(TEMPLATE), content(2), { rows });
    expect(r.problems).toEqual([
      'Slot “.nope”: no such slot in the template',
      'Slot “.gs-dek”: nothing in the content matches, so the slot keeps the template’s text',
      'Repeat “.step”: found 2 items, expected at least 3',
    ]);
    expect(r.warnings).toContain('Slot “.credit”: nothing in the content matches, so the slot keeps the template’s text');
    expect(r.report.find((x) => x.id === 'steps')?.problem).toBe('found 2 items, expected at least 3');
    // Rows inside a repeat report per item.
    const inner = await fillTemplate(parseHtml(TEMPLATE), content(2), {
      rows: [{ ...steps, rows: [{ id: 'x', slot: '.missing', from: { mode: 'css', selector: 'p' }, required: true }] }],
    });
    expect(inner.problems).toEqual(['Repeat “.step”, item 1: Slot “.missing”: no such slot in the template', 'Repeat “.step”, item 2: Slot “.missing”: no such slot in the template']);
  });

  it('pairs several slots with the matches in order', async () => {
    const r = await fillTemplate(parseHtml('<p class="s">1</p><p class="s">2</p>'), parseHtml('<p>a</p><p>b</p><p>c</p>'), {
      rows: [{ id: 'r', slot: '.s', from: { mode: 'css', selector: 'p' } }],
    });
    expect(html(r.document)).toBe('<p class="s">a</p><p class="s">b</p>');
    expect(r.warnings).toEqual(['Slot “.s”: 2 slots for 3 matches']);
  });

  it('can replace the slot element itself', async () => {
    const r = await fillTemplate(parseHtml('<div><span class="s">x</span></div>'), parseHtml('<blockquote>Q</blockquote>'), {
      rows: [{ id: 'r', slot: '.s', from: { mode: 'css', selector: 'blockquote' }, target: 'element' }],
    });
    expect(html(r.document)).toBe('<div><blockquote>Q</blockquote></div>');
  });

  it('never changes its inputs', async () => {
    const template = parseHtml(TEMPLATE);
    const before = html(template);
    await fillTemplate(template, content(3), { rows: [...header, steps] });
    expect(html(template)).toBe(before);
  });
});

describe('suggestFillRows', () => {
  it('matches template classes to content classes by name', () => {
    const rows = suggestFillRows(parseHtml(TEMPLATE + '<p data-slot="note">n</p>'), parseHtml('<p class="kicker">k</p><p class="dek">d</p><p class="title">t</p><p class="note">x</p>'));
    expect(rows.map((r) => [r.slot, r.from.mode === 'css' && r.from.selector])).toEqual([
      ['.gs-kicker', '.kicker'],
      ['.gs-dek', '.dek'],
      ['.step-title', '.title'], // a suggestion: names can mislead, so the rows stay editable
      ['[data-slot="note"]', '.note'],
    ]);
    // Slots already used are not suggested again.
    expect(suggestFillRows(parseHtml(TEMPLATE), parseHtml('<p class="kicker">k</p>'), [header[0]])).toEqual([]);
  });
});

describe('Fill template node', () => {
  const files = { tpl: storeFile('page.html', TEMPLATE, 'tpl'), text: storeFile('text.html', '<p class="kicker">K</p><h2>Step 1</h2><p>One</p>', 'text') };
  const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
  const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}>${target}.${targetPort}`, source, sourcePort, target, targetPort });

  it('waits for rows, then fills the template from the content', async () => {
    const graph = {
      nodes: [node('tpl', 'documentSource', { fileId: 'tpl' }), node('text', 'documentSource', { fileId: 'text' }), node('fill', 'fillTemplate')],
      edges: [edge('tpl', 'document', 'fill', 'template'), edge('text', 'document', 'fill', 'content')],
    };
    const evaluator = new GraphEvaluator(nodeRegistry);
    let r = (await evaluator.evaluate(graph, { files })).results;
    expect(r.fill.status).toBe('waiting');
    graph.nodes[2] = node('fill', 'fillTemplate', { rows: [header[0], { ...steps, min: 2 }] });
    r = (await evaluator.evaluate(graph, { files })).results;
    expect(r.fill.status).toBe('ok');
    const out = html(r.fill.outputs.document as never);
    expect(out).toContain('<p class="gs-kicker">K</p>');
    expect(out.match(/<article/g)).toHaveLength(1);
    expect(r.fill.problems).toEqual(['Repeat “.step”: found 1 item, expected at least 2']);
    expect(r.fill.info).toMatchObject({ rows: 2, filled: 2, from: 'text.html' });
  });
});
