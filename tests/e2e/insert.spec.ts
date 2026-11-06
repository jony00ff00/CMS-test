import { expect, test, type Page } from '@playwright/test';
import { PNG_BASE64 } from '../../src/samples';

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

export async function fitView(page: Page) {
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

/** HTML example + an Insert node after the snippet, feeding a second Output. */
async function setUp(page: Page) {
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Insert/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'snippet-3', 'document', 'insert-5', 'document');
  await connect(page, 'insert-5', 'document', 'output-6', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await node(page, 'insert-5').click();
}

/** Click in the preview right after `phrase` (puts the cursor there, like a mouse click). */
async function clickAfter(page: Page, phrase: string) {
  await expect(preview(page).locator('body')).toContainText(phrase);
  const frame = (await (await page.locator('iframe[title="Output preview"]').elementHandle())!.contentFrame())!;
  await frame.evaluate((p) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(p);
      if (i === -1) continue;
      const range = document.createRange();
      range.setStart(n, i + p.length);
      range.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      const box = range.getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: box.x, clientY: box.y, bubbles: true }));
      return;
    }
    throw new Error(`"${p}" not found`);
  }, phrase);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('insert a linked image at the cursor', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Image address').fill('https://example.com/flower.png');
  await inspector(page).getByLabel('Alternative text').fill('A flower');
  await expect(node(page, 'insert-5')).toContainText('Click in the preview where the insertion should go');

  await clickAfter(page, 'costs nothing');
  const here = page.getByRole('dialog', { name: 'Insert here' });
  await expect(here.getByRole('button')).toHaveText(['At the cursor', 'Before this paragraph', 'After this paragraph', '✕']);
  await here.getByRole('button', { name: 'At the cursor' }).click();

  await expect(node(page, 'insert-5')).toContainText('Linked image · at a picked point');
  await expect(inspector(page)).toContainText('Right after “basic plan costs nothing”');
  await expect(preview(page).locator('span.cms-insert-caret')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/insert-point.png' });

  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(preview(page).locator('p:has-text("costs nothing") > img')).toHaveAttribute('src', 'https://example.com/flower.png');
  await node(page, 'output-6').click();
  await expect(preview(page).locator('img[alt="A flower"]')).toHaveCount(1);

  // Moving the point: select the node again and click elsewhere.
  await node(page, 'insert-5').click();
  await clickAfter(page, 'Plant a source node first.');
  await page.getByRole('dialog', { name: 'Insert here' }).getByRole('button', { name: 'Before this paragraph' }).click();
  await expect(inspector(page)).toContainText('Before the paragraph “Plant a source node first. Then connect…”');
  await expect(preview(page).locator('div.cms-insert-marker')).toHaveText('Insertion goes here');
});

test('insert an uploaded video after a heading', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Insert', { exact: true }).selectOption('video');
  await inspector(page).getByLabel('Video file').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]) });
  await inspector(page).getByLabel('Caption').fill('How it works');
  await clickAfter(page, 'Pricing');
  const here = page.getByRole('dialog', { name: 'Insert here' });
  // A video cannot go inside a heading, so there is no "At the cursor".
  await expect(here.getByRole('button', { name: 'At the cursor' })).toHaveCount(0);
  await here.getByRole('button', { name: 'After this heading' }).click();
  await node(page, 'output-6').click();
  const figure = preview(page).locator('aside.callout figure.cms-figure');
  await expect(figure.locator('video')).toHaveAttribute('src', /^data:video\/mp4;base64,/);
  await expect(figure.locator('figcaption')).toHaveText('How it works');
});

