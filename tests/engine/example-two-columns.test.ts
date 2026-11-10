import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, parseHtml, runSelector } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildExample } from '../../scripts/make-example-two-columns';

describe('example: part of a Word document in two columns, pictures on the right', () => {
  it('opens without warnings and every node runs', async () => {
    const { project } = await buildExample();
    const { project: p, warnings } = parseProject(JSON.stringify(project));
    expect(warnings).toEqual([]);
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status, results[n.id].message]).toEqual([n.id, 'ok', undefined]);
    for (const n of p.graph.nodes) expect([n.id, results[n.id].warnings]).toEqual([n.id, []]);

    const html = results['output-8'].outputs.html as string;
    const page = parseHtml(html);
    const text = runSelector(page, { mode: 'css', selector: '.cms-two-col-text' });
    const media = runSelector(page, { mode: 'css', selector: '.cms-two-col-media img' });
    expect(text.matches).toHaveLength(1);
    // The text column keeps the paragraphs, without pictures; the three pictures are in the right column, in order.
    expect(runSelector(page, { mode: 'css', selector: '.cms-two-col-text p' }).matches).toHaveLength(5);
    expect(runSelector(page, { mode: 'css', selector: '.cms-two-col-text img' }).matches).toHaveLength(0);
    expect(media.matches).toHaveLength(3);
    expect(html).toMatch(/alt="Prepared soil[^"]*"[\s\S]*alt="Young sprouts[^"]*"[\s\S]*alt="The garden in full bloom"/);
    // The heading stays above the columns; the other sections are untouched.
    expect(html).toMatch(/<h2>Planting your first garden<\/h2>\s*<div class="cms-two-col cms-two-col--right"/);
    expect(html).toContain('<h2>Looking after it</h2>');
    expect(html).toContain('.cms-two-col{display:grid');
    expect(html).toMatch(/src="data:image\/png;base64,/);
  });

  it('the layout snippet is in the library, and the pictures can go on the left', async () => {
    const { project } = await buildExample();
    expect(project.library['two-columns']).toHaveLength(1);
    const { project: p } = parseProject(JSON.stringify(project));
    const snip = p.graph.nodes.find((n) => n.id === 'snippet-3')!;
    (snip.config as { params: Record<string, string> }).params.side = 'left';
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
    expect(results['output-8'].outputs.html as string).toContain('cms-two-col--left');
  });
});
