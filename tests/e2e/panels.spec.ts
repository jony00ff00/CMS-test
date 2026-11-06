import { expect, test, type Page } from '@playwright/test';

const box = async (page: Page, name: string, role: 'complementary' | 'region' = 'complementary') =>
  (await page.getByRole(role, { name, exact: true }).boundingBox())!;
const canvasWidth = async (page: Page) => (await page.getByRole('main', { name: 'Canvas' }).boundingBox())!.width;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('minimise the side panels and bring them back; the canvas gets the space', async ({ page }) => {
  const before = await canvasWidth(page);

  await page.getByRole('button', { name: 'Minimise the nodes panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Node palette' })).toHaveCount(0);
  expect(Math.round((await box(page, 'Nodes (minimised)')).width)).toBe(36);

  await page.locator('.react-flow__node[data-id="snippet-3"]').click();
  await page.getByRole('button', { name: 'Minimise the inspector panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toHaveCount(0);
  const rail = page.getByRole('complementary', { name: 'Inspector (minimised)' });
  await expect(rail).toContainText('snippet-3');
  expect(await canvasWidth(page)).toBeGreaterThan(before + 450);
  await page.screenshot({ path: 'test-results/panels-minimised.png' });

  // Remembered after a reload.
  await page.reload();
  await expect(rail).toBeVisible();

  await page.getByRole('button', { name: 'Show the nodes panel' }).click();
  await page.getByRole('button', { name: 'Show the inspector panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Node palette' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible();
  expect(Math.round(await canvasWidth(page))).toBe(Math.round(before));
});

test('minimise the preview to a bar and bring it back', async ({ page }) => {
  const frame = page.locator('iframe[title="Output preview"]');
  await expect(frame).toBeVisible();
  await page.getByRole('button', { name: 'Minimise the preview panel' }).click();
  await expect(frame).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize the preview' })).toHaveCount(0);
  expect((await box(page, 'Preview', 'region')).height).toBeLessThan(60);
  await page.screenshot({ path: 'test-results/preview-minimised.png' });

  await page.getByRole('button', { name: 'Show the preview panel' }).click();
  expect(Math.round((await box(page, 'Preview', 'region')).height)).toBe(260);
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
});

test('a preview in its own window keeps showing while the docked bar is minimised', async ({ page }) => {
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open in new window' }).click();
  const popup = await popupPromise;
  await expect(popup.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Minimise the preview panel' }).click();
  await expect(popup.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bring it back here' })).toBeVisible();
});
