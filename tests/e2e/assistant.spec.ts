import { expect, test, type Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const assistant = (page: Page) => page.getByRole('region', { name: 'Assistant' });

const PLAN = {
  reply: 'I added the HTML example’s headings as callouts.',
  operations: [
    { op: 'add', id: 'sel', type: 'selector', name: 'Paragraphs', config: { mode: 'css', selector: 'p' } },
    { op: 'add', id: 'snip', type: 'snippet', config: { custom: { className: 'from-model', wrap: 'none' } } },
    { op: 'connect', from: 'documentSource-1', to: 'sel' },
    { op: 'connect', from: 'sel', to: 'snip' },
    { op: 'connect', from: 'snip', to: 'output-4' },
    { op: 'connect', from: 'sel', to: 'nowhere' },
  ],
};

/** A fake Ollama on localhost: its model list, and one answer to every chat request (recorded). */
async function fakeServer(page: Page) {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  await page.route('http://localhost:11434/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'qwen2.5-coder:7b' }, { id: 'llama3.1:8b' }] } });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(PLAN) } }] } });
  });
  return requests;
}

test('the assistant proposes nodes from a request; Apply adds and connects them, Undo takes them back', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  const requests = await fakeServer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4')).toContainText('OK');

  await page.getByRole('button', { name: '✦ Assistant' }).click();
  const panel = assistant(page);
  // No model yet: settings are open.
  await panel.getByRole('button', { name: 'Find models' }).click();
  await expect(panel.getByLabel('Model')).toHaveValue('llama3.1:8b');
  await panel.getByLabel('Model').selectOption('qwen2.5-coder:7b');

  await panel.getByLabel('Ask the assistant').fill('Make every paragraph stand out');
  await panel.getByLabel('Ask the assistant').press('Enter');
  await expect(panel.getByText('I added the HTML example’s headings as callouts.')).toBeVisible();
  // The step that cannot be done is shown as skipped; after three tries it gives the last plan.
  await expect(panel.getByText(/skipped: There is no node “nowhere”/)).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[0].messages[0].content).toContain('documentSource-1 [documentSource: Document Source]');
  expect(requests[0].messages.at(-1)!.content).toBe('Make every paragraph stand out');
  expect(requests[1].messages.at(-1)!.content).toMatch(/could not be done/);
  await page.screenshot({ path: 'test-results/assistant-proposal.png' });

  // Nothing changed until Apply.
  await expect(node(page, 'selector-5')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(node(page, 'selector-5')).toContainText('Paragraphs');
  await expect(node(page, 'snippet-6')).toBeVisible();
  await expect(panel.getByText('Applied (Undo takes it back)')).toBeVisible();
  await expect(node(page, 'output-4')).toContainText('OK');
  await expect(page.frameLocator('iframe[title="Output preview"]').locator('p.from-model').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/assistant-applied.png' });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'selector-5')).toHaveCount(0);
});

test('the assistant says how to fix a server it cannot reach', async ({ page }) => {
  await page.route('http://localhost:11434/v1/**', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await page.getByRole('button', { name: '✦ Assistant' }).click();
  const panel = assistant(page);
  await panel.getByRole('button', { name: 'Find models' }).click();
  await expect(panel.getByRole('alert')).toContainText('set OLLAMA_ORIGINS to include http://localhost:4173');
});
