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

/**
 * HTML example + a Selector (selector-5) after the snippet whose Point feeds an Object (object-6), into a second
 * Output (output-7). The Selector is in point mode unless `pointMode` is false.
 */
async function setUp(page: Page, pointMode = true) {
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await palette.getByRole('button', { name: /^Object/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'snippet-3', 'document', 'selector-5', 'document');
  await connect(page, 'selector-5', 'point', 'object-6', 'point');
  await connect(page, 'object-6', 'document', 'output-7', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  if (pointMode) {
    await node(page, 'selector-5').click();
    await inspector(page).getByLabel('Select by').selectOption({ label: 'A point I click in the preview' });
    await expect(node(page, 'selector-5')).toContainText('Click in the preview to pick the point');
  }
}

/** With the point Selector selected, click after `phrase` and choose where. */
async function pickPoint(page: Page, phrase: string, choice: string) {
  await node(page, 'selector-5').click();
  await clickAfter(page, phrase);
  await page.getByRole('dialog', { name: 'Point here' }).getByRole('button', { name: choice }).click();
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

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('a Selector picks a point in the preview; an Object adds a linked image there', async ({ page }) => {
  await setUp(page);
  await clickAfter(page, 'costs nothing');
  const here = page.getByRole('dialog', { name: 'Point here' });
  await expect(here.getByRole('button')).toHaveText(['At the cursor', 'Before this paragraph', 'After this paragraph', '✕']);
  await here.getByRole('button', { name: 'At the cursor' }).click();
  await expect(node(page, 'selector-5')).toContainText('A point');
  await expect(inspector(page)).toContainText('Right after “basic plan costs nothing”');
  await expect(preview(page).locator('span.cms-insert-caret')).toHaveCount(1);

  await node(page, 'object-6').click();
  await expect(inspector(page)).toContainText('selector-5 · at the point picked in the preview');
  await inspector(page).getByLabel('Image address').fill('https://example.com/flower.png');
  await inspector(page).getByLabel('Alternative text').fill('A flower');
  await expect(node(page, 'object-6')).toContainText('Linked image · added 1×');
  await page.screenshot({ path: 'test-results/object-point.png' });

  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(preview(page).locator('p:has-text("costs nothing") > img')).toHaveAttribute('src', 'https://example.com/flower.png');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('img[alt="A flower"]')).toHaveCount(1);

  // Moving the point: in the Object's "Where it goes" view, or on the Selector.
  await node(page, 'object-6').click();
  await clickAfter(page, 'Plant a source node first.');
  await page.getByRole('dialog', { name: 'Point here' }).getByRole('button', { name: 'Before this paragraph' }).click();
  await expect(preview(page).locator('div.cms-insert-marker')).toHaveText('Insertion goes here');
  await node(page, 'selector-5').click();
  await expect(inspector(page)).toContainText('Before the paragraph “Plant a source node first. Then connect…”');
});

test('an Object adds an uploaded video after a heading', async ({ page }) => {
  await setUp(page);
  await pickPoint(page, 'Pricing', 'After this heading');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('video');
  await inspector(page).getByLabel('Video file').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]) });
  await inspector(page).getByLabel('Caption').fill('How it works');
  await node(page, 'output-7').click();
  const figure = preview(page).locator('aside.callout figure.cms-figure');
  await expect(figure.locator('video')).toHaveAttribute('src', /^data:video\/mp4;base64,/);
  await expect(figure.locator('figcaption')).toHaveText('How it works');
});

test('code in an Object can bring its own CSS and JavaScript', async ({ page }) => {
  await setUp(page, false);
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('code');
  await inspector(page).getByLabel('Show it as').selectOption('html');
  await inspector(page).locator('.cm-content[aria-label="Code"]').click();
  await page.keyboard.insertText('<div class="banner">Hello</div>');
  await inspector(page).getByText('CSS and JavaScript for this code').click();
  await inspector(page).locator('.cm-content[aria-label="CSS"]').click();
  await page.keyboard.insertText('.banner { color: rgb(5, 150, 105); }');
  await inspector(page).locator('.cm-content[aria-label="JavaScript"]').click();
  await page.keyboard.insertText("document.querySelectorAll('.banner').forEach((el) => el.setAttribute('data-ran', 'yes'));");
  await expect(node(page, 'object-6')).toContainText('HTML code + CSS/JS · added 2×');
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  const banner = preview(page).locator('div.banner').first();
  await expect(banner).toHaveCSS('color', 'rgb(5, 150, 105)');
  await expect(banner).toHaveAttribute('data-ran', 'yes');
  await page.screenshot({ path: 'test-results/object-code-css-js.png' });
});

