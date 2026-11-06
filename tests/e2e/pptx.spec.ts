import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('a PowerPoint deck is a document source: one section per slide, ready for selectors and snippets', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await expect(node(page, 'documentSource-1')).toContainText('sample.pptx · 14 of 15 slides (1 hidden)');
  await expect(preview(page).locator('section.slide')).toHaveCount(14);
  await expect(preview(page).locator('section.slide[data-slide="4"] li li li')).toHaveText('And now PowerPoint');
  await expect(preview(page).locator('aside.speaker-notes').first()).toHaveText('Talk about getting started.');

  // The example's Selector (h2) and Callout snippet work on slide titles as on any document.
  await node(page, 'output-4').click();
  await expect(preview(page).locator('section.slide h2').first()).toBeVisible();
  await expect(preview(page).locator('.callout h2')).toHaveCount(14);
  await page.screenshot({ path: 'test-results/pptx-source.png' });
});

test('tables, pictures and charts from a deck show in the preview', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await expect(inspector(page)).toContainText('a chart is shown as a table of its data');
  const slide = (n: number) => preview(page).locator(`section.slide[data-slide="${n}"]`);
  await expect(slide(13).locator('td[colspan="3"]')).toHaveText('Everything else');
  const img = slide(14).locator('a[href="https://example.com/"] img[alt="Logo"]');
  await expect(img).toBeVisible();
  // The picture's data came along (it is a real, loaded image).
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2);
  await expect(slide(15).locator('figure.slide-chart figcaption')).toHaveText('Growth');
  await expect(slide(15).locator('tbody tr')).toHaveCount(3);
  await slide(13).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/pptx-table-picture-chart.png' });
});

test('choose slides, notes and hidden slides in the Document Source', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  const list = inspector(page).getByRole('list', { name: 'Slides in the deck' });
  await expect(list.getByRole('listitem')).toHaveCount(15);
  const tick = (n: number) => list.getByRole('listitem').nth(n - 1).getByRole('checkbox');
  await expect(tick(6)).toBeDisabled(); // hidden
  await expect(list.getByRole('listitem').nth(5)).toContainText('Hidden extra');

  // Untick slide 2: the range is written for you.
  await tick(2).uncheck();
  await expect(inspector(page).getByLabel('Which slides')).toHaveValue('1, 3-5, 7-15');
  await expect(node(page, 'documentSource-1')).toContainText('13 of 15 slides');
  await expect(preview(page).locator('section.slide[data-slide="2"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/pptx-slide-options.png' });

  // Hidden slides can be included; then ticking slide 2 again includes everything: no range needed.
  await inspector(page).getByLabel('Include hidden slides').check();
  await expect(tick(6)).toBeEnabled();
  await tick(6).check();
  await tick(2).check();
  await expect(inspector(page).getByLabel('Which slides')).toHaveValue('');
  await expect(preview(page).locator('section.slide')).toHaveCount(15);
  await expect(preview(page).locator('section.slide[data-hidden]')).toHaveCount(1);

  // Type a range; turn notes and the slide look off.
  await inspector(page).getByLabel('Which slides').fill('13-15');
  await expect(preview(page).locator('section.slide')).toHaveCount(3);
  await expect(list.getByRole('listitem').nth(0).getByRole('checkbox')).not.toBeChecked();
  await inspector(page).getByLabel('Which slides').fill('2-5');
  await expect(preview(page).locator('aside.speaker-notes')).toHaveCount(3);
  await inspector(page).getByLabel('Speaker notes').uncheck();
  await expect(preview(page).locator('aside.speaker-notes')).toHaveCount(0);
  const card = preview(page).locator('section.slide').first();
  await expect(card).toHaveCSS('border-top-style', 'solid');
  await inspector(page).getByLabel('Look like slides').uncheck();
  await expect(card).toHaveCSS('border-top-style', 'none');
});

