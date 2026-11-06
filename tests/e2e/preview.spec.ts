import { expect, test, type Frame, type Page } from '@playwright/test';
import { join } from 'node:path';
import { buildTextIndex, importSource } from '../../src/engine';
import { sampleHtml } from '../../src/samples';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

/** The preview's frame, once it shows `text`. */
async function previewFrame(page: Page, text: string): Promise<Frame> {
  await expect(preview(page).locator('body')).toContainText(text);
  const handle = await page.locator('iframe[title="Output preview"]').elementHandle();
  return (await handle!.contentFrame())!;
}

/** Select a phrase in the preview, like dragging over it with the mouse. */
async function selectInPreview(page: Page, phrase: string) {
  const frame = await previewFrame(page, phrase);
  await frame.evaluate((p) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(p);
      if (i === -1) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + p.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${p}" not found in the preview`);
  }, phrase);
}

/** Select a whole element's text, like a triple click. */
async function selectElementInPreview(page: Page, selector: string) {
  const frame = await previewFrame(page, '');
  await frame.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, selector);
}

/** Ask the preview page for its text index. */
async function previewText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Output preview"]')!;
        addEventListener('message', function on(e) {
          if (e.data?.source === 'cms-preview' && e.data.type === 'text') {
            removeEventListener('message', on);
            resolve(e.data.text);
          }
        });
        frame.contentWindow!.postMessage({ source: 'cms-preview', type: 'get-text' }, '*');
      }),
  );
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('selecting a Selector node highlights its matches in the preview', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'selector-2').click();
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Input of selector-2 · 2 matches highlighted');
  await expect(preview(page).locator('h2[data-cms-match]')).toHaveCount(2);
  // The input is shown, not the result: no callouts yet.
  await expect(preview(page).locator('aside.callout')).toHaveCount(0);

  await inspector(page).getByLabel('Select by').selectOption('regex');
  await inspector(page).getByLabel('Pattern').fill('plan \\w+');
  await expect(preview(page).locator('span[data-cms-match]')).toHaveText(['plan costs', 'plan adds']);
  await page.screenshot({ path: 'test-results/m6-highlights.png' });

  // Selecting the Output node shows the finished page again.
  await node(page, 'output-4').click();
  await expect(preview(page).locator('[data-cms-match]')).toHaveCount(0);
  await expect(preview(page).locator('aside.callout')).toHaveCount(2);
});

test('the preview measures text exactly like the engine (HTML, .docx, JSON and .pptx)', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  const fromHtml = (await importSource({ name: 'example.html', data: sampleHtml() })).tree;
  await previewFrame(page, 'Field Guide');
  expect(await previewText(page)).toBe(buildTextIndex(fromHtml).text);

  for (const name of ['sample.docx', 'sample.json', 'sample.pptx']) {
    await inspector(page).getByLabel('File').setInputFiles(fixture(name));
    await expect(node(page, 'documentSource-1')).toContainText(name);
    const { readFileSync } = await import('node:fs');
    const doc = await importSource({ name, data: readFileSync(fixture(name)) });
    await previewFrame(page, name === 'sample.json' ? 'guide-001' : name === 'sample.pptx' ? 'Read the docs' : 'Every node');
    expect(await previewText(page), name).toBe(buildTextIndex(doc.tree).text);
  }
});

test('create a selector from text selected in the preview, then add more to it', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await selectInPreview(page, 'costs nothing');
  const actions = page.getByRole('dialog', { name: 'Selected text' });
  await expect(actions).toContainText('“costs nothing”');
  await actions.getByRole('button', { name: 'Create selector from selection' }).click();

  await expect(node(page, 'selector-5')).toContainText('1 saved selection · 1 match');
  await expect(inspector(page).getByRole('heading', { name: 'Selector' })).toBeVisible();
  const saved = inspector(page).getByRole('list', { name: 'Saved selections' });
  await expect(saved.getByRole('listitem')).toHaveCount(1);
  await expect(saved).toContainText('“costs nothing”');
  await expect(saved).toContainText('Found');
  await expect(preview(page).locator('span[data-cms-match]')).toHaveText('costs nothing');
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);

  // With the manual selector selected, more text can be added to it.
  await selectInPreview(page, 'adds snippets');
  await actions.getByRole('button', { name: 'Add to selector-5' }).click();
  await expect(saved.getByRole('listitem')).toHaveCount(2);
  await expect(preview(page).locator('span[data-cms-match]')).toHaveText(['costs nothing', 'adds snippets']);

  // A whole paragraph is saved as the element, not just its text.
  await selectElementInPreview(page, 'blockquote p');
  await actions.getByRole('button', { name: 'Add to selector-5' }).click();
  await expect(saved.getByRole('listitem').nth(2)).toContainText('whole p');
  await expect(preview(page).locator('p[data-cms-match="3"]')).toHaveText('Every node does one job well.');
  await page.screenshot({ path: 'test-results/m6-saved-selections.png' });
});

test('saved selections follow the text when the file changes', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  const phrases = ['costs nothing', 'Plant a source node first', 'adds snippets'];
  for (const [i, phrase] of phrases.entries()) {
    await selectInPreview(page, phrase);
    const actions = page.getByRole('dialog', { name: 'Selected text' });
    await actions.getByRole('button', { name: i === 0 ? 'Create selector from selection' : 'Add to selector-5' }).click();
    // The preview reloads with the new highlight; select the next phrase in the new page.
    await expect(preview(page).locator('[data-cms-match]')).toHaveCount(i + 1);
  }
  const saved = inspector(page).getByRole('list', { name: 'Saved selections' });
  await expect(saved.getByRole('listitem')).toHaveCount(3);

  // New version of the file: a paragraph added at the top, a typo, and one phrase rewritten.
  const edited = sampleHtml()
    .replace('<h2>Getting started</h2>', '<p>New: a welcome paragraph.</p>\n  <h2>Getting started</h2>')
    .replace('Plant a source node first', 'Plant a sourse node first')
    .replace('The pro plan adds snippets.', 'The pro plan includes everything.');
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles({ name: 'example-v2.html', mimeType: 'text/html', buffer: Buffer.from(edited) });
  await node(page, 'selector-5').click();
  await expect(saved.getByRole('listitem').nth(0)).toContainText('Moved');
  await expect(saved.getByRole('listitem').nth(1)).toContainText(/Changed a little \d+%/);
  await expect(saved.getByRole('listitem').nth(2)).toContainText('Needs attention');
  await expect(node(page, 'selector-5')).toContainText('2 matches');
  await expect(node(page, 'selector-5')).toContainText('1 warning');
  await expect(node(page, 'selector-5')).toContainText('1 selection needs attention');
  await expect(preview(page).locator('[data-cms-status="fuzzy"]')).toHaveText('Plant a sourse node first');
  await page.screenshot({ path: 'test-results/m6-after-edit.png' });
});
