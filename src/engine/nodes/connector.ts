import { convertValue, valueKind, type ConvertOptions, type ValueKind } from '../convert';
import type { NodeDefinition } from '../graph';

export type ConnectorConfig = ConvertOptions;
export type ConnectorInputKind = ValueKind;
export const connectorInputKind = valueKind;

/**
 * Turns any value (a document, an Output's result, a selection, a point or HTML) into every other kind, so nodes of
 * any type can follow. Documents are passed on as they are (snippet styles and scripts and JSON write-back
 * information are kept); HTML is read like an HTML file (scripts are removed); a point gives its document and the
 * places it stands for.
 */
export const connector: NodeDefinition<ConnectorConfig> = {
  type: 'connector',
  label: 'Connector',
  description: 'Turns any input into a document, a selection, HTML or a result',
  inputs: [{ name: 'input', type: 'any', label: 'Any' }],
  outputs: [
    { name: 'document', type: 'document', label: 'Document' },
    { name: 'selection', type: 'selection', label: 'Selection' },
    { name: 'html', type: 'html', label: 'HTML' },
    { name: 'result', type: 'result', label: 'Result' },
  ],
  defaultConfig: () => ({}),
  async evaluate(inputs, config) {
    const c = await convertValue(inputs.input, config);
    return {
      outputs: { document: c.document, selection: c.selection, html: c.html, result: c.document },
      warnings: c.warnings,
      info: { from: c.kind, matches: c.selection.matches.length },
    };
  },
};
