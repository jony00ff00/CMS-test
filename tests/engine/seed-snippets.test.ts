import { describe, expect, it } from 'vitest';
import { applySnippet, parseHtml, runSelector, serialize } from '../../src/engine';
import { SEED_SNIPPETS } from '../../src/snippets/seed';

const byId = (id: string) => SEED_SNIPPETS.find((s) => s.id === id)!;
async function apply(id: string, html: string, selector: Parameters<typeof runSelector>[1], params?: Record<string, unknown>) {
  const doc = parseHtml(html);
  const r = await applySnippet(runSelector(doc, selector), byId(id), { params });
  expect(r.warnings).toEqual([]);
  return { html: serialize(r.document), page: serialize(r.document, { fullDocument: true }) };
}

describe('seed snippets', () => {
  it('callout', async () => {
    const r = await apply('callout', '<p>x</p>', { mode: 'css', selector: 'p' }, { variant: 'warning' });
    expect(r.html).toBe('<aside class="callout callout-warning"><p>x</p></aside>');
  });

  it('collapsible details, open or closed', async () => {
    const closed = await apply('details', '<p>x</p>', { mode: 'css', selector: 'p' });
    expect(closed.html).toBe('<details class="cms-details"><summary>Show more</summary><p>x</p></details>');
    const open = await apply('details', '<p>x</p>', { mode: 'css', selector: 'p' }, { open: true, summary: 'Why?' });
    expect(open.html).toBe('<details class="cms-details" open><summary>Why?</summary><p>x</p></details>');
  });

  it('highlight', async () => {
    const r = await apply('highlight', '<p>a key point here</p>', { mode: 'regex', pattern: 'key point' }, { color: 'green' });
    expect(r.html).toBe('<p>a <mark class="cms-hl cms-hl-green">key point</mark> here</p>');
    expect(r.page).toContain('.cms-hl-green{background:#bbf7d0}');
  });

  it('tooltip escapes its text', async () => {
    const r = await apply('tooltip', '<p>see API docs</p>', { mode: 'regex', pattern: 'API' }, { tip: 'Application "programming" interface' });
    expect(r.html).toBe('<p>see <span class="cms-tip" tabindex="0" data-tip="Application &#x22;programming&#x22; interface">API</span> docs</p>');
  });

  it('code block shows the text as code and adds its script to the page', async () => {
    const r = await apply('code-block', '<p>npm run <b>build</b> &lt;now&gt;</p>', { mode: 'css', selector: 'p' }, { language: 'shell' });
    expect(r.html).toBe('<pre class="cms-code" data-language="shell"><code>npm run build &#x3C;now></code></pre>');
    expect(r.page).toContain('<script data-snippet="code-block@1">document.querySelectorAll("pre.cms-code")');
  });
});
