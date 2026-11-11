import { expect, test, type Page } from '@playwright/test';
import { twoDocumentsFile } from '../two-documents';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const palette = (page: Page) => page.getByRole('complementary', { name: 'Node palette' });

async function connect(page: Page, from: string, fromPort: string, to: string, toPort: string) {
  const a = await node(page, from).locator(`.react-flow__handle.source[data-handleid="${fromPort}"]`).boundingBox();
  const b = await node(page, to).locator(`.react-flow__handle.target[data-handleid="${toPort}"]`).boundingBox();
  if (!a || !b) throw new Error('handle not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
  const viewport = page.locator('.react-flow__viewport');
  let last = '';
  await expect
    .poll(async () => {
      const now = await viewport.evaluate((el) => (el as HTMLElement).style.transform);
      const stable = now === last;
      last = now;
      return stable;
    }, { intervals: [100] })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('an Extractor keeps only what it picks', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Extractor/ }).click();
  await palette(page).getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'extractor-5', 'document');
  await connect(page, 'extractor-5', 'document', 'output-6', 'document');
  await node(page, 'extractor-5').click();
  const modes = await inspector(page).getByLabel('Select by').locator('option').allTextContents();
  expect(modes).toContain('Selected by hand');
  expect(modes.some((m) => /point/i.test(m))).toBe(false);
  await inspector(page).getByLabel('CSS selector').fill('h2, blockquote');
  await expect(node(page, 'extractor-5')).toContainText('h2, blockquote · 3 matches · the rest removed');
  await expect(preview(page).locator('body > :not(script, style)')).toHaveText(['Getting started', 'Pricing', 'Every node does one job well.']);
  await page.screenshot({ path: 'test-results/extractor.png' });
  await node(page, 'output-6').click();
  await expect(preview(page).locator('h1')).toHaveCount(0);
  await expect(preview(page).locator('h2')).toHaveCount(2);
});

/** Select a phrase in the preview, like dragging over it with the mouse. */
async function selectInPreview(page: Page, phrase: string) {
  await expect(preview(page).locator('body')).toContainText(phrase);
  const frame = (await (await page.locator('iframe[title="Output preview"]').elementHandle())!.contentFrame())!;
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

test('an Extractor can pick by hand: select text in its input, keep only that', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Extractor/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'extractor-5', 'document');
  await node(page, 'extractor-5').click();
  await inspector(page).getByLabel('Select by').selectOption({ label: 'Selected by hand' });
  await expect(inspector(page)).toContainText('None yet');
  const show = page.getByRole('group', { name: 'Show' });
  await expect(show.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-pressed', 'true');

  const actions = page.getByRole('dialog', { name: 'Selected text' });
  await selectInPreview(page, 'costs nothing');
  await actions.getByRole('button', { name: 'Add to extractor-5' }).click();
  await expect(preview(page).locator('span[data-cms-match]')).toHaveText('costs nothing');
  await selectInPreview(page, 'Every node does one job well.');
  await actions.getByRole('button', { name: 'Add to extractor-5' }).click();
  const saved = inspector(page).getByRole('list', { name: 'Saved selections' });
  await expect(saved.getByRole('listitem')).toHaveCount(2);
  await expect(saved).toContainText('Found');
  await expect(node(page, 'extractor-5')).toContainText('2 saved selections · 2 matches · the rest removed');
  await expect(preview(page).locator('[data-cms-match]')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/extractor-by-hand.png' });

  await show.getByRole('button', { name: 'Kept' }).click();
  await expect(preview(page).locator('body')).toHaveText(/^\s*costs nothing\s*Every node does one job well\.\s*$/);
  await expect(preview(page).locator('h1')).toHaveCount(0);
  await show.getByRole('button', { name: 'Pick' }).click();
  await expect(preview(page).locator('h1')).toBeVisible();
});

test('a Replace node puts content from another node in place of a selection', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Selector/ }).click();
  await palette(page).getByRole('button', { name: /^Replace/ }).click();
  await palette(page).getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-5', 'document');
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('CSS selector').fill('blockquote');
  await connect(page, 'selector-5', 'selection', 'replace-6', 'selection');
  await connect(page, 'selector-2', 'selection', 'replace-6', 'content');
  await connect(page, 'replace-6', 'document', 'output-7', 'document');
  await expect(node(page, 'replace-6')).toContainText('replaced 1×');

  await node(page, 'output-7').click();
  await expect(preview(page).locator('blockquote')).toHaveCount(0);
  await expect(preview(page).locator('h2')).toHaveText(['Getting started', 'Pricing', 'Getting started', 'Pricing']);

  // The Replace node's views: what it replaces, the content, and the result.
  await node(page, 'replace-6').click();
  await expect(inspector(page)).toContainText('Replaces what selector-5 selects (1 match)');
  const show = page.getByRole('group', { name: 'Show' });
  await expect(preview(page).locator('blockquote[data-cms-match]')).toBeVisible();
  await page.screenshot({ path: 'test-results/replace.png' });
  await show.getByRole('button', { name: 'Content' }).click();
  await expect(preview(page).locator('h2[data-cms-match]')).toHaveCount(2);
  await show.getByRole('button', { name: 'Result' }).click();
  await expect(preview(page).locator('blockquote')).toHaveCount(0);

  await inspector(page).getByLabel('Put it in').selectOption('div');
  await expect(preview(page).locator('div.inserted > h2')).toHaveCount(2);
});

