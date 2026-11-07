import { describe, expect, it } from 'vitest';
import {
  cleanClassNames, customSnippet, describeInsertion, GraphEvaluator, nodeRegistry, serialize, storeFile, type CmsDocument, type Graph, type GraphEdge, type GraphNode,
} from '../../src/engine';

const files = { a: storeFile('a.html', '<h1 class="title">A</h1><p>Some text</p>', 'a') };
const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files })).results;
const html = (v: unknown) => serialize(v as CmsDocument);

describe('custom snippets with several class names', () => {
  it('splits on spaces, cleans each name, and keeps each once', () => {
    expect(cleanClassNames('note  highlight')).toEqual(['note', 'highlight']);
    expect(cleanClassNames(' a.b  c! a.b ')).toEqual(['a-b', 'c']);
    expect(cleanClassNames('   ')).toEqual(['custom']);
    const s = customSnippet({ className: 'note highlight' });
    expect(s).toMatchObject({ id: 'custom-note-highlight', name: 'Custom (.note.highlight)', template: 'class="note highlight"' });
  });

  const custom = (className: string, wrap?: 'div' | 'span') => ({ ...(nodeRegistry.snippet.defaultConfig() as object), custom: { className, wrap } });
  const graph = (config: unknown, selector = 'h1'): Graph => ({
    nodes: [node('src', 'documentSource', { fileId: 'a' }), node('sel', 'selector', { mode: 'css', selector }), node('snip', 'snippet', config)],
    edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'snip', 'selection')],
  });

  it('adds all of them to the selected element, next to the classes it has', async () => {
    const r = await run(graph(custom('note highlight')));
    expect(html(r.snip.outputs.document)).toContain('<h1 class="title note highlight">A</h1>');
  });

  it('puts all of them on a wrapper, or on the <span> around selected text', async () => {
    const box = await run(graph(custom('note highlight', 'div')));
    expect(html(box.snip.outputs.document)).toContain('<div class="note highlight"><h1 class="title">A</h1></div>');
    const r = await run({
      nodes: [node('src', 'documentSource', { fileId: 'a' }), node('sel', 'selector', { mode: 'regex', pattern: 'Some' }), node('snip', 'snippet', custom('a b'))],
      edges: [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'snip', 'selection')],
    });
    expect(html(r.snip.outputs.document)).toContain('<p><span class="a b">Some</span> text</p>');
  });
});

describe('Object code with its own CSS and JavaScript', () => {
  const code = (extra: Record<string, unknown>) => ({ content: { kind: 'code', code: '<div class="banner">Hi</div>', render: 'html', ...extra } });
  const graph = (...configs: unknown[]): Graph => ({
    nodes: [
      node('src', 'documentSource', { fileId: 'a' }),
      node('pt', 'selector', { mode: 'css', selector: 'h1', place: 'after' }),
      ...configs.map((c, i) => node(`obj${i}`, 'object', c)),
      node('out', 'output'),
    ],
    edges: [
      edge('src', 'document', 'pt', 'document'),
      ...configs.flatMap((_, i) => [edge('pt', 'point', `obj${i}`, 'point'), edge(`obj${i}`, 'document', 'out', 'document')]),
    ],
  });

  it('adds them to the page once, with the inserted HTML', async () => {
    const r = await run(graph(code({ css: '.banner { color: red; }', js: 'window.banner = 1;' })));
    const doc = r.obj0.outputs.document as CmsDocument;
    expect(html(doc)).toContain('<h1 class="title">A</h1><div class="banner">Hi</div>');
    expect(doc.meta.snippetAssets?.filter((a) => a.key.startsWith('object-'))).toEqual([
      expect.objectContaining({ name: 'Inserted code', css: '.banner { color: red; }', js: 'window.banner = 1;' }),
    ]);
    const page = r.out.outputs.html as string;
    expect(page).toContain('.banner { color: red; }');
    expect(page).toContain('window.banner = 1;');
    expect(describeInsertion(code({ css: 'x' }).content as never)).toBe('HTML code + CSS/JS');
  });

  it('also for a code block, and the same code twice is added once', async () => {
    const block = { content: { kind: 'code', code: 'let x = 1;', render: 'block', language: 'javascript', css: 'pre { tab-size: 2; }' } };
    const r = await run(graph(block, block));
    expect(r.out.status).toBe('ok');
    expect((r.out.outputs.html as string).split('pre { tab-size: 2; }')).toHaveLength(2);
  });

  it('without CSS or JavaScript nothing is added', async () => {
    const r = await run(graph(code({})));
    expect((r.obj0.outputs.document as CmsDocument).meta.snippetAssets?.some((a) => a.key.startsWith('object-'))).toBe(false);
  });
});
