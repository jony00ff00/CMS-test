import { describe, expect, it } from 'vitest';
import {
  buildInsertion, GraphEvaluator, insertContent, nodeRegistry, parseHtml, serialize, storeFile,
  type CmsDocument, type GraphEdge, type GraphNode, type InsertWhere,
} from '../../src/engine';

const node = (id: string, type: string, config?: unknown): GraphNode => ({ id, type, config: config ?? nodeRegistry[type].defaultConfig() });
const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
const files = { doc: storeFile('doc.html', '<h1>Title</h1><p>Hello world</p><blockquote>Old</blockquote>', 'doc') };
const run = async (nodes: GraphNode[], edges: GraphEdge[] = []) => (await new GraphEvaluator(nodeRegistry).evaluate({ nodes, edges }, { files })).results;
const html = (d: unknown) => serialize(d as CmsDocument);

describe('Object: plain text', () => {
  it('paragraphs: a blank line starts a new one, a line break stays one, and nothing is read as HTML', () => {
    const built = buildInsertion({ kind: 'text', text: 'One <b>&amp;\nstill one\r\n\r\n  \nTwo' }, {});
    expect('nodes' in built && built.block).toBe(true);
    const doc = parseHtml('');
    doc.tree.children = ('nodes' in built ? built.nodes : []) as never;
    expect(serialize(doc)).toBe('<p>One &#x3C;b>&#x26;amp;<br>still one</p><p>Two</p>');
  });

  it('inline: goes in at the cursor, inside the paragraph', async () => {
    const where: InsertWhere = { mode: 'selector', selector: { mode: 'regex', pattern: 'Hello' }, place: 'after' };
    const r = await insertContent(parseHtml('<p>Hello world</p>'), where, { kind: 'text', text: ', dear', as: 'inline' }, {});
    expect(serialize(r.document)).toBe('<p>Hello, dear world</p>');
    expect(r.warnings).toEqual([]);
  });

  it('waits for text', () => {
    expect(buildInsertion({ kind: 'text', text: '  ' }, {})).toEqual({ waiting: 'Write the text to add' });
  });
});

describe('Object without a Point', () => {
  it('gives its content alone, as a document', async () => {
    const r = await run([node('obj', 'object', { content: { kind: 'text', text: 'Just this' } })]);
    expect(r.obj.status).toBe('ok');
    expect(html(r.obj.outputs.document)).toBe('<p>Just this</p>');
    expect(r.obj.info).toMatchObject({ alone: 1, what: 'Text paragraphs' });
  });

  it('code keeps its CSS; a linked image comes with the insert styles', async () => {
    const r = await run([
      node('code', 'object', { content: { kind: 'code', code: '<p class="x">Hi</p>', render: 'html', css: '.x{color:red}' } }),
      node('img', 'object', { content: { kind: 'imageUrl', url: 'https://example.com/a.png', alt: 'A' } }),
    ]);
    const code = r.code.outputs.document as CmsDocument;
    expect(serialize(code)).toBe('<p class="x">Hi</p>');
    expect(code.meta.snippetAssets?.map((a) => a.css).join()).toContain('.x{color:red}');
    expect(html(r.img.outputs.document)).toContain('<img src="https://example.com/a.png" alt="A"');
  });

  it('content from another node on its own; and it can feed a Replace node', async () => {
    const r = await run(
      [
        node('src', 'documentSource', { fileId: 'doc' }),
        node('sel', 'selector', { mode: 'css', selector: 'blockquote' }),
        node('obj', 'object', { content: { kind: 'text', text: 'New text' } }),
        node('rep', 'replace'),
      ],
      [edge('src', 'document', 'sel', 'document'), edge('sel', 'selection', 'rep', 'selection'), edge('obj', 'document', 'rep', 'content')],
    );
    expect(html(r.rep.outputs.document)).toBe('<h1>Title</h1><p>Hello world</p><p>New text</p>');

    const copy = await run(
      [node('src', 'documentSource', { fileId: 'doc' }), node('h1', 'selector', { mode: 'css', selector: 'h1' }), node('obj', 'object', { content: { kind: 'selection', wrap: 'div' } })],
      [edge('src', 'document', 'h1', 'document'), edge('h1', 'selection', 'obj', 'content')],
    );
    expect(html(copy.obj.outputs.document)).toBe('<div class="inserted"><h1>Title</h1></div>');
    expect(copy.obj.info.from).toBe('doc.html');
  });

  it('still waits until its content is complete', async () => {
    const r = await run([node('obj', 'object')]);
    expect(r.obj.status).toBe('waiting');
  });
});