test('a Replace node with nothing connected to Content removes the selection', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Selector/ }).click();
  await palette(page).getByRole('button', { name: /^Replace/ }).click();
  await palette(page).getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-5', 'document');
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('CSS selector').fill('blockquote');
  await connect(page, 'selector-5', 'selection', 'replace-6', 'selection');
  await connect(page, 'replace-6', 'document', 'output-7', 'document');
  await expect(node(page, 'replace-6')).toContainText('No content: removed 1×');

  await node(page, 'replace-6').click();
  await expect(inspector(page)).toContainText('Nothing is connected to Content, so the selected parts are removed');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Result' }).click();
  await expect(preview(page).locator('blockquote')).toHaveCount(0);
  await expect(preview(page).locator('h2')).toHaveText(['Getting started', 'Pricing']);
  await page.screenshot({ path: 'test-results/replace-remove.png' });

  // Inside: the element stays, emptied.
  await inspector(page).getByLabel('Replace', { exact: true }).selectOption('inside');
  await expect(node(page, 'replace-6')).toContainText('removed 1× · inside');
  await expect(preview(page).locator('blockquote')).toHaveCount(1);
  await expect(preview(page).locator('blockquote')).toHaveText('');
});

test('a custom snippet: a class name, and CSS and JavaScript for this node only', async ({ page }) => {
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption({ label: 'Custom (only this node)' });
  await expect(inspector(page).getByLabel('Template')).toHaveCount(0);
  await inspector(page).getByLabel('Class names').fill('shout');
  await expect(inspector(page)).toContainText('The selected content gets the class .shout');
  const css = inspector(page).locator('.cm-content[aria-label="CSS"]');
  await css.click();
  await page.keyboard.insertText('.shout { color: rgb(220, 38, 38); }');
  const js = inspector(page).locator('.cm-content[aria-label="JavaScript"]');
  await js.click();
  await page.keyboard.insertText("document.querySelectorAll('.shout').forEach((el) => el.setAttribute('data-shouted', 'yes'));");
  await expect(node(page, 'snippet-3')).toContainText('Custom .shout + own CSS/JS · applied 2×');
  await node(page, 'output-4').click();
  const h2 = preview(page).locator('h2.shout').first();
  await expect(h2).toHaveCSS('color', 'rgb(220, 38, 38)');
  await expect(h2).toHaveAttribute('data-shouted', 'yes');
  await node(page, 'snippet-3').click();
  // Several class names, separated by spaces.
  await inspector(page).getByLabel('Class names').fill('shout loud');
  await expect(inspector(page)).toContainText('The selected content gets the classes .shout .loud');
  await expect(node(page, 'snippet-3')).toContainText('Custom .shout.loud + own CSS/JS');
  await page.screenshot({ path: 'test-results/snippet-custom.png' });
  await node(page, 'output-4').click();
  await expect(preview(page).locator('h2.shout.loud')).toHaveCount(2);
  await node(page, 'snippet-3').click();

  // A wrapper around it instead, and saving it to the library keeps the CSS and JavaScript.
  await inspector(page).getByLabel('Put the classes on').selectOption('div');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('div.shout.loud > h2')).toHaveCount(2);
  await node(page, 'snippet-3').click();
  await inspector(page).getByRole('button', { name: 'Save to library' }).click();
  await expect(inspector(page).getByLabel('Snippet', { exact: true })).toHaveValue('shout-loud');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('div.shout > h2').first()).toHaveCSS('color', 'rgb(220, 38, 38)');
});

test('a library snippet can get its own CSS for this node', async ({ page }) => {
  await node(page, 'snippet-3').click();
  await inspector(page).getByText('CSS and JavaScript for this node only').click();
  await inspector(page).locator('.cm-content[aria-label="CSS"]').click();
  await page.keyboard.insertText('.callout { border-left-color: rgb(22, 163, 74); }');
  await expect(node(page, 'snippet-3')).toContainText('Callout v1 + own CSS/JS');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout').first()).toHaveCSS('border-left-color', 'rgb(22, 163, 74)');
});

test('a Snippet takes a whole document: all of it, or each block', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Snippet/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'snippet-5', 'selection');
  await node(page, 'snippet-5').click();
  await expect(node(page, 'snippet-5')).toContainText('applied 1×');
  await expect(preview(page).locator('body > aside.callout')).toHaveCount(1);
  await inspector(page).getByLabel('Apply to').selectOption('blocks');
  await expect(node(page, 'snippet-5')).toContainText('applied 10×');
  await expect(preview(page).locator('body > aside.callout')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/snippet-document.png' });
});

test('an Extractor picking text by hand keeps the element around it, so its CSS still applies', async ({ page }) => {
  page.once('dialog', (d) => void d.accept()); // "Open …? It replaces the current project."
  await page.getByLabel('Project file').setInputFiles(twoDocumentsFile());
  await expect(page.getByText('Project opened.')).toBeVisible();
  await node(page, 'extractor-4').click();
  await inspector(page).getByLabel('Select by').selectOption({ label: 'Selected by hand' });
  await selectInPreview(page, 'Water a new node once');
  await page.getByRole('dialog', { name: 'Selected text' }).getByRole('button', { name: 'Add to Watering section' }).click();
  await expect(node(page, 'extractor-4')).toContainText('1 saved selection · 1 match');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Kept' }).click();
  const kept = preview(page).locator('p.tip');
  await expect(kept).toHaveText('Water a new node once');
  await expect(kept).toHaveCSS('color', 'rgb(22, 101, 52)'); // .tip from the notes' own <style>
  await page.screenshot({ path: 'test-results/extractor-keeps-look.png' });

  await inspector(page).getByLabel('Keep the elements around what it picks').uncheck();
  await expect(preview(page).locator('p.tip')).toHaveCount(0);
  await expect(preview(page).locator('body')).toContainText('Water a new node once');
});
