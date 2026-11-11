import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleJson } from '../../src/samples';
import { jsonExampleFile } from '../json-example';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

async function downloadText(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), text: readFileSync(path!, 'utf8') };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('the project is kept in the browser and opens again after a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'selector-2').click();
  await inspector(page).getByLabel('CSS selector').fill('h1');
  // A custom snippet saved to the library: the library is part of what is kept.
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption({ label: 'Custom (only this node)' });
  await inspector(page).getByLabel('Class names').fill('kept');
  await inspector(page).getByRole('button', { name: 'Save to library' }).click();
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();
  await page.waitForTimeout(800); // let the last change be saved

  await page.reload();
  await expect(node(page, 'selector-2')).toContainText('h1 · 1 match');
  await node(page, 'snippet-3').click();
  await expect(inspector(page).getByLabel('Snippet', { exact: true })).toHaveValue('kept');
  await expect(inspector(page).getByLabel('Snippet', { exact: true }).locator('option:not([value^="__"])')).toHaveCount(6);
  await node(page, 'selector-2').click();
  await node(page, 'output-4').click();
  await expect(preview(page).locator('h1.kept')).toHaveText('Field Guide to Node Gardens');
});

test('save a project file and open it again, with a .docx file in it', async ({ page, browser }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.docx'));
  await expect(node(page, 'documentSource-1')).toContainText('sample.docx');
  // Without the browser's save picker (e.g. Firefox, Safari), the dialog names the file and the browser downloads it.
  await page.evaluate(() => Object.assign(window, { showSaveFilePicker: undefined }));
  await page.getByRole('button', { name: 'Save project file…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save project file' });
  await dialog.getByLabel('File name').fill('My garden: v2');
  await expect(dialog).toContainText('Saved as My garden- v2.node-cms.json');
  const saved = await downloadText(page, () => dialog.getByRole('button', { name: 'Save', exact: true }).click());
  expect(saved.name).toBe('My garden- v2.node-cms.json');
  await expect(dialog).toHaveCount(0);
  const project = JSON.parse(saved.text);
  expect(project).toMatchObject({ format: 'node-cms-project', version: 1 });
  expect(project.files).toEqual([expect.objectContaining({ name: 'sample.docx', encoding: 'base64' })]);

  const other = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await other.goto('/');
  await other.getByLabel('Project file').setInputFiles({ name: 'project.node-cms.json', mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  await expect(other.getByRole('status').filter({ hasText: 'Project opened.' })).toBeVisible();
  await expect(other.locator('.react-flow__node')).toHaveCount(4);
  await expect(node(other, 'documentSource-1')).toContainText('sample.docx');
  await expect(preview(other).locator('aside.callout h2')).toHaveText(['Getting started', 'Pricing']);
});

test('opening something that is not a project says so', async ({ page }) => {
  await page.getByLabel('Project file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"x"}') });
  await expect(page.getByRole('alert')).toHaveText(/This is not a Node CMS project file/);
});

test('undo and redo, with the buttons and the keyboard', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'selector-2').click();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await undo.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await redo.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);

  await page.locator('.react-flow__pane').click({ position: { x: 50, y: 400 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+y');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  // Typing into a field is one undo step, and Ctrl+Z inside a field is the field's own undo.
  await node(page, 'selector-2').click();
  const field = inspector(page).getByLabel('CSS selector');
  await field.fill('h');
  await field.fill('h1');
  await field.fill('h1, p');
  await expect(node(page, 'selector-2')).toContainText('h1, p');
  await page.locator('.react-flow__pane').click({ position: { x: 50, y: 400 } });
  await undo.click();
  await expect(node(page, 'selector-2')).toContainText('h2 · 2 matches');
});

test('export a JSON source as JSON: only the changed fields differ', async ({ page }) => {
  page.once('dialog', (d) => void d.accept()); // "Open …? It replaces the current project." (when there is one)
  await page.getByLabel('Project file').setInputFiles(jsonExampleFile());
  await expect(page.getByText('Project opened.')).toBeVisible();
  await node(page, 'snippet-3').click();
  await inspector(page).getByLabel('Snippet', { exact: true }).selectOption('details');
  await inspector(page).getByLabel('Summary').fill('Answer');
  await node(page, 'output-4').click();
  await inspector(page).getByLabel('Export as').selectOption('json');
  await expect(node(page, 'output-4')).toContainText('JSON · 2 fields changed');
  await expect(preview(page).locator('details.cms-details')).toHaveCount(2);

  const file = await downloadText(page, () => inspector(page).getByRole('button', { name: 'Download JSON' }).click());
  expect(file.name).toBe('example.edited.json');
  const exported = JSON.parse(file.text);
  const original = JSON.parse(sampleJson());
  expect(exported.faq[0].a).toMatch(/^<details class="cms-details"><summary>Answer<\/summary><p>Yes\. Map <strong>string fields<\/strong>/);
  expect(exported.faq[1].a).toMatch(/^<details class="cms-details"><summary>Answer<\/summary>/);
  expect({ ...exported, faq: exported.faq.map((f: { q: string }) => f.q) }).toEqual({ ...original, faq: original.faq.map((f: { q: string }) => f.q) });
  await expect(node(page, 'output-4')).toContainText('1 warning'); // Markdown fields are written back as HTML
  await page.screenshot({ path: 'test-results/m8-json-export.png' });
});
