import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('a PowerPoint deck is a document source: one section per slide, ready for selectors and snippets', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await expect(node(page, 'documentSource-1')).toContainText('sample.pptx · 14 of 15 slides (1 hidden)');
  await expect(preview(page).locator('section.slide')).toHaveCount(14);
  await expect(preview(page).locator('section.slide[data-slide="4"] li li li')).toHaveText('And now PowerPoint');
  await expect(preview(page).locator('aside.speaker-notes').first()).toHaveText('Talk about getting started.');

  // The example's Selector (h2) and Callout snippet work on slide titles as on any document.
  await node(page, 'output-4').click();
  await expect(preview(page).locator('section.slide h2').first()).toBeVisible();
  await expect(preview(page).locator('.callout h2')).toHaveCount(14);
  await page.screenshot({ path: 'test-results/pptx-source.png' });
});

test('tables, pictures and charts from a deck show in the preview', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await expect(inspector(page)).toContainText('a chart is shown as a table of its data');
  const slide = (n: number) => preview(page).locator(`section.slide[data-slide="${n}"]`);
  await expect(slide(13).locator('td[colspan="3"]')).toHaveText('Everything else');
  const img = slide(14).locator('a[href="https://example.com/"] img[alt="Logo"]');
  await expect(img).toBeVisible();
  // The picture's data came along (it is a real, loaded image).
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2);
  await expect(slide(15).locator('figure.slide-chart figcaption')).toHaveText('Growth');
  await expect(slide(15).locator('tbody tr')).toHaveCount(3);
  await slide(13).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/pptx-table-picture-chart.png' });
});
