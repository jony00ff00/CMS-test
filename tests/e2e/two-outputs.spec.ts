import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  // A wide preview, like a desktop page.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('node-cms:preview-width', '800');
    } catch {
      // The sandboxed preview has no storage.
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'JSON example' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Two outputs' }).click();
  await expect(node(page, 'static')).toContainText('OK');
  await expect(node(page, 'interactive')).toContainText('OK');
});

test('the static page: charts drawn once from the Word tables, and pictures added by the CMS', async ({ page }) => {
  await node(page, 'static').click();
  const p = preview(page);
  await expect(p.locator('figure.cms-chart svg')).toHaveCount(3);
  // Drawn at full size straight away: no animation.
  await expect(p.locator('.cms-chart-bar')).toHaveCount(12);
  expect(Number(await p.locator('.cms-chart-bar').nth(7).getAttribute('height'))).toBeGreaterThan(100);
  await expect(p.locator('.cms-chart-line')).toHaveCount(2);
  await expect(p.locator('.cms-chart-arc')).toHaveCount(4);
  // The pictures are not in the Word file: the CMS adds them, with their captions.
  await expect(p.locator('figure > img')).toHaveCount(3);
  await expect(p.locator('figure > figcaption').first()).toHaveText('The beds at dawn in May.');
  await expect(p.locator('video')).toHaveCount(0);
  // Hovering does nothing.
  await p.locator('.cms-chart-bar').nth(7).hover();
  await expect(p.locator('.cms-chart-tip')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/two-outputs-static.png' });
});

test('the interactive page: charts animate in and show values on hover; short videos added by the CMS', async ({ page }) => {
  await node(page, 'interactive').click();
  const p = preview(page);
  await expect(p.locator('figure.cms-chart svg')).toHaveCount(3);
  await expect(p.locator('img')).toHaveCount(0);
  await expect(p.locator('figure > video')).toHaveCount(3);
  // The videos play (muted, looping).
  await expect.poll(() => p.locator('video').first().evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);
  // The bar chart grows in once it is scrolled into view.
  const august = p.locator('.cms-chart-bar').nth(7);
  await august.scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await august.evaluate((r) => r.getBoundingClientRect().height))).toBeGreaterThan(100);
  await august.hover();
  await expect(p.locator('.cms-chart-tip').first()).toBeVisible();
  await expect(p.locator('.cms-chart-tip').first()).toHaveText('Aug 152 kg');
  await page.screenshot({ path: 'test-results/two-outputs-interactive.png' });
  // The line graph: a guide and both series' values for the month under the pointer.
  const line = p.locator('figure[data-chart="line"]');
  await line.scrollIntoViewIfNeeded();
  const box = (await line.locator('svg').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(line.locator('.cms-chart-tip')).toContainText('Rainfall:');
  await expect(line.locator('.cms-chart-tip')).toContainText('Soil moisture:');
});
