import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseProject, toProjectFile } from '../../src/store/project';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');

/** The scrolly example's two sources (code and Word text) feeding one empty Fill template node, and an Output. */
function project() {
  const { project } = parseProject(readFileSync('examples/ge16-scrolly.node-cms.json', 'utf8'));
  const sources = project.graph.nodes.filter((n) => n.type === 'documentSource');
  const graph = {
    nodes: [
      { ...sources.find((n) => n.id === 'code')!, position: { x: 0, y: 0 } },
      { ...sources.find((n) => n.id === 'text')!, position: { x: 0, y: 220 } },
      { id: 'fill', type: 'fillTemplate', config: { rows: [] }, position: { x: 320, y: 100 } },
      { id: 'page', type: 'output', config: { format: 'html', fullDocument: true, inlineAssets: true }, position: { x: 640, y: 100 } },
    ],
    edges: [
      { id: 'e1', source: 'code', sourcePort: 'document', target: 'fill', targetPort: 'template' },
      { id: 'e2', source: 'text', sourcePort: 'document', target: 'fill', targetPort: 'content' },
      { id: 'e3', source: 'fill', sourcePort: 'document', target: 'page', targetPort: 'document' },
    ],
  };
  const file = toProjectFile({ ...project, graph });
  return { name: 'fill.node-cms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) };
}

test('Fill template: rows by name, a repeat that follows the Word steps', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByLabel('Project file').setInputFiles(project());
  await expect(node(page, 'fill')).toContainText('Waiting');
  await node(page, 'fill').click();

  // Match by name: gs-kicker ← kicker, gs-dek ← dek.
  await inspector(page).getByRole('button', { name: 'Match by name (2)' }).click();
  const rows = inspector(page).getByRole('list', { name: 'Rows' });
  await expect(rows.getByRole('listitem')).toHaveCount(2);
  await expect(rows.getByRole('status').first()).toContainText('1 slot · 1 match · filled');
  await expect(node(page, 'fill')).toContainText('2 of 2 rows filled');

  // A slot whose name differs: the headline from the Word "Title" style.
  await inspector(page).getByRole('button', { name: 'Add slot', exact: true }).click();
  const third = rows.getByRole('listitem').nth(2);
  await third.getByLabel('Slot in the template').fill('.gs-headline');
  await third.getByLabel('From the content: CSS').fill('.title');
  await expect(third.getByRole('status')).toContainText('filled');

  // One step card per "Step" heading in the Word text.
  await inspector(page).getByRole('button', { name: 'Add repeat' }).click();
  const repeat = rows.getByRole('listitem').nth(3);
  await repeat.getByLabel('Template element to repeat').fill('.gs-step');
  await repeat.getByLabel('One copy per: heading text').fill('Step');
  await repeat.getByLabel('With the heading').uncheck();
  await repeat.getByRole('button', { name: 'Add a slot in each copy' }).click();
  await repeat.getByLabel('Slot in each copy').fill('.gs-card');
  await repeat.getByLabel('From each item').selectOption('all');
  await expect(repeat.getByRole('status').first()).toContainText('items · 10 template elements in the template');

  const items = Number((await repeat.getByRole('status').first().textContent())!.match(/(\d+) items/)![1]);
  expect(items).toBeGreaterThan(1);
  await node(page, 'page').click();
  await expect(preview(page).locator('.gs-step')).toHaveCount(items);
  await expect(preview(page).locator('.gs-kicker')).not.toHaveText('Scenario · GE16');
  // Every step card holds Word text, none the template's.
  await expect(preview(page).locator('.gs-card').first()).not.toBeEmpty();

  // Expectations: at least 20 steps is a problem on the row.
  await node(page, 'fill').click();
  await repeat.getByLabel('At least').fill('20');
  await expect(repeat.getByRole('status').first()).toContainText('expected at least 20');
  await page.screenshot({ path: 'test-results/fill-template.png' });
  // The problem shows on the node, on the Output after it and in the preview; the page is still made.
  await expect(node(page, 'fill')).toContainText('1 problem');
  await expect(node(page, 'page')).toContainText('1 problem before this page');
  await node(page, 'page').click();
  await expect(page.getByRole('region', { name: 'Preview' }).locator('.problems-note')).toContainText('1 problem on this page');
  await expect(inspector(page).getByRole('list', { name: 'Problems before this page' })).toContainText('expected at least 20');
  const download = inspector(page).getByRole('button', { name: 'Download HTML' });
  await expect(download).toBeEnabled();
  await inspector(page).getByLabel("Don't download while there are problems").check();
  await expect(download).toBeDisabled();
  await expect(node(page, 'page')).toContainText('download off');
  await page.screenshot({ path: 'test-results/problems.png' });
  // Fixed: the problem goes, the page can be downloaded.
  await inspector(page).getByRole('list', { name: 'Problems before this page' }).getByRole('button', { name: 'fill' }).click();
  await rows.getByRole('listitem').nth(3).getByLabel('At least').fill('');
  await expect(node(page, 'page')).not.toContainText('problem');
  await node(page, 'page').click();
  await expect(download).toBeEnabled();
});
