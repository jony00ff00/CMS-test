import { describe, expect, it } from 'vitest';
import {
  customSnippet, GraphEvaluator, nodeRegistry, serialize, storeFile, type CmsDocument, type Graph, type GraphEdge, type GraphNode, type Selection,
} from '../../src/engine';

const files = {
  html: storeFile('a.html', '<h1>Title</h1><p>Intro <em>here</em>.</p><h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>', 'html'),
  other: storeFile('b.html', '<blockquote>Elsewhere</blockquote>', 'other'),
};
const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const run = async (g: Graph) => (await new GraphEvaluator(nodeRegistry).evaluate(g, { files })).results;
const html = (v: unknown) => serialize(v as CmsDocument);

describe('Extractor', () => {
  it('keeps only what it picks, in document order, and removes the rest', async () => {
    const r = await run({
      nodes: [node('src', 'documentSource', { fileId: 'html' }), node('x', 'extractor', { mode: 'css', selector: 'h2, h1' })],
      edges: [edge('src', 'document', 'x', 'document')],
    });
    expect(html(r.x.outputs.document)).toBe('<h1>Title</h1><h2>One</h2><h2>Two</h2>');
    expect(r.x.info).toMatchObject({ matches: 3, kept: 3 });
  });

  it('keeps whole sections, or just some text with its formatting', async () => {
    const r = await run({
      nodes: [
        node('src', 'documentSource', { fileId: 'html' }),
        node('sec', 'extractor', { mode: 'heading', text: 'Two', includeHeading: true }),
        node('txt', 'extractor', { mode: 'regex', pattern: 'Intro here', flags: 'i' }),
      ],
      edges: [edge('src', 'document', 'sec', 'document'), edge('src', 'document', 'txt', 'document')],
    });
    expect(html(r.sec.outputs.document)).toBe('<h2>Two</h2><p>Second</p>');
    expect(html(r.txt.outputs.document)).toBe('Intro <em>here</em>');
  });

  it('gives an empty document, with a warning, when nothing matches', async () => {
    const r = await run({
      nodes: [node('src', 'documentSource', { fileId: 'html' }), node('x', 'extractor', { mode: 'css', selector: 'table' })],
      edges: [edge('src', 'document', 'x', 'document')],
    });
    expect(html(r.x.outputs.document)).toBe('');
    expect(r.x.warnings).toEqual(['"table" matched nothing', 'Nothing matched, so nothing is kept']);
  });
});

