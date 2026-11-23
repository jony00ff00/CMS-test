import { expect, test, type Page } from '@playwright/test';
import type { OutputConfig, SnippetNodeConfig } from '../../src/engine';
import { createEditorStore } from '../../src/store/editor-store';
import { toProjectFile } from '../../src/store/project';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');

/** The HTML example with a second Output, "fancy", after the Snippet (a custom one, class "plain"). */
function project() {
  const store = createEditorStore({ storage: null });
  const s = store.getState();
  s.loadExample('html');
  const out = s.addNode('output', { x: 1180, y: 320 });
  s.updateConfig<OutputConfig>(out, (c) => ({ ...c, variant: 'fancy' }));
  s.connect({ source: 'snippet-3', sourcePort: 'document', target: out, targetPort: 'document' });
  s.updateConfig<SnippetNodeConfig>('snippet-3', (c) => ({ ...c, ref: undefined, custom: { className: 'plain', wrap: 'none' } }));
  const { graph, files, library } = store.getState();
  return { name: 'variants.node-cms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(toProjectFile({ graph, files, library }))) };
}

test('a page variant: one node with its own settings for one Output', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(project());
  await expect(node(page, 'output-5')).toContainText('OK');

  await node(page, 'snippet-3').click();
  const settings = inspector(page).getByRole('group', { name: 'Settings for' });
  await expect(settings.getByRole('button', { name: 'All pages' })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'fancy' }).click();
  await expect(inspector(page)).toContainText('Changes here apply only to the “fancy” page.');
  // The preview now shows the "fancy" page.
  await expect(page.getByRole('group', { name: 'Page variant shown' }).getByRole('button', { name: 'fancy' })).toHaveAttribute('aria-pressed', 'true');
  const classes = inspector(page).getByLabel('Class names');
  await classes.fill('fancy');
  await expect(inspector(page)).toContainText('The “fancy” page uses its own custom.');
  await expect(node(page, 'snippet-3')).toContainText('Own settings: fancy');

  // Each Output makes its page.
  await node(page, 'output-5').click();
  await expect(preview(page).locator('h2.fancy').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/variants.png' });
  await node(page, 'output-4').click();
  await expect(preview(page).locator('h2.plain').first()).toBeVisible();
  await expect(preview(page).locator('.fancy')).toHaveCount(0);

  // The Snippet's own settings are unchanged.
  await node(page, 'snippet-3').click();
  await expect(settings.getByRole('button', { name: 'All pages' })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector(page).getByLabel('Class names')).toHaveValue('plain');

  // Back to the same settings for every page.
  await settings.getByRole('button', { name: /fancy/ }).click();
  await inspector(page).getByRole('button', { name: 'Use the same settings as all pages' }).click();
  await expect(node(page, 'snippet-3')).not.toContainText('Own settings');
  await node(page, 'output-5').click();
  await expect(preview(page).locator('h2.plain').first()).toBeVisible();
});
