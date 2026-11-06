import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

async function connect(page: Page, from: string, fromPort: string, to: string, toPort: string) {
  const a = await node(page, from).locator(`.react-flow__handle.source[data-handleid="${fromPort}"]`).boundingBox();
  const b = await node(page, to).locator(`.react-flow__handle.target[data-handleid="${toPort}"]`).boundingBox();
  if (!a || !b) throw new Error('handle not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
  const viewport = page.locator('.react-flow__viewport');
  let last = '';
  await expect
    .poll(async () => {
      const now = await viewport.evaluate((el) => (el as HTMLElement).style.transform);
      const stable = now === last;
      last = now;
      return stable;
    }, { intervals: [100] })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test("a Connector feeds an Output's result into more nodes; a Selector can select everything", async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Connector/ }).click();
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await palette.getByRole('button', { name: /^Snippet/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);

  // The Connector takes anything: here the Output's Result.
  await connect(page, 'output-4', 'result', 'connector-5', 'input');
  await connect(page, 'connector-5', 'document', 'selector-6', 'document');
  await connect(page, 'selector-6', 'selection', 'snippet-7', 'selection');
  await connect(page, 'snippet-7', 'document', 'output-8', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);
  await expect(node(page, 'connector-5')).toContainText('From a document · any kind out');

  await node(page, 'selector-6').click();
  await inspector(page).getByLabel('Select by').selectOption({ label: 'Everything (select all)' });
  await expect(node(page, 'selector-6')).toContainText('Everything · 1 match');
  await page.screenshot({ path: 'test-results/connector-select-all.png' });

  // The second Output shows the first Snippet's callouts inside one callout around everything.
  await node(page, 'output-8').click();
  await expect(preview(page).locator('.callout')).toHaveCount(3);
  await expect(preview(page).locator('body > .callout .callout')).toHaveCount(2);

  await node(page, 'selector-6').click();
  await inspector(page).getByLabel('As').selectOption('blocks');
  await expect(node(page, 'selector-6')).toContainText(/Every block · \d+ matches/);
});

test('a Connector turns a selection into a document, and HTML into a document', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Connector/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);

  // The Selector picks the two h2 headings; through the Connector they become a document of their own.
  await connect(page, 'selector-2', 'selection', 'connector-5', 'input');
  await connect(page, 'connector-5', 'document', 'output-6', 'document');
  await expect(node(page, 'connector-5')).toContainText('From a selection');
  await node(page, 'output-6').click();
  await expect(preview(page).locator('body > h2')).toHaveText(['Getting started', 'Pricing']);
  await expect(preview(page).locator('p')).toHaveCount(0);

  // The whole document it selects in, instead.
  await node(page, 'connector-5').click();
  await expect(inspector(page)).toContainText('a selection');
  await inspector(page).getByLabel('A selection as a document').selectOption('document');
  await node(page, 'output-6').click();
  await expect(preview(page).locator('h1')).toHaveText('Field Guide to Node Gardens');
  await page.screenshot({ path: 'test-results/connector-any.png' });

  // An Output's HTML into a Connector: a document again (read like an HTML file).
  await node(page, 'connector-5').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await palette.getByRole('button', { name: /^Connector/ }).click();
  await fitView(page);
  await connect(page, 'output-4', 'html', 'connector-6', 'input');
  await connect(page, 'connector-6', 'document', 'output-6', 'document');
  await expect(node(page, 'connector-6')).toContainText('From HTML');
  await node(page, 'output-6').click();
  await expect(preview(page).locator('aside.callout h2')).toHaveCount(2);
});
