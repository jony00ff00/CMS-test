import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('name a node in the inspector', async ({ page }) => {
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Name').fill('Pricing callouts');
  await expect(node(page, 'snippet-3').locator('.cms-node-title')).toHaveText('Pricing calloutsSnippet');
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Output of Pricing callouts');
  await inspector(page).getByLabel('Name').fill('');
  await expect(node(page, 'snippet-3').locator('.cms-node-title')).toHaveText('Snippet');
});

test('rename a node on the canvas by double-clicking its title', async ({ page }) => {
  await node(page, 'selector-2').locator('.cms-node-title').dblclick();
  const input = page.getByLabel('Name of selector-2');
  await input.fill('Main headings');
  await input.press('Backspace'); // typing must not delete the node
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await input.press('Enter');
  await expect(node(page, 'selector-2').locator('.cms-node-title')).toHaveText('Main headingSelector');
  await page.screenshot({ path: 'test-results/node-names.png' });

  // Escape keeps the old name.
  await node(page, 'selector-2').locator('.cms-node-title').dblclick();
  await page.getByLabel('Name of selector-2').fill('Something else');
  await page.getByLabel('Name of selector-2').press('Escape');
  await expect(node(page, 'selector-2').locator('.cms-node-title')).toHaveText('Main headingSelector');

  // The name is used where the app refers to the node, and kept after a reload.
  await node(page, 'selector-2').click();
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Input of Main heading · 2 matches highlighted');
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Main heading');
  await page.waitForTimeout(800);
  await page.reload();
  await expect(node(page, 'selector-2').locator('.cms-node-title')).toHaveText('Main headingSelector');
});
