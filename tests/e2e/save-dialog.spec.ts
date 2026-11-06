import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  // Stand-in for the browser's save dialog: records the suggested name and what was written.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__saves = [];
    w.__cancelNext = false;
    w.showSaveFilePicker = async (options: { suggestedName: string }) => {
      if (w.__cancelNext) {
        w.__cancelNext = false;
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      const name = options.suggestedName.replace('.node-cms.json', ' (chosen).node-cms.json');
      return {
        name,
        createWritable: async () => ({
          write: async (blob: Blob) => (w.__saves as unknown[]).push({ suggested: options.suggestedName, name, text: await blob.text() }),
          close: async () => {},
        }),
      };
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('saving asks for a name, then where to save it', async ({ page }) => {
  await page.getByRole('button', { name: 'Save project file…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save project file' });
  await expect(dialog.getByLabel('File name')).toHaveValue('project');
  await dialog.getByLabel('File name').fill('Field guide');
  await expect(dialog).toContainText('choose the folder');
  await page.screenshot({ path: 'test-results/save-dialog.png' });

  // Cancelling the browser's dialog keeps this one open.
  await page.evaluate(() => Object.assign(window, { __cancelNext: true }));
  await dialog.getByRole('button', { name: 'Choose location and save…' }).click();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Choose location and save…' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Saved the project as “Field guide (chosen).node-cms.json”')).toBeVisible();
  const saves = await page.evaluate(() => (window as unknown as { __saves: { suggested: string; text: string }[] }).__saves);
  expect(saves).toHaveLength(1);
  expect(saves[0].suggested).toBe('Field guide.node-cms.json');
  expect(JSON.parse(saves[0].text)).toMatchObject({ format: 'node-cms-project' });

  // The name is remembered for next time.
  await page.getByRole('button', { name: 'Save project file…' }).click();
  await expect(dialog.getByLabel('File name')).toHaveValue('Field guide (chosen)');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Save project file…' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the minimap shows each node in its colour', async ({ page }) => {
  const fills = await page.locator('.react-flow__minimap-node').evaluateAll((els) => els.map((e) => getComputedStyle(e).fill));
  expect(fills).toEqual(['rgb(37, 99, 235)', 'rgb(217, 119, 6)', 'rgb(124, 58, 237)', 'rgb(220, 38, 38)']);
});
