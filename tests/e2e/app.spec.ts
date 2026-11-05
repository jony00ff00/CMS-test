import { expect, test } from '@playwright/test';

test('app shell loads with all panels', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Node palette' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Canvas' }).locator('.react-flow')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();
  for (const name of ['Document Source', 'Selector', 'Snippet', 'Output']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/m0-shell.png' });
  expect(errors).toEqual([]);
});
