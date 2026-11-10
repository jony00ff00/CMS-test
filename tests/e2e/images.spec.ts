import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('a Selector selects images, and an image clicked in the preview becomes a selection', async ({ page }) => {
  await node(page, 'selector-2').click();
  await inspector(page).getByLabel('Select by').selectOption('image');
  await expect(node(page, 'selector-2')).toContainText('Images · 1 match');
  await expect(preview(page).locator('img[alt="Logo"][data-cms-match]')).toBeVisible();
  await inspector(page).getByLabel('Alternative text or file name contains').fill('nothing like it');
  await expect(node(page, 'selector-2')).toContainText('0 matches');
  await inspector(page).getByLabel('Alternative text or file name contains').fill('logo');
  await expect(node(page, 'selector-2')).toContainText('1 match');

  // By hand: click the image in the source's output.
  await node(page, 'documentSource-1').click();
  await preview(page).locator('img[alt="Logo"]').click();
  const dialog = page.getByRole('dialog', { name: 'Selected image' });
  await expect(dialog).toContainText('Image “Logo”');
  await page.screenshot({ path: 'test-results/image-picked.png' });
  await dialog.getByRole('button', { name: 'Create selector from image' }).click();
  await expect(inspector(page)).toContainText('Image “Logo”');
  await expect(preview(page).locator('img[alt="Logo"][data-cms-match]')).toBeVisible();
  await expect(preview(page).locator('[data-cms-match]')).toHaveCount(1);
});
