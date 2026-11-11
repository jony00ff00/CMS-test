import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { jsonExampleFile } from '../json-example';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');

/** Drag from an output handle to an input handle. */
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
  // The view may animate; wait until it has stopped moving before measuring handles.
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

test('build the default 4-node graph by hand', async ({ page }) => {
  await expect(page.getByText('Add nodes from the palette')).toBeVisible();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  for (const label of ['Document Source', 'Selector', 'Snippet', 'Output']) {
    await palette.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  }
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await fitView(page);

  // Choose the sample file in the source node's inspector.
  await node(page, 'documentSource-1').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('heading', { name: 'Document Source' })).toBeVisible();
  await inspector.getByLabel('File').setInputFiles(fixture('sample.html'));
  await expect(node(page, 'documentSource-1')).toContainText('sample.html');

  await connect(page, 'documentSource-1', 'document', 'selector-2', 'document');
  await connect(page, 'selector-2', 'selection', 'snippet-3', 'selection');
  await connect(page, 'snippet-3', 'document', 'output-4', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  await expect(node(page, 'selector-2')).toContainText('h2 · 2 matches');
  await expect(node(page, 'snippet-3')).toContainText('Callout v1 · applied 2×');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout')).toHaveCount(2);
  await expect(preview(page).locator('aside.callout h2').first()).toHaveText('Getting started');
  await page.screenshot({ path: 'test-results/m5-built-by-hand.png' });
});

test('rejects a connection between different port types and says why', async ({ page }) => {
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'selector-1', 'selection', 'output-2', 'document');
  await expect(page.getByRole('alert')).toHaveText(/Cannot connect a selection output to a document input/);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('edit the HTML example in the inspector and see the preview update', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(preview(page).locator('aside.callout-info')).toHaveCount(2);

  await node(page, 'snippet-3').click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await inspector.getByLabel('Variant').selectOption('warning');
  await expect(preview(page).locator('aside.callout-warning')).toHaveCount(2);

  await node(page, 'selector-2').click();
  await inspector.getByLabel('CSS selector').fill('blockquote, h1');
  await expect(node(page, 'selector-2')).toContainText('2 matches');
  // A selected Selector shows its input with the matches highlighted.
  await expect(preview(page).locator('h1[data-cms-match]')).toHaveText('Field Guide to Node Gardens');

  await inspector.getByLabel('Select by').selectOption('heading');
  await inspector.getByLabel('Heading text').fill('Pricing');
  await expect(node(page, 'selector-2')).toContainText('1 match');
  await expect(inspector.getByRole('region', { name: 'Result' })).toContainText('OK');
  await page.screenshot({ path: 'test-results/m5-inspector.png' });
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout-warning > h2')).toHaveText('Pricing');
});

test('map JSON fields in the inspector', async ({ page }) => {
  page.once('dialog', (d) => void d.accept()); // "Open …? It replaces the current project." (when there is one)
  await page.getByLabel('Project file').setInputFiles(jsonExampleFile());
  await expect(page.getByText('Project opened.')).toBeVisible();
  await expect(preview(page).locator('[data-json-path="$.faq[0].a"] strong')).toHaveText('string fields');

  await node(page, 'documentSource-1').click();
  const fields = page.getByRole('list', { name: 'JSON fields' });
  // 13 fields in the file, plus the example's two wildcard paths.
  await expect(fields.getByRole('listitem')).toHaveCount(15);
  await expect(fields.getByRole('listitem').filter({ hasText: '$.faq[0].a' })).toContainText('via $.faq[*].a');
  await expect(fields.getByRole('checkbox', { name: /\$\.faq\[0\]\.a/ })).toBeDisabled();
  await fields.getByRole('checkbox', { name: /\$\.summary/ }).check();
  await expect(preview(page).locator('[data-json-path="$.summary"] p')).toHaveCount(2);
  await page.getByLabel('Format of $.faq[*].a').selectOption('text');
  await expect(preview(page).locator('[data-json-path="$.faq[0].a"]')).toContainText('**string fields**');
  await page.screenshot({ path: 'test-results/m5-json.png' });
});

test('delete a node with the keyboard', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await node(page, 'selector-2').click();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(node(page, 'snippet-3')).toContainText('Connect the Selection or document input');
  await expect(page.getByText('Nothing to show yet.')).toBeVisible();
});

test('show a problem with the chosen file on the node', async ({ page }) => {
  await page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Document Source/ }).click();
  await page.getByRole('complementary', { name: 'Inspector' }).getByLabel('File').setInputFiles(fixture('sample-invalid.json'));
  await expect(node(page, 'documentSource-1')).toContainText('Error');
  await expect(node(page, 'documentSource-1')).toContainText('line 1, column 22');
});
