import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const previewSection = (page: Page) => page.getByRole('region', { name: 'Preview' });
const resizer = (page: Page) => page.getByRole('separator', { name: 'Resize the preview' });
const sectionHeight = async (page: Page) => (await previewSection(page).boundingBox())!.height;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('drag the bar above the preview to resize it; the size is remembered', async ({ page }) => {
  expect(Math.round(await sectionHeight(page))).toBe(260);
  const bar = (await resizer(page).boundingBox())!;
  const x = bar.x + bar.width / 2;
  const y = bar.y + bar.height / 2;

  // Taller: drag up over the canvas.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 200, { steps: 8 });
  await page.mouse.up();
  expect(Math.round(await sectionHeight(page))).toBe(460);

  // Shorter: drag down across the preview's iframe (the pointer must not get lost in it).
  const bar2 = (await resizer(page).boundingBox())!;
  await page.mouse.move(x, bar2.y + bar2.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bar2.y + bar2.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  expect(Math.round(await sectionHeight(page))).toBe(340);
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await page.screenshot({ path: 'test-results/preview-resized.png' });

  await page.reload();
  expect(Math.round(await sectionHeight(page))).toBe(340);

  // Never so small it disappears, never so big it hides the canvas.
  const bar3 = (await resizer(page).boundingBox())!;
  await page.mouse.move(x, bar3.y + 4);
  await page.mouse.down();
  await page.mouse.move(x, 890, { steps: 8 });
  await page.mouse.up();
  expect(Math.round(await sectionHeight(page))).toBe(120);

  await resizer(page).dblclick();
  expect(Math.round(await sectionHeight(page))).toBe(260);
});

test('resize with the keyboard', async ({ page }) => {
  await resizer(page).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(resizer(page)).toHaveAttribute('aria-valuenow', '300');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(resizer(page)).toHaveAttribute('aria-valuenow', '220');
  await page.keyboard.press('Home');
  await expect(resizer(page)).toHaveAttribute('aria-valuenow', '120');
  await page.keyboard.press('End');
  await expect(resizer(page)).toHaveAttribute('aria-valuenow', '740'); // window height 900 − 160
});

test('open the preview in its own window, keep editing, and bring it back', async ({ page }) => {
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open in new window' }).click()]);
  popup.on('pageerror', (err) => {
    throw err;
  });
  await expect(popup).toHaveTitle('Preview · Node CMS');
  const inWindow = popup.frameLocator('iframe[title="Output preview"]');
  await expect(inWindow.locator('aside.callout h2')).toHaveText(['Getting started', 'Pricing']);

  // The editor gets the space back and says where the preview went.
  await expect(previewSection(page)).toContainText('Showing in its own window.');
  await expect(page.locator('iframe[title="Output preview"]')).toHaveCount(0);
  expect(await sectionHeight(page)).toBeLessThan(80);

  // Editing in the editor updates the window.
  await node(page, 'selector-2').click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('CSS selector').fill('h1');
  await expect(popup.getByRole('region', { name: 'Preview' })).toContainText('Input of selector-2 · 1 match highlighted');
  await expect(inWindow.locator('h1[data-cms-match]')).toHaveText('Field Guide to Node Gardens');
  await popup.screenshot({ path: 'test-results/preview-window.png' });

  // Selecting text in the window still makes a selector in the editor.
  await node(page, 'documentSource-1').click();
  await expect(inWindow.locator('h1')).not.toHaveAttribute('data-cms-match');
  const frame = (await (await popup.locator('iframe[title="Output preview"]').elementHandle())!.contentFrame())!;
  await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf('costs nothing');
      if (i === -1) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + 'costs nothing'.length);
      getSelection()!.addRange(range);
      return;
    }
  });
  const actions = popup.getByRole('dialog', { name: 'Selected text' });
  await expect(actions).toContainText('“costs nothing”');
  await actions.getByRole('button', { name: 'Create selector from selection' }).click();
  await expect(node(page, 'selector-5')).toContainText('1 saved selection · 1 match');
  await expect(inWindow.locator('span[data-cms-match]')).toHaveText('costs nothing');

  // "Back into the editor" closes the window and shows the preview here again.
  await popup.getByRole('button', { name: 'Back into the editor' }).click();
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('span[data-cms-match]')).toHaveText('costs nothing');
  expect(popup.isClosed()).toBe(true);
});

test('closing the preview window brings the preview back', async ({ page }) => {
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open in new window' }).click()]);
  await expect(popup.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await popup.close();
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('aside.callout')).toHaveCount(2);
  expect(Math.round(await sectionHeight(page))).toBe(260);

  // And from the editor's side.
  const [again] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open in new window' }).click()]);
  await expect(again.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Bring it back here' }).click();
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
  await expect.poll(() => again.isClosed()).toBe(true);
});

test('says so when the browser blocks the window', async ({ page }) => {
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole('button', { name: 'Open in new window' }).click();
  await expect(page.getByRole('alert')).toHaveText(/The browser blocked the new window/);
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('h1')).toBeVisible();
});
