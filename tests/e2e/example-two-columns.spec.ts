import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const preview = (page: import('@playwright/test').Page) => page.frameLocator('iframe[title="Output preview"]');

test('the "Word part in two columns" example opens and shows the pictures on the right', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  // A wide preview, so the page is wider than the layout's one-column breakpoint (520 px).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('node-cms:preview-width', '900');
    } catch {
      // The sandboxed preview has no storage.
    }
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(join(import.meta.dirname, '..', '..', 'examples', 'word-two-columns.node-cms.json'));
  await expect(page.getByText('Project opened.')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="output-8"]')).toContainText('OK');
  await page.locator('.react-flow__node[data-id="output-8"]').click();

  const text = preview(page).locator('.cms-two-col-text');
  const media = preview(page).locator('.cms-two-col-media');
  await expect(media.locator('img')).toHaveCount(3);
  await expect(text.locator('img')).toHaveCount(0);
  // Side by side: the pictures' column starts to the right of the text column.
  const t = (await text.boundingBox())!;
  const m = (await media.boundingBox())!;
  expect(m.x).toBeGreaterThan(t.x + t.width - 1);
  await page.locator('.react-flow__controls-fitview').click();
  await page.screenshot({ path: 'test-results/example-two-columns.png' });
});

test('in a narrow preview (like a phone) the pictures go under the text', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('node-cms:preview-width', '300');
    } catch {
      // The sandboxed preview has no storage.
    }
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(join(import.meta.dirname, '..', '..', 'examples', 'word-two-columns.node-cms.json'));
  await page.locator('.react-flow__node[data-id="output-8"]').click();
  const t = (await preview(page).locator('.cms-two-col-text').boundingBox())!;
  const m = (await preview(page).locator('.cms-two-col-media').boundingBox())!;
  expect(m.y).toBeGreaterThan(t.y + t.height - 1);
});
