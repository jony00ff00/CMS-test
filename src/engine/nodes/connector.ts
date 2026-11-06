import type { ElementContent } from 'hast';
import { parseHtml, serialize } from '../document';
import type { NodeDefinition } from '../graph';
import { copySelection } from '../insert';
import { runSelector } from '../selectors';
import type { CmsDocument, Selection } from '../types';

export interface ConnectorConfig {
  /** A selection as a document: a new document of what it selected (default), or the whole document it is in. */
  selectionToDocument?: 'content' | 'document';
  /** A document as a selection: all of it as one match (default), or each top-level block as a match. */
  documentToSelection?: 'document' | 'blocks';
  /** HTML out: a complete page with styles and snippet scripts (default), or only the body content. */
  fullPage?: boolean;
}

/** What came in, worked out from the value (the input takes every port type). */
export type ConnectorInputKind = 'document' | 'selection' | 'html';

export const connectorInputKind = (value: unknown): ConnectorInputKind =>
  typeof value === 'string' ? 'html' : (value as { kind?: string })?.kind === 'selection' ? 'selection' : 'document';

/**
 * Turns any value (a document, an Output's result, a selection or HTML) into every other kind, so nodes of any
 * type can follow. Documents are passed on as they are (snippet styles and scripts and JSON write-back information
 * are kept); HTML is read like an HTML file (scripts are removed).
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
    const value = inputs.input;
    const kind = connectorInputKind(value);
    const warnings: string[] = [];
    let doc: CmsDocument;
    let selection: Selection;
    let html: string | undefined;

    if (kind === 'selection') {
      selection = value as Selection;
      if ((config.selectionToDocument ?? 'content') === 'document') doc = selection.document;
      else {
        const copy = await copySelection(selection);
        warnings.push(...copy.warnings);
        const source = selection.document;
        doc = {
          kind: 'document',
          tree: { type: 'root', children: copy.nodes as ElementContent[] },
          // The copy is new content: it keeps the look (styles, snippet CSS / JS), not the JSON field mapping.
          meta: { ...source.meta, json: undefined, pptx: undefined, warnings: [], snippetAssets: copy.snippetAssets },
          assets: Object.fromEntries(copy.assets.map((a) => [a.id, a])),
        };
      }
    } else {
      if (kind === 'html') {
        html = value as string;
        doc = parseHtml(html);
        warnings.push(...doc.meta.warnings);
      } else doc = value as CmsDocument;
      selection = runSelector(doc, { mode: 'all', scope: config.documentToSelection === 'blocks' ? 'blocks' : 'document' });
      warnings.push(...selection.warnings);
    }
    // HTML that came in goes out as it was; anything else is written out.
    html ??= serialize(doc, { fullDocument: config.fullPage ?? true, inlineAssets: true });
    return {
      outputs: { document: doc, selection, html, result: doc },
      warnings,
      info: { from: kind, matches: selection.matches.length },
    };
  },
};
