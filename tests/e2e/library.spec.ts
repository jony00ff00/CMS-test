import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const library = (page: Page) => page.getByRole('region', { name: 'Snippet library' });

/** Replace the text of a code field (CodeMirror). */
async function setCode(page: Page, label: string, text: string) {
  // Wait for CodeMirror itself (a plain text area stands in while it loads).
  const editor = inspector(page).locator(`.cm-content[aria-label="${label}"]`);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('the library starts with five snippets that can be tried out', async ({ page }) => {
  await expect(library(page).getByRole('listitem')).toHaveCount(5);
  await expect(library(page)).toContainText('Callout');
  await expect(library(page)).toContainText('Code block');
  await library(page).getByRole('button', { name: /^Highlight/ }).click();
  await expect(inspector(page).getByRole('heading', { name: 'Snippet library' })).toBeVisible();
  const example = page.frameLocator('iframe[title="Snippet example"]');
  await expect(example.locator('mark.cms-hl-yellow')).toHaveText('Some example text to try the snippet on.');
  await inspector(page).getByRole('region', { name: 'Try it' }).getByLabel('Colour').selectOption('pink');
  await expect(example.locator('mark.cms-hl-pink')).toHaveCount(1);
});

test('switch a Snippet node to another library snippet and set its parameters', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption('details');
  await inspector(page).getByLabel('Summary').fill('Read this section');
  await expect(node(page, 'snippet-3')).toContainText('Collapsible details v1');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('details.cms-details > summary')).toHaveText(['Read this section', 'Read this section']);
});

test('saving a new version shows "update available" until the node is updated', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await library(page).getByRole('button', { name: /^Callout/ }).click();
  await setCode(page, 'Template', '<aside class="callout callout-{{params.variant}}"><strong>Note</strong>{{content}}</aside>');
  await expect(inspector(page)).toContainText('Unsaved changes');
  await inspector(page).getByRole('button', { name: 'Save as version 2' }).click();
  await expect(library(page).getByRole('button', { name: /^Callout/ })).toContainText('v2');
  await expect(inspector(page).getByRole('region', { name: 'Used by' })).toContainText('snippet-3 v1update available');
  await expect(node(page, 'snippet-3')).toContainText('Update available: v2');

  // The page still uses version 1.
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout strong')).toHaveCount(0);

  await node(page, 'snippet-3').click();
  await expect(inspector(page).getByRole('status')).toContainText('Version 2 is available.');
  await page.screenshot({ path: 'test-results/m7-update-available.png' });
  await inspector(page).getByRole('button', { name: 'Update to v2' }).click();
  await expect(node(page, 'snippet-3')).not.toContainText('Update available');
  await expect(node(page, 'snippet-3')).toContainText('Callout v2');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout strong')).toHaveText(['Note', 'Note']);
});

test('add a parameter to a snippet; it becomes a field on the node', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await library(page).getByRole('button', { name: /^Callout/ }).click();
  await inspector(page).getByRole('button', { name: 'Add parameter' }).click();
  const param = inspector(page).getByRole('group', { name: 'Parameter param2' });
  await param.getByLabel('Name').fill('title');
  await expect(inspector(page).getByRole('group', { name: 'Parameter title' })).toBeVisible();
  const p = inspector(page).getByRole('group', { name: 'Parameter title' });
  await p.getByLabel('Label').fill('Title');
  await p.getByLabel('Default').fill('Heads up');
  await setCode(page, 'Template', '<aside class="callout callout-{{params.variant}}"><b>{{params.title}}</b>{{content}}</aside>');
  // A bad parameter name blocks saving.
  await p.getByLabel('Name').fill('2bad');
  await expect(inspector(page).getByRole('list', { name: 'Problems' })).toContainText('Parameter name "2bad"');
  await expect(inspector(page).getByRole('button', { name: 'Save as version 2' })).toBeDisabled();
  await inspector(page).getByRole('group', { name: 'Parameter 2bad' }).getByLabel('Name').fill('title');
  await inspector(page).getByRole('button', { name: 'Save as version 2' }).click();

  await node(page, 'snippet-3').click();
  await inspector(page).getByRole('button', { name: 'Update to v2' }).click();
  await inspector(page).getByLabel('Title').fill('Remember');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('aside.callout b')).toHaveText(['Remember', 'Remember']);
});

test('drag a snippet from the library onto the canvas', async ({ page }) => {
  await library(page).getByRole('button', { name: /^Tooltip/ }).dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 300, y: 200 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toContainText('Tooltip v1');
});

test('edit a snippet in the node only, then save it to the library', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'snippet-3').click();
  await inspector(page).getByRole('button', { name: 'Edit here instead' }).click();
  await expect(node(page, 'snippet-3')).toContainText('Callout (custom)');
  await inspector(page).getByLabel('Snippet name').fill('Warning box');
  await setCode(page, 'Template', '<div class="warning-box">{{content}}</div>');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('div.warning-box h2')).toHaveCount(2);

  await node(page, 'snippet-3').click();
  await inspector(page).getByRole('button', { name: 'Save to library' }).click();
  await expect(library(page).getByRole('listitem')).toHaveCount(6);
  await expect(library(page)).toContainText('Warning box');
  await expect(node(page, 'snippet-3')).toContainText('Warning box v1');
  await page.screenshot({ path: 'test-results/m7-library.png' });
});

test('snippet JavaScript runs in the preview (code block copy button)', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'selector-2').click();
  await inspector(page).getByLabel('CSS selector').fill('li');
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption('code-block');
  await inspector(page).getByLabel('Language').selectOption('shell');
  await node(page, 'output-4').click();
  await expect(preview(page).locator('pre.cms-code code')).toHaveText(['Upload a document', 'Select some text', 'Apply a snippet']);
  await expect(preview(page).locator('pre.cms-code button.cms-copy')).toHaveCount(3);
});
