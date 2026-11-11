import { expect, test, type Page } from '@playwright/test';
import { reviewProjectFile } from '../word-review-project';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const preview = (page: Page) => page.frameLocator('iframe[title="Output preview"]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
});

test('Word review mode and the Changes node: keep, reject, drop a comment', async ({ page }) => {
  await page.getByLabel('Project file').setInputFiles(
    reviewProjectFile(
      [{ id: 'changes', type: 'changes', name: 'Changes', position: { x: 340, y: 80 }, config: { dropResolved: true } }],
      [{ id: 'e1', source: 'word', sourcePort: 'document', target: 'changes', targetPort: 'document' }],
    ),
  );
  await expect(node(page, 'word')).toContainText('hung-by-design-review.docx · 9 changes, 4 comments');
  await expect(node(page, 'changes')).toContainText('9 kept · 4 comment threads');

  // The preview shows the changes and comments.
  await node(page, 'word').click();
  await expect(preview(page).locator('del[data-rev]').first()).toHaveText('Hung by Design: ');
  await expect(preview(page).locator('span[data-comments]')).toHaveCount(4);
  await expect(preview(page).locator('del[data-rev]').first()).toHaveCSS('text-decoration-line', 'line-through');

  await node(page, 'changes').click();
  const list = inspector(page).getByRole('list', { name: 'Tracked changes' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.getByRole('listitem').nth(2)).toContainText('5 paragraphs');
  await expect(list.getByRole('listitem').nth(2)).toContainText('was: Normal, bulleted list');
  // Reject the deletion in the title: the words come back, as normal text.
  await list.getByRole('listitem').first().getByRole('combobox').selectOption('reject');
  await expect(node(page, 'changes')).toContainText('8 kept · 1 rejected');
  await expect(preview(page).locator('h1')).toHaveText("Hung by Design: Malaysia's Three-Way Tie and the Bargaining After GE16");
  await expect(preview(page).locator('h1 del')).toHaveCount(0);
  // Drop the "Test" comment.
  const comments = inspector(page).getByRole('list', { name: 'Comment threads' });
  await comments.getByRole('listitem').filter({ hasText: 'Test' }).getByRole('checkbox').uncheck();
  await expect(node(page, 'changes')).toContainText('3 comment threads');
  await expect(preview(page).locator('span[data-comments]')).toHaveCount(3);
  // Who the author is in the editor.
  await inspector(page).getByLabel('User id in the editor').fill('user-7');
  await page.screenshot({ path: 'test-results/word-review-changes.png' });
});