test('an Object adds a code block after every match of its Selector', async ({ page }) => {
  await setUp(page, false);
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('CSS selector').fill('blockquote, ol');
  await inspector(page).getByLabel('Point output').selectOption('after');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('code');
  await inspector(page).getByLabel('Language').selectOption('shell');
  const code = inspector(page).locator('.cm-content[aria-label="Code"]');
  await code.click();
  await page.keyboard.insertText('npm run build');
  await expect(inspector(page)).toContainText('selector-5 · after every match');
  await expect(node(page, 'object-6')).toContainText('Code (shell) · added 2×');
  await expect(preview(page).locator('div.cms-insert-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await expect(preview(page).locator('pre.cms-insert-code code')).toHaveText(['npm run build', 'npm run build']);
  await expect(preview(page).locator('blockquote + pre.cms-insert-code')).toHaveCount(1);
  // Inside each match, at the start, instead.
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('Point output').selectOption('start');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('blockquote > pre.cms-insert-code:first-child')).toHaveCount(1);
});

test('an Object adds a YouTube video from a link', async ({ page }) => {
  await setUp(page);
  await pickPoint(page, 'Field Guide to Node Gardens', 'After this heading');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('videoUrl');
  await inspector(page).getByLabel('Video address').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(node(page, 'object-6')).toContainText('1 warning');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('h1 + .cms-embed iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});

test('an uploaded image with a caption is kept after a reload', async ({ page }) => {
  await setUp(page);
  await pickPoint(page, 'Every node does one job well.', 'After this paragraph');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('image');
  await inspector(page).getByLabel('Image file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') });
  await inspector(page).getByLabel('Alternative text').fill('Logo');
  await inspector(page).getByLabel('Caption').fill('Our logo');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('figure img[alt="Logo"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();
  await page.waitForTimeout(800);

  await page.reload();
  await node(page, 'output-7').click();
  await expect(preview(page).locator('figure figcaption')).toHaveText('Our logo');
  await expect(preview(page).locator('figure img[alt="Logo"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
});

test('an Output combines the changes of several inputs into one document', async ({ page }) => {
  // The HTML example's Snippet goes into output-4. Add a Selector + Object fed by the same source, into the same Output.
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await palette.getByRole('button', { name: /^Object/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-5', 'document');
  await connect(page, 'selector-5', 'point', 'object-6', 'point');
  await connect(page, 'object-6', 'document', 'output-4', 'document');
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  await node(page, 'selector-5').click();
  await inspector(page).getByLabel('CSS selector').fill('h1');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('code');
  await inspector(page).getByLabel('Show it as').selectOption('html');
  await inspector(page).locator('.cm-content[aria-label="Code"]').click();
  await page.keyboard.insertText('<p class="from-object">Added by the Object node</p>');
  await expect(node(page, 'output-4')).toContainText('2 combined');

  await node(page, 'output-4').click();
  const result = preview(page);
  await expect(result.locator('h1')).toHaveCount(1);
  await expect(result.locator('aside.callout h2')).toHaveText(['Getting started', 'Pricing']);
  await expect(result.locator('h1 + p.from-object')).toHaveText('Added by the Object node');
  await page.screenshot({ path: 'test-results/output-combined.png' });

  const order = inspector(page).getByRole('list', { name: 'Documents in page order' });
  await expect(order.getByRole('listitem')).toHaveText([/Snippet · snippet-3/, /Object · object-6/]);
  await inspector(page).getByRole('button', { name: 'Move object-6 up' }).click();
  await expect(order.getByRole('listitem')).toHaveText([/Object · object-6/, /Snippet · snippet-3/]);
  await expect(result.locator('h1 + p.from-object')).toHaveCount(1);
  await expect(result.locator('aside.callout')).toHaveCount(2);

  // "One after another" shows each document in full instead.
  await inspector(page).getByLabel('Combine the documents').selectOption('append');
  await expect(result.locator('h1')).toHaveCount(2);
  await expect(node(page, 'output-4')).toContainText('2 documents');
  await expect(inspector(page)).toContainText('Documents shown one after another can only be made into a web page.');
});

test('the width of an object takes any CSS unit', async ({ page }) => {
  await setUp(page);
  await pickPoint(page, 'Field Guide to Node Gardens', 'After this heading');
  await node(page, 'object-6').click();
  await inspector(page).getByLabel('Image address').fill('https://example.com/flower.png');
  await inspector(page).getByLabel('Alternative text').fill('A flower');
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
});

test('the Output node is red', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await expect(node(page, 'output-4').locator('.cms-node')).toHaveCSS('border-top-color', 'rgb(220, 38, 38)');
  await expect(page.getByRole('complementary', { name: 'Node palette' }).getByRole('button', { name: /^Output/ })).toHaveCSS(
    'border-left-color',
    'rgb(220, 38, 38)',
  );
});

test('an Object adds content picked by another Selector', async ({ page }) => {
  await setUp(page, false);
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-8', 'document');
  // Connecting a selection switches the Object to "Content from another node".
  await connect(page, 'selector-8', 'selection', 'object-6', 'content');
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(node(page, 'object-6')).toContainText('Content from another node');

  await node(page, 'selector-8').click();
  await inspector(page).getByLabel('CSS selector').fill('h1');
  await node(page, 'object-6').click();
  await expect(inspector(page).getByLabel('Object', { exact: true })).toHaveValue('selection');
  await expect(inspector(page)).toContainText('A copy of what comes from selector-8 (1 match)');
  await expect(node(page, 'object-6')).toContainText('added 2×'); // after each h2 of selector-5

  await node(page, 'output-7').click();
  await expect(preview(page).locator('h1')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/object-selection.png' });
});

test('"Two documents": an Extractor’s section of one document goes into another', async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Two documents' }).click();
  await expect(node(page, 'object-5')).toContainText('Content (labelled section) · added 1×');
  // The Output: the notes' Watering section before the guide's quote, its headings one level down.
  await expect(preview(page).locator('section.cms-from h3')).toHaveText('Watering');
  await expect(preview(page).locator('section.cms-from h4')).toHaveText('In winter');
  await expect(preview(page).locator('.cms-from-label')).toHaveText('From notes.html');
  await expect(preview(page).locator('section.cms-from + blockquote')).toHaveCount(1);
  await expect(preview(page).locator('.tip')).toHaveCSS('color', 'rgb(22, 101, 52)');
  await page.screenshot({ path: 'test-results/two-documents.png' });

  await node(page, 'object-5').click();
  const show = page.getByRole('group', { name: 'Show' });
  await expect(show.getByRole('button')).toHaveText(['Where it goes', 'Content', 'Result']);
  await expect(preview(page).locator('.cms-insert-marker')).toBeVisible();
  await show.getByRole('button', { name: 'Content' }).click();
  await expect(preview(page).locator('h1')).toHaveCount(0);
  await expect(preview(page).locator('.cms-from-label')).toHaveText('From notes.html');
  await page.screenshot({ path: 'test-results/object-content-view.png' });

  // Options: keep the headings, no wrapper, no source styles.
  await inspector(page).getByLabel('Heading levels').selectOption('keep');
  await inspector(page).getByLabel('Put it in').selectOption('none');
  await inspector(page).getByLabel('Bring the source’s styles').uncheck();
  await show.getByRole('button', { name: 'Result' }).click();
  await expect(preview(page).locator('h2', { hasText: 'Watering' })).toBeVisible();
  await expect(preview(page).locator('.cms-from')).toHaveCount(0);
  await expect(preview(page).locator('.tip')).not.toHaveCSS('color', 'rgb(22, 101, 52)');
});

test('an Object with plain text works on its own, and goes into a paragraph at the cursor', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  const palette = page.getByRole('complementary', { name: 'Node palette' });
  await palette.getByRole('button', { name: /^Object/ }).click();
  await inspector(page).getByLabel('Object', { exact: true }).selectOption('text');
  await inspector(page).getByLabel('Text', { exact: true }).fill('Fresh <news> & more\n\nSecond paragraph');
  // No Point: the Object gives its text alone.
  await expect(node(page, 'object-5')).toContainText('Text paragraphs · on its own');
  await expect(inspector(page)).toContainText('No Point connected');
  await expect(preview(page).locator('body > p')).toHaveText(['Fresh <news> & more', 'Second paragraph']);
  await page.screenshot({ path: 'test-results/object-text-alone.png' });

  // With a Point after every h2, inside the heading's text.
  await palette.getByRole('button', { name: /^Selector/ }).click();
  await palette.getByRole('button', { name: /^Output/ }).click();
  await fitView(page);
  await connect(page, 'documentSource-1', 'document', 'selector-6', 'document');
  await connect(page, 'selector-6', 'point', 'object-5', 'point');
  await connect(page, 'object-5', 'document', 'output-7', 'document');
  await node(page, 'selector-6').click();
  await inspector(page).getByLabel('Select by').selectOption('regex');
  await inspector(page).getByLabel('Pattern').fill('Pricing');
  await node(page, 'object-5').click();
  await inspector(page).getByLabel('Text', { exact: true }).fill(' (updated)');
  await inspector(page).getByLabel('Add it as').selectOption('inline');
  await expect(node(page, 'object-5')).toContainText('Text · added 1×');
  await node(page, 'output-7').click();
  await expect(preview(page).locator('h2').nth(1)).toHaveText('Pricing (updated)');
});
