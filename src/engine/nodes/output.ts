import { combineDocuments } from '../combine';
import { serialize } from '../document';
import type { NodeDefinition, NodeOutput } from '../graph';
import { exportJson } from '../json-export';
import { toSlideDeck } from '../slide-deck';
import type { CmsDocument } from '../types';

export interface OutputConfig {
  /**
   * Several connected documents: "merge" (default) applies every input's changes to one document (when they come
   * from the same source); "append" shows the documents one after another.
   */
  combine?: 'merge' | 'append';
  /**
   * "html" (default): a web page. "json": the JSON source file with the changed fields written back.
   * "slides": a page that shows one slide at a time (see slide-deck.ts); always a complete page.
   */
  format?: 'html' | 'json' | 'slides';
  /** A complete page with title, styles and snippet scripts (default), or just the body content. */
  fullDocument?: boolean;
  /** Put images into the HTML as data URIs (default true), so the page works on its own. */
  inlineAssets?: boolean;
  /** JSON only: add the snippets' CSS and JS under "$assets". */
  jsonAssets?: boolean;
}

export const output: NodeDefinition<OutputConfig> = {
  type: 'output',
  label: 'Output',
  description: 'Shows the result and exports it as HTML or JSON',
  // Several documents can come in (e.g. from an Insert and a Snippet): they are shown one after another.
  inputs: [{ name: 'document', type: 'document', label: 'Document', multiple: true }],
  outputs: [
    { name: 'html', type: 'html', label: 'HTML' },
    // The finished document, for a Connector node (which passes it on to more nodes).
    { name: 'result', type: 'result', label: 'Result' },
  ],
  defaultConfig: () => ({ format: 'html', fullDocument: true, inlineAssets: true }),
  mergesInputs: (config) => (config.combine ?? 'merge') === 'merge',
  async evaluate(inputs, config): Promise<NodeOutput> {
    const docs = inputs.document as CmsDocument[];
    const doc = combineDocuments(docs);
    if (config.format === 'slides') {
      const deck = toSlideDeck(doc);
      const html = serialize(deck.document, { fullDocument: true, inlineAssets: config.inlineAssets ?? true });
      return {
        outputs: { html, document: doc, result: doc },
        warnings: deck.warnings,
        info: { format: 'slides', slides: deck.slides, bytes: new TextEncoder().encode(html).length },
      };
    }
    // The page is always made: the preview shows it, also when exporting JSON.
    const html = serialize(doc, { fullDocument: config.fullDocument ?? true, inlineAssets: config.inlineAssets ?? true });
    if (config.format === 'json') {
      if (docs.length > 1) throw new Error('JSON export writes one JSON file, so connect only one document to this Output');
      const result = await exportJson(doc, { assets: config.jsonAssets });
      return {
        outputs: { html, json: result.json, document: doc, result: doc },
        warnings: result.warnings,
        info: { format: 'json', changed: result.changed.length, bytes: new TextEncoder().encode(result.json).length },
      };
    }
    const info: Record<string, number> = { bytes: new TextEncoder().encode(html).length };
    if (docs.length > 1) info.documents = docs.length;
    return { outputs: { html, document: doc, result: doc }, info };
  },
};
