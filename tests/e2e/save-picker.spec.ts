import { expect, test } from '@playwright/test';
import { savePickerOptions } from '../../src/ui/canvas/save-options';

/**
 * The real browser checks the options of its "save as" dialog before it opens it (and refuses some file types).
 * Without a click a valid call stops at the next check (it needs a user gesture), and headless Chromium cancels
 * the dialog at once, so this shows whether the options themselves are accepted, without a dialog staying open.
 */
const tryPicker = (page: import('@playwright/test').Page, options: unknown) =>
  page.evaluate(async (o) => {
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<unknown> }).showSaveFilePicker;
    if (!picker) return 'missing';
    try {
      await picker.call(window, o);
      return 'opened';
    } catch (err) {
      return `${(err as Error).name}: ${(err as Error).message}`;
    }
  }, options);

test('the real save dialog accepts the project file options', async ({ page }) => {
  await page.goto('/');
  const result = await tryPicker(page, savePickerOptions('Field guide.node-cms.json'));
  test.skip(result === 'missing', 'this browser has no showSaveFilePicker');
  expect(result).not.toMatch(/^TypeError/);
  // Past the options check: refused for want of a click, or (headless) the dialog is cancelled at once.
  expect(result).toMatch(/^(SecurityError|AbortError)/);
  // What used to be asked for is refused, so this test would have caught it.
  const old = await tryPicker(page, { suggestedName: 'x.node-cms.json', types: [{ description: 'Node CMS project', accept: { 'application/json': ['.node-cms.json', '.json'] } }] });
  expect(old).toMatch(/^TypeError: .*Extension '\.node-cms\.json' contains invalid characters/);
});
