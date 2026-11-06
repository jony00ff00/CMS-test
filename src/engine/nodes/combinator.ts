import { combineDocuments } from '../combine';
import { convertValue, documentFromSelection, selectEverything, valueKind, type ConvertOptions } from '../convert';
import { serialize } from '../document';
import type { NodeDefinition, NodeOutput } from '../graph';
import type { Selection } from '../types';

export interface CombinatorConfig extends ConvertOptions {
  /**
   * "merge" (default): when A and B are changed versions of the same document, one document with both changes
   * (otherwise one after the other); two selections in the same document become one selection.
   * "append": A, then B.
   */
  combine?: 'merge' | 'append';
}

/** Combines what comes into A and B (any kinds) and gives the result as every kind. */
export const combinator: NodeDefinition<CombinatorConfig> = {
  type: 'combinator',
  label: 'Combinator',
  description: 'Combines two inputs of any kind into one document, selection, HTML or result',
  inputs: [
    { name: 'a', type: 'any', label: 'A', optional: true },
    { name: 'b', type: 'any', label: 'B', optional: true },
  ],
  outputs: [
    { name: 'document', type: 'document', label: 'Document' },
    { name: 'selection', type: 'selection', label: 'Selection' },
    { name: 'html', type: 'html', label: 'HTML' },
    { name: 'result', type: 'result', label: 'Result' },
  ],
  defaultConfig: () => ({ combine: 'merge' }),
  // Two changed versions of one document: the evaluator runs B's nodes on A's result (see merge.ts) and passes
  // the merged document into A alone.
  mergePorts: (config) => ((config.combine ?? 'merge') === 'merge' ? ['a', 'b'] : undefined),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const values = [inputs.a, inputs.b].filter((v) => v !== undefined);
    if (values.length === 0) return { outputs: {}, waiting: 'Connect something to A and B' };
    const parts = await Promise.all(values.map((v) => convertValue(v, config)));
    const warnings = parts.flatMap((p) => p.warnings);
    if (parts.length === 1) {
      const [p] = parts;
      return {
        outputs: { document: p.document, selection: p.selection, html: p.html, result: p.document },
        warnings,
        // One input (or A and B merged into one by the evaluator: info.combined is set then).
        info: { kinds: p.kind },
      };
    }
    const [a, b] = parts;
    // Two selections (or points) in the same document: one selection with the matches of both.
    const pickable = (k: string) => k === 'selection' || k === 'point';
    if ((config.combine ?? 'merge') === 'merge' && pickable(a.kind) && pickable(b.kind) && a.selection.document === b.selection.document) {
      const selection: Selection = {
        kind: 'selection',
        document: a.selection.document,
        matches: [...a.selection.matches, ...b.selection.matches],
        warnings: [],
      };
      const content = (config.selectionToDocument ?? 'content') === 'document' ? { document: selection.document, warnings: [] } : await documentFromSelection(selection);
      return {
        outputs: {
          document: content.document,
          selection,
          html: serialize(content.document, { fullDocument: config.fullPage ?? true, inlineAssets: true }),
          result: content.document,
        },
        warnings: [...warnings, ...content.warnings],
        info: { combined: 'selections', matches: selection.matches.length },
      };
    }
    const document = combineDocuments([a.document, b.document]);
    const selection = selectEverything(document, config);
    return {
      outputs: { document, selection, html: serialize(document, { fullDocument: config.fullPage ?? true, inlineAssets: true }), result: document },
      warnings,
      info: { combined: 'one after another', kinds: `${valueKind(values[0])} + ${valueKind(values[1])}` },
    };
  },
};