test('insert a code block after every match of a selector', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Insert', { exact: true }).selectOption('code');
  await inspector(page).getByLabel('Language').selectOption('shell');
  const code = inspector(page).locator('.cm-content[aria-label="Code"]');
  await code.click();
  await page.keyboard.insertText('npm run build');
  await inspector(page).getByLabel('Place it').selectOption('selector');
  await inspector(page).getByLabel('CSS selector').fill('blockquote, ol');
  await inspector(page).getByLabel('Relative to each match').selectOption('after');
  await expect(node(page, 'insert-5')).toContainText('Code (shell) · after each match');
  await expect(preview(page).locator('div.cms-insert-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(preview(page).locator('pre.cms-insert-code code')).toHaveText(['npm run build', 'npm run build']);
  await expect(preview(page).locator('blockquote + pre.cms-insert-code')).toHaveCount(1);
});

test('insert a YouTube video from a link', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Insert', { exact: true }).selectOption('videoUrl');
  await inspector(page).getByLabel('Video address').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await clickAfter(page, 'Field Guide to Node Gardens');
  await page.getByRole('dialog', { name: 'Insert here' }).getByRole('button', { name: 'After this heading' }).click();
  await expect(node(page, 'insert-5')).toContainText('1 warning');
  await node(page, 'output-6').click();
  await expect(preview(page).locator('h1 + .cms-embed iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});

test('an uploaded image with a caption is kept after a reload', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Insert', { exact: true }).selectOption('image');
  await inspector(page).getByLabel('Image file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') });
  await inspector(page).getByLabel('Alternative text').fill('Logo');
  await inspector(page).getByLabel('Caption').fill('Our logo');
  await clickAfter(page, 'Every node does one job well.');
  await page.getByRole('dialog', { name: 'Insert here' }).getByRole('button', { name: 'After this paragraph' }).click();
  await node(page, 'output-6').click();
  await expect(preview(page).locator('figure img[alt="Logo"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();
  await page.waitForTimeout(800);

  await page.reload();
  await node(page, 'output-6').click();
  await expect(preview(page).locator('figure figcaption')).toHaveText('Our logo');
  await expect(preview(page).locator('figure img[alt="Logo"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
});

test('an Output combines the changes of several inputs into one document', async ({ page }) => {
  // The HTML example's Snippet goes into output-4. Add an Insert node fed by the same source, into the same Output.
  await page.getByRole('button', { name: 'HTML example' }).click();
  await page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Insert/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'insert-5', 'document');
  await connect(page, 'insert-5', 'document', 'output-4', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await node(page, 'insert-5').click();
  await inspector(page).getByLabel('Insert', { exact: true }).selectOption('code');
  await inspector(page).getByLabel('Show it as').selectOption('html');
  await inspector(page).locator('.cm-content[aria-label="Code"]').click();
  await page.keyboard.insertText('<p class="from-insert">Added by the Insert node</p>');
  await inspector(page).getByLabel('Place it').selectOption('selector');
  await inspector(page).getByLabel('CSS selector').fill('h1');
  await expect(node(page, 'output-4')).toContainText('2 combined');

  await node(page, 'output-4').click();
  const result = preview(page);
  await expect(result.locator('h1')).toHaveCount(1);
  await expect(result.locator('aside.callout h2')).toHaveText(['Getting started', 'Pricing']);
  await expect(result.locator('h1 + p.from-insert')).toHaveText('Added by the Insert node');
  await page.screenshot({ path: 'test-results/output-combined.png' });

  const order = inspector(page).getByRole('list', { name: 'Documents in page order' });
  await expect(order.getByRole('listitem')).toHaveText([/Snippet · snippet-3/, /Insert · insert-5/]);
  await inspector(page).getByRole('button', { name: 'Move insert-5 up' }).click();
  await expect(order.getByRole('listitem')).toHaveText([/Insert · insert-5/, /Snippet · snippet-3/]);
  await expect(result.locator('h1 + p.from-insert')).toHaveCount(1);
  await expect(result.locator('aside.callout')).toHaveCount(2);

  // "One after another" shows each document in full instead.
  await inspector(page).getByLabel('Combine the documents').selectOption('append');
  await expect(result.locator('h1')).toHaveCount(2);
  await expect(node(page, 'output-4')).toContainText('2 documents');
  await expect(inspector(page)).toContainText('Documents shown one after another can only be made into a web page.');
});

test('the width of an insertion takes any CSS unit', async ({ page }) => {
  await setUp(page);
  await inspector(page).getByLabel('Image address').fill('https://example.com/flower.png');
  await inspector(page).getByLabel('Alternative text').fill('A flower');
  await clickAfter(page, 'Field Guide to Node Gardens');
  await page.getByRole('dialog', { name: 'Insert here' }).getByRole('button', { name: 'After this heading' }).click();
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  const img = preview(page).locator('img[alt="A flower"]');
  await expect(img).toHaveAttribute('style', 'width:100%');

  const width = inspector(page).getByLabel('Width');
  for (const [typed, used] of [['50%', '50%'], ['320', '320px'], ['12.5em', '12.5em'], ['2rem', '2rem']]) {
    await width.fill(typed);
    await expect(img).toHaveAttribute('style', `width:${used}`);
  }
  await expect(inspector(page)).toContainText('Using 2rem.');
  await width.fill('wide');
  await expect(inspector(page)).toContainText('"wide" is not a width');
  await expect(img).toHaveAttribute('style', 'width:100%');
  await width.fill('');
  await expect(img).toHaveAttribute('style', 'width:100%');
});

test('the Output node is red', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4').locator('.cms-node')).toHaveCSS('border-top-color', 'rgb(220, 38, 38)');
  await expect(page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Output/ })).toHaveCSS(
    'border-left-color',
    'rgb(220, 38, 38)',
  );
});

/** The preview page's text, as the preview measures it. */
async function previewText(page: Page): Promise<string> {
  await expect(preview(page).locator('body')).not.toBeEmpty();
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Output preview"]')!;
        addEventListener('message', function on(e) {
          if (e.data?.source === 'cms-preview' && e.data.type === 'text') {
            removeEventListener('message', on);
            resolve(e.data.text);
          }
        });
        frame.contentWindow!.postMessage({ source: 'cms-preview', type: 'get-text' }, '*');
      }),
  );
}
