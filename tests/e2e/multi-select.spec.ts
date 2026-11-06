import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4')).toContainText('OK');
});

test('the minimap shows the connections between nodes', async ({ page }) => {
  const lines = page.locator('.react-flow__minimap .minimap-edge');
  await expect(lines).toHaveCount(3);
  await expect(lines.first()).toHaveClass(/edge-document/);
  await expect(page.locator('.react-flow__minimap .react-flow__minimap-node')).toHaveCount(4);
  // Lines lie under the boxes.
  const order = await page.locator('.react-flow__minimap svg').evaluate((svg) =>
    [...svg.querySelectorAll('.minimap-edges, .react-flow__minimap-node')].map((el) => el.tagName.toLowerCase()),
  );
  expect(order[0]).toBe('g');
  await page.locator('.react-flow__minimap').screenshot({ path: 'test-results/minimap-edges.png' });

  // A new connection shows up there too; deleting a node takes its lines away.
  await node(page, 'snippet-3').click();
  await page.keyboard.press('Backspace');
  await expect(lines).toHaveCount(1);
});

for (const key of ['Shift', 'Control'] as const) {
  test(`${key}-click selects several nodes; delete them together`, async ({ page }) => {
    await node(page, 'selector-2').click();
    await node(page, 'snippet-3').click({ modifiers: [key] });
    await node(page, 'output-4').click({ modifiers: [key] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
    await expect(inspector(page).getByRole('heading', { name: '3 nodes selected' })).toBeVisible();
    await expect(inspector(page).getByRole('list', { name: 'Selected nodes' }).getByRole('listitem')).toHaveCount(3);
    await expect(inspector(page)).toContainText('output-4Output · shown in the preview');
    if (key === 'Shift') await page.screenshot({ path: 'test-results/multi-select.png' });

    // The same key with a click on a selected node takes it out.
    await node(page, 'snippet-3').click({ modifiers: [key] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await expect(inspector(page).getByRole('heading', { name: '2 nodes selected' })).toBeVisible();

    await inspector(page).getByRole('button', { name: 'Delete 2 nodes' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(inspector(page)).toContainText('Select a node to edit it.');
  });
}

test('a plain click selects one node again; dragging moves all selected nodes', async ({ page }) => {
  await node(page, 'selector-2').click();
  await node(page, 'snippet-3').click({ modifiers: ['Shift'] });
  const before = { a: (await node(page, 'selector-2').boundingBox())!, b: (await node(page, 'snippet-3').boundingBox())! };
  await page.mouse.move(before.b.x + 30, before.b.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.b.x + 30, before.b.y + 132, { steps: 10 });
  await page.mouse.up();
  const after = { a: (await node(page, 'selector-2').boundingBox())!, b: (await node(page, 'snippet-3').boundingBox())! };
  expect(Math.round(after.a.y - before.a.y)).toBeGreaterThan(60);
  expect(Math.round(after.a.y - before.a.y)).toBe(Math.round(after.b.y - before.b.y));
  // One step undoes the move of both.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => Math.round((await node(page, 'selector-2').boundingBox())!.y)).toBe(Math.round(before.a.y));
  await expect.poll(async () => Math.round((await node(page, 'snippet-3').boundingBox())!.y)).toBe(Math.round(before.b.y));

  await node(page, 'output-4').click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await expect(inspector(page).getByRole('heading', { name: 'Output' })).toBeVisible();
});
