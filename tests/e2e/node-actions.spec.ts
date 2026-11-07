import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

/** Click a connection halfway between its ends (a straight one has no height, so it cannot be clicked as an element). */
async function clickEdge(page: Page, from: string, fromPort: string, to: string, toPort: string) {
  const a = (await node(page, from).locator(`.react-flow__handle.source[data-handleid="${fromPort}"]`).boundingBox())!;
  const b = (await node(page, to).locator(`.react-flow__handle.target[data-handleid="${toPort}"]`).boundingBox())!;
  await page.mouse.click((a.x + a.width / 2 + b.x + b.width / 2) / 2, (a.y + a.height / 2 + b.y + b.height / 2) / 2);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
});

test('duplicate and delete a node from the sidebar', async ({ page }) => {
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Name').fill('Callouts');
  await inspector(page).getByLabel('Variant').selectOption('warning');
  await inspector(page).getByRole('button', { name: 'Duplicate' }).click();

  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Callouts copy');
  await expect(inspector(page).getByLabel('Variant')).toHaveValue('warning');
  await expect(node(page, 'snippet-5')).toContainText('Callout v1 · applied 2×');
  await expect(page.locator('.react-flow__edge')).toHaveCount(4); // the copy is fed by the same Selector
  await page.screenshot({ path: 'test-results/node-duplicated.png' });

  await inspector(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
});

test('Ctrl/Cmd+D duplicates the selected node', async ({ page }) => {
  await node(page, 'selector-2').click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(node(page, 'selector-5')).toContainText('h2 · 2 matches');
  // Not while typing in a field.
  await inspector(page).getByLabel('CSS selector').focus();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
});

test('a selected connection shows a delete button on the canvas', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Delete this connection' })).toHaveCount(0);
  await clickEdge(page, 'selector-2', 'selection', 'snippet-3', 'selection');
  const remove = page.getByRole('button', { name: 'Delete this connection' });
  await expect(remove).toHaveCount(1);
  await expect(remove).toBeVisible();
  await page.screenshot({ path: 'test-results/edge-delete.png' });

  await remove.click();
  await expect(edge(page, 'e2')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(node(page, 'snippet-3')).toContainText('Connect the Selection or document input');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  // Clicking elsewhere hides the button again.
  await clickEdge(page, 'documentSource-1', 'document', 'selector-2', 'document');
  await expect(remove).toHaveCount(1);
  await page.locator('.react-flow__pane').click({ position: { x: 60, y: 420 } });
  await expect(remove).toHaveCount(0);
});
