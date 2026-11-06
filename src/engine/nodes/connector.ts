import type { NodeDefinition } from '../graph';
import type { CmsDocument } from '../types';

/** Nothing to set: a Connector passes an Output's result on as a document. */
export type ConnectorConfig = Record<string, never>;

/**
 * Turns an Output's result back into a document, so a finished result can go through more nodes
 * (Selectors, Snippets, Inserts, another Output). The document is passed on as it is (not re-read from the
 * HTML), so snippet styles and scripts and JSON write-back information are kept.
 */
export const connector: NodeDefinition<ConnectorConfig> = {
  type: 'connector',
  label: 'Connector',
  description: "Uses an Output's result as a document for more nodes",
  inputs: [{ name: 'result', type: 'result', label: 'Result' }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs) {
    const doc = inputs.result as CmsDocument;
    return { outputs: { document: doc }, info: { blocks: doc.tree.children.length } };
  },
};
