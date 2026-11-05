import { serialize } from '../document';
import type { NodeDefinition } from '../graph';
import type { CmsDocument } from '../types';

export interface OutputConfig {
  /** A complete page with title, styles and snippet scripts (default), or just the body content. */
  fullDocument?: boolean;
  /** Put images into the HTML as data URIs (default true), so the page works on its own. */
  inlineAssets?: boolean;
}

export const output: NodeDefinition<OutputConfig> = {
  type: 'output',
  label: 'Output',
  description: 'Shows the result and exports it as HTML',
  inputs: [{ name: 'document', type: 'document', label: 'Document' }],
  outputs: [{ name: 'html', type: 'html', label: 'HTML' }],
  defaultConfig: () => ({ fullDocument: true, inlineAssets: true }),
  async evaluate(inputs, config) {
    const doc = inputs.document as CmsDocument;
    const html = serialize(doc, { fullDocument: config.fullDocument ?? true, inlineAssets: config.inlineAssets ?? true });
    return { outputs: { html, document: doc }, info: { bytes: new TextEncoder().encode(html).length } };
  },
};
