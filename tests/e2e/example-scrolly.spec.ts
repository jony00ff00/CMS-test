import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test('the scrolly example: Word text in the code, and the code runs in the preview', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  // A wide preview, like a desktop page.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('node-cms:preview-width', '900');
    } catch {
      // The sandboxed preview has no storage.
    }
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(join(import.meta.dirname, '..', '..', 'examples', 'ge16-scrolly.node-cms.json'));
  await expect(page.getByText('Project opened.')).toBeVisible();
  await expect(node(page, 'page')).toContainText('OK');
  await expect(node(page, 'fill-steps')).toContainText('replaced 10×');
  // The settings that make it work, in the inspector.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await node(page, 'code').click();
  await expect(inspector.getByLabel('Keep its scripts and styles (code you trust)')).toBeChecked();
  await node(page, 'fill-steps').click();
  await expect(inspector.getByLabel('Replace', { exact: true })).toHaveValue('inside');
  await expect(inspector.getByLabel('Match by match')).toBeChecked();
  await expect(inspector).toContainText('Replaces what Step cards selects (10 matches)');
  await node(page, 'page').click();

  // The script ran: it moved the graphic into a shadow root (Playwright's locators look inside it) and drew the seats.
  const host = preview(page).locator('ge16-scrolly');
  await expect.poll(() => host.evaluate((el) => !!el.shadowRoot)).toBe(true);
  await expect(host.locator('.gs-root .gs-headline')).toHaveText('Hung by design');
  await expect(host.locator('.gs-dots circle').first()).toBeAttached();
  await expect(host.locator('.gs-step .gs-card')).toHaveCount(10);
  await page.locator('.react-flow__controls-fitview').click();
  await page.screenshot({ path: 'test-results/example-scrolly.png' });

  // Scroll to a later step: the graphic follows.
  await host.locator('.gs-step[data-step="anwar"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(host.locator('.gs-root')).toHaveAttribute('data-active-step', 'anwar');
  await page.screenshot({ path: 'test-results/example-scrolly-step.png' });
});
