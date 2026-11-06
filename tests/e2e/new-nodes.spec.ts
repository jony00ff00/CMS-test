import { expect, test, type Page } from '@playwright/test';

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
  await expect(inspector(page).getByLabel('Select by').locator('option')).not.toContainText(['Selected by hand']);
  await inspector(page).getByLabel('CSS selector').fill('h2, blockquote');
  await expect(node(page, 'extractor-5')).toContainText('h2, blockquote · 3 matches · the rest removed');
  await expect(preview(page).locator('body > :not(script, style)')).toHaveText(['Getting started', 'Pricing', 'Every node does one job well.']);
  await page.screenshot({ path: 'test-results/extractor.png' });
  await node(page, 'output-6').click();
  await expect(preview(page).locator('h1')).toHaveCount(0);
  await expect(preview(page).locator('h2')).toHaveCount(2);
});

test('a Combinator joins two selections, and merges two changed versions of a document', async ({ page }) => {
  await palette(page).getByRole('button', { name: /^Selector/ }).click();
  await palette(page).getByRole('button', { name: /^Combinator/ }).click();
  await palette(page).getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-5', 'document');
  await connect(page, 'selector-2', 'selection', 'combinator-6', 'a');
  await connect(page, 'selector-5', 'selection', 'combinator-6', 'b');
  await connect(page, 'combinator-6', 'document', 'output-7', 'document');
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('CSS selector').fill('h1');
  await node(page, 'combinator-6').click();
  await expect(inspector(page).getByRole('list')).toContainText('A selector-2 · a selection');
  await expect(inspector(page).getByRole('list')).toContainText('B selector-5 · a selection');
  await expect(node(page, 'combinator-6')).toContainText('A + B · selections');
  // The new document has what both selected, in document order.
  await expect(preview(page).locator('body > :not(script, style)')).toHaveText(['Field Guide to Node Gardens', 'Getting started', 'Pricing']);
  await page.screenshot({ path: 'test-results/combinator.png' });

  // Two changed versions of the source: one document with both changes.
  await node(page, 'combinator-6').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await palette(page).getByRole('button', { name: /^Snippet/ }).click();
  await palette(page).getByRole('button', { name: /^Combinator/ }).click();
  await fitView(page);
  await connect(page, 'selector-5', 'selection', 'snippet-7', 'selection');
  await connect(page, 'snippet-3', 'document', 'combinator-8', 'a');
  await connect(page, 'snippet-7', 'document', 'combinator-8', 'b');
  await connect(page, 'combinator-8', 'document', 'output-7', 'document');
  await expect(node(page, 'combinator-8')).toContainText('A + B · merged');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('h1')).toHaveCount(1);
  await expect(preview(page).locator('aside.callout')).toHaveCount(3);
});

test('a custom snippet: a class name, and CSS and JavaScript for this node only', async ({ page }) => {
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption({ label: 'Custom (only this node)' });
  await expect(inspector(page).getByLabel('Template')).toHaveCount(0);
  await inspector(page).getByLabel('Class name').fill('shout');
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
  await page.screenshot({ path: 'test-results/snippet-custom.png' });

  // A wrapper around it instead, and saving it to the library keeps the CSS and JavaScript.
  await inspector(page).getByLabel('Put the class on').selectOption('div');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('div.shout > h2')).toHaveCount(2);
  await node(page, 'snippet-3').click();
  await inspector(page).getByRole('button', { name: 'Save to library' }).click();
  await expect(inspector(page).getByLabel('Snippet', { exact: true })).toHaveValue('shout');
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
