import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEvaluator, nodeRegistry, type CkeditorResult } from '../../src/engine';
import { parseProject } from '../../src/store/project';
import { buildWordReviewExample, NUMBERED_OUTPUT_FILE, NUMBERED_PROJECT_FILE, numberedOutput, PROJECT_FILE } from '../../scripts/make-example-word-review';

async function run(project: unknown) {
  const { project: p, warnings } = parseProject(JSON.stringify(project));
  const { results } = await new GraphEvaluator(nodeRegistry).evaluate(p.graph, { files: p.files });
  return { p, warnings, results };
}

describe('example: a Word file under review → CKEditor 5', () => {
  it('every node runs; the output has the suggestions, Word’s comments, the notes and the house style’s labels', async () => {
    const { p, warnings, results } = await run(await buildWordReviewExample());
    expect(warnings).toEqual([]);
    for (const n of p.graph.nodes) expect([n.id, results[n.id].status]).toEqual([n.id, 'ok']);
    expect(results.word.info).toMatchObject({ changes: 9, comments: 4 });
    expect(results.changes.info).toMatchObject({ kept: 9, threadsKept: 3, threadsDropped: 1 });
    expect(results.format.info).toMatchObject({ formats: 17, changed: 29, labels: 29, typedNumbers: 5 });
    expect(results.ckeditor.info).toMatchObject({ format: 'ckeditor', suggestions: 7, threads: 33 });
    // Only one thing is left to set: the editor bundle version.
    expect(results.ckeditor.warnings).toEqual(['No editor bundle version given: the import needs the version of the editor bundle uploaded to Cloud Services']);
    const ck = results.ckeditor.outputs.ckeditor as CkeditorResult;
    expect(ck.users.map((u) => u.id)).toEqual(['reviewer-1', 'house-style']);
    expect(ck.commentThreads.filter((t) => t.comments[0].authorId === 'reviewer-1').map((t) => t.comments[0].content)).toEqual([
      '<p>can we have a more professional word?</p>',
      '<p>Tracked change in Word: Reviewer changed the formatting of the paragraphs here (they were: Normal, bulleted list). It is shown as it is now; accept it, or change it back here.</p>',
      '<p>Why this option first?</p>',
      '<p>TOo vague</p>',
    ]);
    expect(JSON.parse(results.ckeditor.outputs.json as string).id).toBe('ge16-hung-by-design');
  });

  it('numbered: every paragraph numbered in running order, no numbers on headings, one font and size, no colours', async () => {
    const { results } = await run(await buildWordReviewExample(true));
    expect(results.format.info).toMatchObject({ numbered: 67 });
    expect(results.ckeditor.warnings).toEqual(['No editor bundle version given: the import needs the version of the editor bundle uploaded to Cloud Services']);
    const data = (results.ckeditor.outputs.ckeditor as CkeditorResult).data.replace(/<(comment|suggestion)-(start|end)[^>]*><\/\1-\2>/g, '');
    // Lists in running order: each starts where the one before stopped.
    let next = 1;
    for (const [, start, items] of data.matchAll(/<ol(?: start="(\d+)")?>([^]*?)<\/ol>/g)) {
      expect(Number(start ?? 1)).toBe(next);
      next += items.split('<li>').length - 1;
    }
    expect(next - 1).toBe(67);
    // Nothing outside a list but headings and tables; no bullets.
    expect(data.replace(/<ol[^]*?<\/ol>|<h[234]>[^]*?<\/h[234]>|<figure class="table">[^]*?<\/figure>/g, '')).toBe('');
    expect(data).not.toMatch(/<ul|<h[234]><ol/);
    // No fonts, sizes, highlights or colours (the Word file has a yellow highlight and blue link text), no underline.
    expect(data).not.toMatch(/style=|<span|<u>|<mark|color|font/i);
  });

  it('the committed project files and the numbered CKEditor import are up to date (run `npm run example:word-review`)', async () => {
    expect(JSON.parse(readFileSync(NUMBERED_PROJECT_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(await buildWordReviewExample(true))));
    expect(readFileSync(NUMBERED_OUTPUT_FILE, 'utf8')).toBe(await numberedOutput());
  });

  it('the committed project file is up to date (run `npm run example:word-review` after changing the example)', async () => {
    expect(JSON.parse(readFileSync(PROJECT_FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(await buildWordReviewExample())));
  });
});
