import { describe, expect, it } from 'vitest';
import {
  applySnippet, buildTextIndex, createAnchor, highlightSelection, parseHtml, runSelector, serialize, type Snippet,
} from '../../src/engine';
import { fixture } from './helpers';

describe('highlightSelection', () => {
  it('marks matched elements and wraps matched text, without changing the text', async () => {
    const doc = parseHtml(fixture('sample.html').toString());
    for (const config of [
      { mode: 'css', selector: 'h2' },
      { mode: 'regex', pattern: 'plan \\w+' },
      { mode: 'regex', pattern: 'nothing\\. The pro plan adds snippets\\.\\nEvery' },
      { mode: 'heading', text: 'Pricing' },
    ] as const) {
      const selection = runSelector(doc, config);
      const marked = await highlightSelection(selection);
      expect(buildTextIndex(marked.tree).text, config.mode).toBe(buildTextIndex(doc.tree).text);
      expect(serialize(marked), config.mode).toContain('data-cms-match="1"');
    }
    const html = serialize(await highlightSelection(runSelector(doc, { mode: 'regex', pattern: 'plan \\w+' })));
    expect(html).toContain('The basic <span data-cms-match="1" data-cms-status="exact">plan costs</span>');
    expect(html).toContain('<span data-cms-match="2" data-cms-status="exact">plan adds</span>');
  });

  it('shows the status of saved selections', async () => {
    const original = parseHtml('<p>The quick brown fox jumps.</p>');
    const anchor = createAnchor(original, runSelector(original, { mode: 'css', selector: 'p' }).matches[0].match);
    const edited = parseHtml('<p>The quick brown cat jumps.</p>');
    const marked = await highlightSelection(runSelector(edited, { mode: 'manual', anchors: [anchor] }));
    expect(serialize(marked)).toBe('<p data-cms-match="1" data-cms-status="fuzzy">The quick brown cat jumps.</p>');
  });

  it('returns the same document when nothing matched', async () => {
    const doc = parseHtml('<p>x</p>');
    const selection = runSelector(doc, { mode: 'css', selector: 'h1' });
    expect(await highlightSelection(selection)).toBe(doc);
  });

  it('never changes the selection document', async () => {
    const doc = parseHtml('<p>a b c</p>');
    const before = JSON.stringify(doc);
    await highlightSelection(runSelector(doc, { mode: 'regex', pattern: 'b' }));
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('applySnippet matchData', () => {
  it('passes per-match data to the template as {{match}}', async () => {
    const doc = parseHtml('<p>a</p><p>b</p>');
    const snippet: Snippet = { kind: 'snippet', id: 's', name: 'S', version: 1, mode: 'wrap', template: '<div title="{{match.label}}">{{content}}</div>', params: [] };
    const r = await applySnippet(runSelector(doc, { mode: 'css', selector: 'p' }), snippet, { matchData: (i) => ({ label: `#${i + 1}` }) });
    expect(serialize(r.document)).toBe('<div title="#1"><p>a</p></div><div title="#2"><p>b</p></div>');
  });
});