test('a Selector picks slides by number or title, and their titles, content or notes', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await expect(node(page, 'documentSource-1')).toContainText('sample.pptx');

  await node(page, 'selector-2').click();
  await inspector(page).getByLabel('Select by').selectOption({ label: 'Slides (from a .pptx)' });
  await expect(inspector(page)).toContainText("This document has 14 of the deck's 15 slides");
  await expect(node(page, 'selector-2')).toContainText('Slides · all slides · 14 matches');

  await inspector(page).getByLabel('Title contains').fill('topic');
  await inspector(page).getByLabel('Select', { exact: true }).selectOption('title');
  await expect(node(page, 'selector-2')).toContainText('Slide titles · all slides titled “topic” · 5 matches');
  await expect(preview(page).locator('[data-cms-match]')).toHaveCount(5);

  await inspector(page).getByLabel('Title contains').fill('');
  await inspector(page).getByLabel('Which slides').fill('2-6');
  await inspector(page).getByLabel('Select', { exact: true }).selectOption('notes');
  await expect(node(page, 'selector-2')).toContainText('Speaker notes · slides 2-6 · 3 matches');
  await expect(inspector(page)).toContainText('Slide 6 is not in the document');
  await expect(inspector(page)).toContainText('Slide 4 has no speaker notes');
  await preview(page).locator('[data-cms-match]').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/pptx-slide-selector.png' });

  // The Callout snippet now wraps each slide's notes.
  await node(page, 'output-4').click();
  await expect(preview(page).locator('.callout aside.speaker-notes, aside.speaker-notes .callout, .callout .speaker-notes')).toHaveCount(3);
});

test('export as a slide deck: one slide at a time, keys to move, N for notes, #3 opens slide 3', async ({ page, browser }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'documentSource-1').click();
  await inspector(page).getByLabel('File').setInputFiles(fixture('sample.pptx'));
  await node(page, 'output-4').click();
  await inspector(page).getByLabel('Export as').selectOption('slides');
  await expect(node(page, 'output-4')).toContainText('Slide deck · 14 slides');

  const deck = preview(page);
  const current = deck.locator('section.slide.cms-current');
  const count = deck.locator('.cms-deck-count');
  await expect(count).toHaveText('1 / 14');
  await expect(current).toHaveAttribute('data-slide', '1');
  await expect(deck.locator('section.slide:visible')).toHaveCount(1);
  await expect(deck.getByRole('button', { name: 'Previous slide' })).toBeDisabled();

  // Keys work once the deck has the focus (a click on it).
  await current.click();
  await page.keyboard.press('ArrowRight');
  await expect(current).toHaveAttribute('data-slide', '2');
  await expect(deck.locator('aside.speaker-notes:visible')).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(deck.locator('aside.speaker-notes:visible')).toHaveText('Talk about getting started.');
  await expect(deck.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('End');
  await expect(count).toHaveText('14 / 14');
  await expect(current).toHaveAttribute('data-slide', '15');
  await expect(deck.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  await deck.getByRole('button', { name: 'Previous slide' }).click();
  await expect(current).toHaveAttribute('data-slide', '14');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(current).toHaveAttribute('data-slide', '4');
  await page.screenshot({ path: 'test-results/pptx-slide-deck.png' });

  // The downloaded file works on its own, and #3 in its address opens the third slide.
  const [download] = await Promise.all([page.waitForEvent('download'), inspector(page).getByRole('button', { name: 'Download HTML' }).click()]);
  expect(download.suggestedFilename()).toBe('sample.slides.html');
  // Downloads are stored without an extension: give it one, so the browser opens it as a page.
  const file = join(test.info().outputDir, 'deck.html');
  await download.saveAs(file);
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await other.goto(`file://${file}#3`);
  await expect(other.locator('.cms-deck-count')).toHaveText('3 / 14');
  await expect(other.locator('section.slide.cms-current h2')).toHaveText('Pricing');
  await other.keyboard.press('ArrowRight');
  await expect(other).toHaveURL(/#4$/);
  await other.screenshot({ path: 'test-results/pptx-slide-deck-file.png' });
});

test('any document can be a slide deck: a new slide at each heading', async ({ page }) => {
  await page.getByRole('button', { name: 'HTML example' }).click();
  await node(page, 'output-4').click();
  await inspector(page).getByLabel('Export as').selectOption('slides');
  await expect(node(page, 'output-4')).toContainText('Slide deck · 3 slides');
  await expect(inspector(page)).toContainText('a new slide starts at each top-level heading');
  await expect(preview(page).locator('section.slide.cms-current h1')).toHaveText('Field Guide to Node Gardens');
});
