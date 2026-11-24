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
  await expect(node(page, 'fill')).toContainText('5 of 5 rows filled');
  // The settings that make it work, in the inspector.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await node(page, 'code').click();
  await expect(inspector.getByLabel('Keep its scripts and styles (code you trust)')).toBeChecked();
  await node(page, 'fill').click();
  const rows = inspector.getByRole('list', { name: 'Rows' });
  await expect(rows.getByRole('listitem')).toHaveCount(5);
  await expect(rows.getByRole('listitem').nth(3).getByRole('status').first()).toContainText('10 items · 10 template elements in the template');
  await page.screenshot({ path: 'test-results/example-scrolly-fill.png' });
  await node(page, 'page').click();

  // The script ran: it moved the graphic into a shadow root (Playwright's locators look inside it) and drew the seats.
  const host = preview(page).locator('ge16-scrolly');
  await expect.poll(() => host.evaluate((el) => !!el.shadowRoot)).toBe(true);
  await expect(host.locator('.gs-root .gs-headline')).toHaveText('A parliament with no winner');
  // The note above the flow says what the example is for.
  await expect(page.locator('.react-flow__node[data-id="note:note-1"] .note-text')).toHaveText(
    'Example for merging text changes with pre-existing scrolly-telly code.\nAllows text to be easily updated by users, without requiring specialised tools.',
  );
  await expect(host.locator('.gs-dots circle').first()).toBeAttached();
  await expect(host.locator('.gs-step .gs-card')).toHaveCount(10);
  await page.locator('.react-flow__controls-fitview').click();
  await page.screenshot({ path: 'test-results/example-scrolly.png' });

  // Scroll to a later step: the graphic follows.
  await host.locator('.gs-step[data-step="anwar"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(host.locator('.gs-root')).toHaveAttribute('data-active-step', 'anwar');
  await page.screenshot({ path: 'test-results/example-scrolly-step.png' });
});

test('the scrolly made from the Word text alone: the snippets’ code runs in the preview', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('node-cms:preview-width', '900');
    } catch {
      // The sandboxed preview has no storage.
    }
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(join(import.meta.dirname, '..', '..', 'examples', 'ge16-scrolly-from-text.node-cms.json'));
  await expect(page.getByText('Project opened.')).toBeVisible();
  await expect(node(page, 'page')).toContainText('OK');
  await expect(node(page, 'cards')).toContainText('joined · 1 match');
  await node(page, 'page').click();

  const host = preview(page).locator('ge16-scrolly');
  await expect.poll(() => host.evaluate((el) => !!el.shadowRoot)).toBe(true);
  // The CSS reached the shadow root: the headline is styled (not the browser's default h2 size).
  await expect.poll(() => host.evaluate((el) => !!el.shadowRoot?.querySelector('style[data-snippet="ge16-scrolly@1"]'))).toBe(true);
  await expect(host.locator('.gs-dots circle').first()).toBeAttached();
  await expect(host.locator('.gs-step')).toHaveCount(10);
  await page.locator('.react-flow__controls-fitview').click();
  await page.screenshot({ path: 'test-results/example-scrolly-from-text.png' });

  await host.locator('.gs-step[data-step="deals"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(host.locator('.gs-root')).toHaveAttribute('data-active-step', 'deals');
  await page.screenshot({ path: 'test-results/example-scrolly-from-text-step.png' });
});

test('the "Two documents" button opens the scrolly project, with its Word text in the running graphic', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  page.once('dialog', (d) => void d.accept()); // only if something is on the canvas already
  await page.getByRole('button', { name: 'Two documents' }).click();
  await expect(node(page, 'fill')).toContainText('5 of 5 rows filled');
  await expect(node(page, 'page')).toContainText('OK');
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByLabel('Name')).toHaveValue('Interactive page');
  const host = preview(page).locator('ge16-scrolly');
  await expect.poll(() => host.evaluate((el) => !!el.shadowRoot)).toBe(true);
  await expect(host.locator('.gs-root .gs-kicker')).toHaveText(/what happens next/i);
  await expect(host.locator('.gs-step[data-step="tie"] .gs-card')).toContainText('three coalitions separated by just two seats');
  await expect(host.locator('.gs-dots circle').first()).toBeAttached();
  await page.screenshot({ path: 'test-results/two-documents-scrolly.png' });

  // The static page: the same text as an article, the tables shown, no script.
  await expect(node(page, 'static')).toContainText('OK');
  await node(page, 'static').click();
  await expect(preview(page).locator('.gs-static .gs-headline')).toBeVisible();
  await expect(preview(page).locator('.gs-static .gs-step')).toHaveCount(10);
  await expect(preview(page).locator('.gs-static table')).toHaveCount(2);
  await expect(preview(page).locator('.gs-static table').first()).toBeVisible();
  await expect(preview(page).locator('ge16-scrolly script, ge16-scrolly style')).toHaveCount(0);
  await expect(preview(page).locator('.gs-graphic')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/two-documents-static.png' });
});
