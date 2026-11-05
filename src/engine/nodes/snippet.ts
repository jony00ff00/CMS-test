import type { NodeDefinition } from '../graph';
import { applySnippet } from '../snippets';
import type { Selection, Snippet } from '../types';

export interface SnippetNodeConfig {
  snippet: Snippet;
  params?: Record<string, unknown>;
  snapToBlock?: boolean;
}

export const DEFAULT_SNIPPET: Snippet = {
  kind: 'snippet',
  id: 'callout',
  name: 'Callout',
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
  inputs: [{ name: 'selection', type: 'selection', label: 'Selection' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ snippet: structuredClone(DEFAULT_SNIPPET) }),
  async evaluate(inputs, config) {
    const result = await applySnippet(inputs.selection as Selection, config.snippet, {
      params: config.params,
      snapToBlock: config.snapToBlock,
    });
    return { outputs: { document: result.document }, warnings: result.warnings, info: { applied: result.applied } };
  },
};
