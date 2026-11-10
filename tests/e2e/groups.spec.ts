import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const frame = (page: Page, id = 'group-1') => page.getByTestId(`group-${id}`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const box = async (page: Page, id: string) => (await node(page, id).boundingBox())!;

async function connect(page: Page, from: { node: string; handle: string }, to: { node: string; handle: string }) {
  const a = await node(page, from.node).locator(`.react-flow__handle.source[data-handleid="${from.handle}"]`).boundingBox();
  const b = await node(page, to.node).locator(`.react-flow__handle.target[data-handleid="${to.handle}"]`).boundingBox();
  if (!a || !b) throw new Error('handle not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4')).toContainText('OK');
  // Group the Selector and the Snippet with Ctrl+G.
  await node(page, 'selector-2').click();
  await node(page, 'snippet-3').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await expect(frame(page)).toContainText('Group 1');
});

test('group nodes, rename the group on the canvas, and find it in the Groups list', async ({ page }) => {
  await expect(frame(page)).toContainText('2 nodes');
  await expect(inspector(page).getByRole('heading', { name: 'Group' })).toBeVisible();
  await expect(inspector(page).getByRole('list', { name: 'Nodes in the group' }).getByRole('listitem')).toHaveCount(2);

  await frame(page).locator('.group-name').dblclick();
  await page.getByLabel('Name of group Group 1').fill('Headings');
  await page.keyboard.press('Enter');
  await expect(frame(page)).toContainText('Headings');
  const list = page.getByRole('region', { name: 'Groups' });
  await expect(list.getByRole('button')).toHaveText([/Headings\s*2/]);
  await page.screenshot({ path: 'test-results/groups.png' });

  // A node's inspector says which group it is in.
  await node(page, 'snippet-3').click();
  await expect(inspector(page)).toContainText('In group');
  await inspector(page).getByRole('button', { name: 'Headings' }).click();
  await expect(inspector(page).getByRole('heading', { name: 'Group' })).toBeVisible();

  // The list selects the group again after something else.
  await node(page, 'output-4').click();
  await list.getByRole('button', { name: /Headings/ }).click();
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Headings');
});

test('drag the group header to move all its nodes; one Undo puts them back', async ({ page }) => {
  const before = { sel: await box(page, 'selector-2'), snip: await box(page, 'snippet-3'), out: await box(page, 'output-4') };
  const head = (await frame(page).locator('.group-frame-head').boundingBox())!;
  await page.mouse.move(head.x + 60, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 60, head.y + head.height / 2 + 150, { steps: 10 });
  await page.mouse.up();
  const after = { sel: await box(page, 'selector-2'), snip: await box(page, 'snippet-3'), out: await box(page, 'output-4') };
  expect(after.sel.y - before.sel.y).toBeGreaterThan(100);
  expect(Math.round(after.snip.y - before.snip.y)).toBe(Math.round(after.sel.y - before.sel.y));
  expect(after.out.y).toBe(before.out.y);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => Math.round((await box(page, 'selector-2')).y)).toBe(Math.round(before.sel.y));
  await expect.poll(async () => Math.round((await box(page, 'snippet-3')).y)).toBe(Math.round(before.snip.y));
  // The group is still there: undo took back only the move.
  await expect(frame(page)).toBeVisible();
});

test('collapse a group to one box with its outside connections; connect to it; expand it again', async ({ page }) => {
  const result = await page.frameLocator('iframe[title="Output preview"]').locator('body').innerHTML();
  await frame(page).getByRole('button', { name: 'Collapse Group 1' }).click();
  await expect(node(page, 'selector-2')).toBeHidden();
  await expect(node(page, 'snippet-3')).toBeHidden();
  const collapsed = frame(page);
  await expect(collapsed).toContainText('selector-2 · Document'); // in, from the source
  await expect(collapsed).toContainText('snippet-3 · Document'); // out, to the output
  await expect(collapsed).toContainText('selector-2 · Point'); // unconnected, so it can be connected
  // The two outside connections go to the box; the one inside is not drawn.
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/group-collapsed.png' });

  // Connecting to the box connects to the node inside: a new Output from the Snippet's document.
  await page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Output/ }).click();
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  await connect(page, { node: 'group:group-1', handle: 'out|snippet-3|document' }, { node: 'output-5', handle: 'document' });
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(node(page, 'output-5')).toContainText('OK');

  await page.getByRole('region', { name: 'Groups' }).getByRole('button', { name: /Group 1/ }).click();
  await inspector(page).getByRole('button', { name: 'Expand' }).click();
  await expect(node(page, 'selector-2')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  await node(page, 'output-4').click();
  // Collapsing changed nothing in the result.
  await expect.poll(() => page.frameLocator('iframe[title="Output preview"]').locator('body').innerHTML()).toBe(result);
});

test('ungroup with Ctrl+Shift+G; duplicate and delete a group from the inspector', async ({ page }) => {
  await inspector(page).getByRole('button', { name: 'Duplicate' }).click();
  await expect(frame(page, 'group-2')).toContainText('Group 1 copy');
  await expect(page.locator('.react-flow__node.react-flow__node-cms')).toHaveCount(6);
  await expect(page.locator('.react-flow__edge')).toHaveCount(5); // + source → copy, copy → copy

  await inspector(page).getByRole('button', { name: 'Delete group and its 2 nodes' }).click();
  await expect(frame(page, 'group-2')).toHaveCount(0);
  await expect(page.locator('.react-flow__node.react-flow__node-cms')).toHaveCount(4);

  await node(page, 'selector-2').click();
  await page.keyboard.press('Control+Shift+g');
  await expect(frame(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__node.react-flow__node-cms')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Groups' })).toContainText('Select several nodes');
});

test('groups are kept after a reload', async ({ page }) => {
  await page.getByRole('region', { name: 'Groups' }).getByRole('button', { name: /Group 1/ }).click();
  await inspector(page).getByRole('button', { name: '#db2777' }).click();
  await inspector(page).getByRole('button', { name: 'Collapse' }).click();
  await page.waitForTimeout(800); // autosave
  await page.reload();
  await expect(frame(page)).toContainText('Group 1');
  await expect(node(page, 'selector-2')).toBeHidden();
  await expect(frame(page)).toHaveCSS('border-top-color', 'rgb(219, 39, 119)');
});

test('an expanded group lies above other nodes, and the last one raised is on top', async ({ page }) => {
  const z = async (id: string) => Number(await page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => getComputedStyle(el).zIndex));
  // Group 1 (selector, snippet) is above the ungrouped nodes, its nodes above its frame.
  await node(page, 'output-4').click();
  expect(await z('group:group-1')).toBeGreaterThan(await z('documentSource-1'));
  expect(await z('snippet-3')).toBeGreaterThan(await z('group:group-1'));

  // A second group: the newest is on top; selecting the first one raises it again.
  await node(page, 'documentSource-1').click();
  await node(page, 'output-4').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await expect(frame(page, 'group-2')).toContainText('Group 2');
  await expect.poll(async () => (await z('group:group-2')) > (await z('group:group-1'))).toBe(true);
  await page.getByRole('region', { name: 'Groups' }).getByRole('button', { name: /Group 1/ }).click();
  await expect.poll(async () => (await z('group:group-1')) > (await z('group:group-2'))).toBe(true);

  // Collapsing and expanding again raises it too.
  await frame(page, 'group-2').getByRole('button', { name: 'Collapse Group 2' }).click();
  await frame(page, 'group-2').getByRole('button', { name: 'Expand Group 2' }).click();
  await expect.poll(async () => (await z('group:group-2')) > (await z('group:group-1'))).toBe(true);
});