describe('Combinator', () => {
  const base = [node('src', 'documentSource', { fileId: 'html' }), node('h2', 'selector', { mode: 'css', selector: 'h2' }), node('snip', 'snippet')];
  const baseEdges = [edge('src', 'document', 'h2', 'document'), edge('h2', 'selection', 'snip', 'selection')];

  it('merges two changed versions of one document into one with both changes', async () => {
    const r = await run({
      nodes: [...base, node('pt', 'selector', { mode: 'css', selector: 'h1', place: 'after' }), node('obj', 'object', { content: { kind: 'code', code: '<p>Added</p>', render: 'html' } }), node('c', 'combinator')],
      edges: [...baseEdges, edge('src', 'document', 'pt', 'document'), edge('pt', 'point', 'obj', 'point'), edge('snip', 'document', 'c', 'a'), edge('obj', 'document', 'c', 'b')],
    });
    const out = html(r.c.outputs.document);
    expect(out.match(/<h1>/g)).toHaveLength(1);
    expect(out).toContain('<h1>Title</h1><p>Added</p>');
    expect(out.match(/class="callout/g)).toHaveLength(2);
    expect(r.c.info.combined).toBe(2);
  });

  it('puts A then B when asked, or when they do not share a document', async () => {
    const appended = await run({
      nodes: [...base, node('o', 'documentSource', { fileId: 'other' }), node('c', 'combinator', { combine: 'append' })],
      edges: [...baseEdges, edge('snip', 'document', 'c', 'a'), edge('o', 'document', 'c', 'b')],
    });
    const out = html(appended.c.outputs.document);
    expect(out.indexOf('Title')).toBeLessThan(out.indexOf('Elsewhere'));
    expect(appended.c.info.combined).toBe('one after another');
    expect((appended.c.outputs.html as string).startsWith('<!doctype html>')).toBe(true);
  });

  it('joins two selections in the same document into one selection', async () => {
    const r = await run({
      nodes: [...base, node('h1', 'selector', { mode: 'css', selector: 'h1' }), node('c', 'combinator'), node('wrap', 'snippet')],
      edges: [...baseEdges, edge('src', 'document', 'h1', 'document'), edge('h1', 'selection', 'c', 'a'), edge('h2', 'selection', 'c', 'b'), edge('c', 'selection', 'wrap', 'selection')],
    });
    expect((r.c.outputs.selection as Selection).matches).toHaveLength(3);
    expect(html(r.c.outputs.document)).toBe('<h1>Title</h1><h2>One</h2><h2>Two</h2>');
    expect(html(r.wrap.outputs.document).match(/class="callout/g)).toHaveLength(3);
  });

  it('takes any kinds (HTML and a selection), and waits with nothing connected', async () => {
    const r = await run({
      nodes: [...base, node('out', 'output', { fullDocument: false }), node('c', 'combinator'), node('empty', 'combinator')],
      edges: [...baseEdges, edge('snip', 'document', 'out', 'document'), edge('out', 'html', 'c', 'a'), edge('h2', 'selection', 'c', 'b')],
    });
    expect(html(r.c.outputs.document)).toMatch(/callout[\s\S]*<h2>One<\/h2><h2>Two<\/h2>$/);
    expect(r.empty).toMatchObject({ status: 'waiting', message: 'Connect something to A and B' });
  });
});

describe('Snippet: custom and its own CSS / JavaScript', () => {
  it('a custom snippet puts a class on the selected content, or a wrapper with it', () => {
    expect(customSnippet({ className: 'my box!' })).toMatchObject({ mode: 'attributes', template: 'class="my-box"' });
    expect(customSnippet({ className: 'note', wrap: 'div' })).toMatchObject({ mode: 'wrap', template: '<div class="note">{{content}}</div>' });
  });

  it('adds the node’s CSS and JavaScript to the page once', async () => {
    const custom = { snippet: nodeRegistry.snippet.defaultConfig().snippet, custom: { className: 'shout' }, css: '.shout{color:red}', js: 'console.log(1)' };
    const r = await run({
      nodes: [
        node('src', 'documentSource', { fileId: 'html' }),
        node('h2', 'selector', { mode: 'css', selector: 'h2' }),
        node('snip', 'snippet', custom),
        node('again', 'snippet', { ...nodeRegistry.snippet.defaultConfig(), css: '.callout{border-radius:12px}' }),
        node('out', 'output'),
      ],
      edges: [
        edge('src', 'document', 'h2', 'document'),
        edge('h2', 'selection', 'snip', 'selection'),
        edge('snip', 'document', 'out', 'document'),
      ],
    });
    const page = r.out.outputs.html as string;
    expect(page).toContain('<h2 class="shout">One</h2>');
    expect(page.match(/\.shout\{color:red\}/g)).toHaveLength(1);
    expect(page).toContain('console.log(1)');
    expect(r.snip.info.applied).toBe(2);
  });
});

describe('a point through a Connector', () => {
  it('gives its document and, as a selection, the places it stands for', async () => {
    const r = await run({
      nodes: [node('src', 'documentSource', { fileId: 'html' }), node('pt', 'selector', { mode: 'css', selector: 'h2' }), node('con', 'connector')],
      edges: [edge('src', 'document', 'pt', 'document'), edge('pt', 'point', 'con', 'input')],
    });
    expect(r.con.info.from).toBe('point');
    expect(r.con.outputs.document).toBe(r.src.outputs.document);
    expect((r.con.outputs.selection as Selection).matches).toHaveLength(2);
  });
});
