import { expect, test, type Page } from '@playwright/test';

const note = (page: Page, id = 'note-1') => page.locator(`.react-flow__node[data-id="note:${id}"]`);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4')).toContainText('OK');
});

test('a note on the canvas: write, recolour, move, delete; it is saved and never a node', async ({ page }) => {
  await page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Note/ }).click();
  // A new note opens for writing.
  const text = note(page).getByLabel('Note text');
  await expect(text).toBeFocused();
  await page.keyboard.type('These two nodes pick the headings\nand wrap them.');
  // Backspace while writing edits the text; it does not delete the note.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(note(page)).toContainText('These two nodes pick the headings and wrap them');
  await expect(note(page).locator('.note-text')).toHaveText('These two nodes pick the headings\nand wrap them');

  // Selected: colours and delete. It is not a node: the inspector shows no node.
  await note(page).click();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).not.toContainText('Duplicate');
  await note(page).getByRole('button', { name: 'Blue note' }).click();
  await expect(note(page).locator('.note-card')).toHaveClass(/note-blue/);

  // Move it next to the Selector and Snippet.
  const sel = (await node(page, 'selector-2').boundingBox())!;
  const box = (await note(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(sel.x + 20, sel.y - 70, { steps: 10 });
  await page.mouse.up();
  // It moved right, to just above the Selector.
  await expect.poll(async () => (await note(page).boundingBox())!.x - box.x).toBeGreaterThan(150);
  await expect.poll(async () => (await note(page).boundingBox())!.y).toBeLessThan(sel.y);
  await page.screenshot({ path: 'test-results/notes.png' });

  // Saved in the browser: still there after a reload, with its text and colour.
  await page.waitForTimeout(800); // autosave
  await page.reload();
  await expect(note(page).locator('.note-text')).toHaveText('These two nodes pick the headings\nand wrap them');
  await expect(note(page).locator('.note-card')).toHaveClass(/note-blue/);

  // Delete with Backspace when selected (the nodes stay); Undo brings it back; the × button deletes it too.
  await note(page).click();
  await page.keyboard.press('Backspace');
  await expect(note(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__node.react-flow__node-cms')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(note(page)).toHaveCount(1);
  await note(page).click();
  await note(page).getByRole('button', { name: 'Delete this note' }).click();
  await expect(note(page)).toHaveCount(0);
});

test('a note dragged from the palette lands where it is dropped', async ({ page }) => {
  const item = page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Note/ });
  const canvas = (await page.locator('.react-flow__pane').boundingBox())!;
  await item.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: canvas.width / 2, y: canvas.height - 150 } });
  await expect(note(page).getByLabel('Note text')).toBeFocused();
  const box = (await note(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(canvas.y + canvas.height / 2);
});
