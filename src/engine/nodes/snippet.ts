import { convertValue, valueKind } from '../convert';
import type { NodeDefinition } from '../graph';
import { hashString } from '../hash';
import { applySnippet } from '../snippets';
import type { Selection, Snippet, SnippetAsset } from '../types';

/** A custom snippet made from a class name: what the CSS and JavaScript of the node then target. */
export interface CustomSnippet {
  /** Given to the selected content (or to the wrapper around it). */
  className: string;
  /** "none" (default): the class goes on the selected elements (selected text gets a <span>). "div" / "span": a wrapper. */
  wrap?: 'none' | 'div' | 'span';
}

export interface SnippetNodeConfig {
  /** The node's own copy of the snippet, so a graph works on its own. */
  snippet: Snippet;
  /** Set when the snippet came from the library: which version the copy is. */
  ref?: { id: string; version: number };
  params?: Record<string, unknown>;
  snapToBlock?: boolean;
  /** Set for "Custom (only this node)": the snippet is made from this (see `customSnippet`), not `snippet`. */
  custom?: CustomSnippet;
  /** CSS and JavaScript for this node only, added to the page next to the snippet's own. */
  css?: string;
  js?: string;
  /** When a document (or HTML) comes in instead of a selection: apply to all of it (default) or to each top-level block. */
  documentScope?: 'document' | 'blocks';
}

/** Class names are kept to letters, digits, - and _, so they are safe in CSS and in the class attribute. */
export const cleanClassName = (name: string) => name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';

/** The snippet a custom node applies: a class on the selected content, or a wrapper with that class. */
export function customSnippet(custom: CustomSnippet): Snippet {
  const className = cleanClassName(custom.className);
  const wrap = custom.wrap ?? 'none';
  return {
    kind: 'snippet',
    id: `custom-${className}`,
    name: `Custom (.${className})`,
    version: 1,
    mode: wrap === 'none' ? 'attributes' : 'wrap',
    template: wrap === 'none' ? `class="${className}"` : `<${wrap} class="${className}">{{content}}</${wrap}>`,
    params: [],
  };
}

export const DEFAULT_SNIPPET: Snippet = {
  kind: 'snippet',
  id: 'callout',
  name: 'Callout',
  description: 'A coloured box around the content',
  version: 1,
  mode: 'wrap',
  template: '<aside class="callout callout-{{params.variant}}">{{content}}</aside>',
  params: [{ name: 'variant', label: 'Variant', type: 'select', options: ['info', 'warning', 'success'], default: 'info' }],
  css: '.callout{border-left:4px solid #3b82f6;background:#eff6ff;padding:.75rem 1rem;margin:1rem 0;border-radius:4px}' +
    '.callout-warning{border-color:#f59e0b;background:#fffbeb}.callout-success{border-color:#10b981;background:#ecfdf5}',
};

export const snippet: NodeDefinition<SnippetNodeConfig> = {
  type: 'snippet',
  label: 'Snippet',
  description: 'Wraps, adds to or replaces the selected content using a code snippet',
  // A selection, or a whole document (e.g. an Extractor's): see `documentScope`. HTML is read as a document.
  inputs: [{ name: 'selection', type: 'any', label: 'Selection or document' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ snippet: structuredClone(DEFAULT_SNIPPET), ref: { id: DEFAULT_SNIPPET.id, version: DEFAULT_SNIPPET.version } }),
  async evaluate(inputs, config) {
    const snippet = config.custom ? customSnippet(config.custom) : config.snippet;
    const kind = valueKind(inputs.selection);
    const selection: Selection =
      kind === 'selection'
        ? (inputs.selection as Selection)
        : (await convertValue(inputs.selection, { documentToSelection: config.documentScope === 'blocks' ? 'blocks' : 'document' })).selection;
    const result = await applySnippet(selection, snippet, {
      params: config.params,
      snapToBlock: config.snapToBlock,
    });
    const css = config.css?.trim();
    const js = config.js?.trim();
    if (css || js) {
      // Once per distinct CSS / JS, like a snippet version (two nodes with the same code add it once).
      const asset: SnippetAsset = { key: `node-${hashString(`${css ?? ''}\u0000${js ?? ''}`)}`, name: `${snippet.name} (this node)`, ...(css && { css }), ...(js && { js }) };
      const assets = result.document.meta.snippetAssets ?? [];
      if (!assets.some((a) => a.key === asset.key)) result.document.meta.snippetAssets = [...assets, asset];
    }
    return {
      outputs: { document: result.document },
      warnings: result.warnings,
      info: { applied: result.applied, ...(kind !== 'selection' && { input: kind === 'html' ? 'HTML' : kind === 'point' ? 'a point' : config.documentScope === 'blocks' ? 'each block' : 'whole document' }) },
    };
  },
};
