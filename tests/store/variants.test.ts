import { describe, expect, it } from 'vitest';
import type { OutputConfig, SnippetNodeConfig } from '../../src/engine';
import { createEditorStore } from '../../src/store/editor-store';
import { parseProject, projectToJson } from '../../src/store/project';

/** The HTML example (documentSource-1 → selector-2 → snippet-3 → output-4) plus an Output "fancy" after the Snippet. */
const make = async () => {
  const store = createEditorStore({ evaluateDelay: 1, storage: null, undoGrouping: 1000 });
  const s = () => store.getState();
  s().loadExample('html');
  const out = s().addNode('output', { x: 900, y: 400 });
  s().updateConfig<OutputConfig>(out, (c) => ({ ...c, variant: 'fancy' }));
  s().connect({ source: 'snippet-3', sourcePort: 'document', target: out, targetPort: 'document' });
  await s().whenIdle();
  return { store, s, out };
};
const custom = (className: string) => (c: SnippetNodeConfig) => ({ ...c, ref: undefined, custom: { className, wrap: 'none' as const } });

describe('page variants in the editor', () => {
  it('edits settings for one page, and shows each page with its own', async () => {
    const { store, s, out } = await make();
    s().updateConfig('snippet-3', custom('plain'));
    s().select('snippet-3');
    s().setEditVariant('fancy');
    expect(s().variant).toBe('fancy');
    s().updateConfig('snippet-3', custom('fancy'));
    const node = s().graph.nodes.find((n) => n.id === 'snippet-3')!;
    expect((node.config as SnippetNodeConfig).custom?.className).toBe('plain');
    // Only what differs is stored for the variant.
    expect(Object.keys(node.variants!.fancy)).toEqual(['custom']);
    await s().whenIdle();
    expect(s().results[out].outputs.html).toContain('class="fancy"');
    expect(s().results['output-4'].outputs.html).toContain('class="plain"');
    expect(s().results['output-4'].outputs.html).not.toContain('class="fancy"');
    // Shown as the "fancy" page: the Snippet's result is that page's.
    expect(s().results['snippet-3']).toBe(s().variantResults.fancy['snippet-3']);
    s().setVariant(undefined);
    expect(s().results['snippet-3']).not.toBe(s().variantResults.fancy['snippet-3']);

    // Selecting an Output shows its page; a node with settings for it then edits them.
    s().select(out);
    expect(s().variant).toBe('fancy');
    s().select('selector-2');
    expect(s().editVariant).toBeUndefined(); // no settings of its own for "fancy"
    s().select('snippet-3');
    expect(s().editVariant).toBe('fancy');
    s().select('output-4');
    expect(s().variant).toBeUndefined();

    // Back to the same settings for all pages; undo brings them back.
    s().resetVariantSettings('snippet-3', 'fancy');
    expect(s().graph.nodes.find((n) => n.id === 'snippet-3')!.variants).toBeUndefined();
    store.temporal.getState().undo();
    expect(s().graph.nodes.find((n) => n.id === 'snippet-3')!.variants?.fancy).toBeDefined();
  });

  it('edits the node\'s own settings unless a page is picked, and only for pages after the node', async () => {
    const { s } = await make();
    s().select('snippet-3');
    s().updateConfig('snippet-3', custom('plain'));
    expect(s().graph.nodes.find((n) => n.id === 'snippet-3')!.variants).toBeUndefined();
    // "fancy" is not a page after the Output: its own settings change.
    s().select('output-4');
    s().setEditVariant('fancy');
    s().updateConfig<OutputConfig>('output-4', (c) => ({ ...c, fullDocument: false }));
    const o = s().graph.nodes.find((n) => n.id === 'output-4')!;
    expect((o.config as OutputConfig).fullDocument).toBe(false);
    expect(o.variants).toBeUndefined();
  });

  it('forgets a variant no Output makes any more', async () => {
    const { s, out } = await make();
    s().setVariant('fancy');
    s().removeElements([out], []);
    expect(s().variant).toBeUndefined();
  });

  it('keeps variant settings in project files and copies', async () => {
    const { s } = await make();
    s().select('snippet-3');
    s().setEditVariant('fancy');
    s().updateConfig('snippet-3', custom('fancy'));
    const { project, warnings } = parseProject(s().exportProject());
    expect(warnings).toEqual([]);
    expect(project.graph.nodes.find((n) => n.id === 'snippet-3')!.variants?.fancy).toBeDefined();
    const copy = s().duplicateNode('snippet-3')!;
    expect(s().graph.nodes.find((n) => n.id === copy)!.variants?.fancy).toEqual(s().graph.nodes.find((n) => n.id === 'snippet-3')!.variants?.fancy);
    // Broken variant settings are left out with a warning.
    const file = JSON.parse(projectToJson({ graph: s().graph, files: s().files, library: s().library }));
    file.graph.nodes.find((n: { id: string }) => n.id === 'selector-2').variants = { fancy: 'nope' };
    const read = parseProject(JSON.stringify(file));
    expect(read.project.graph.nodes.find((n) => n.id === 'selector-2')!.variants).toBeUndefined();
    expect(read.warnings.join()).toContain('page variant settings');
  });
});
