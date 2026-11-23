import { convertValue } from '../convert';
import { fillTemplate, type FillTemplateOptions } from '../fill-template';
import type { NodeDefinition, NodeOutput } from '../graph';
import type { CmsDocument } from '../types';

export type FillTemplateNodeConfig = FillTemplateOptions;

/**
 * Fills a template (a page's code) with content (e.g. from Word), slot by slot: each row names a slot in the
 * template and where its content comes from. Repeat rows make one copy of a template element per item of the content.
 */
export const fillTemplateNode: NodeDefinition<FillTemplateNodeConfig> = {
  type: 'fillTemplate',
  label: 'Fill template',
  description: 'Fills the slots of a template (e.g. a page’s code) with content from another document, repeating parts per item',
  inputs: [
    { name: 'template', type: 'document', label: 'Template' },
    { name: 'content', type: 'any', label: 'Content' },
  ],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({ rows: [] }),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const template = inputs.template as CmsDocument;
    // A selection means what it picked; HTML is read as a document.
    const content = await convertValue(inputs.content, { selectionToDocument: 'content' });
    const rows = config.rows ?? [];
    if (!rows.length) return { outputs: {}, waiting: 'Add a row: a slot in the template and where its content comes from' };
    const r = await fillTemplate(template, content.document, { ...config, rows });
    const filled = r.report.filter((x) => x.filled > 0).length;
    return {
      outputs: { document: r.document, report: r.report },
      warnings: [...content.warnings, ...r.warnings],
      problems: r.problems,
      info: { rows: rows.length, filled, ...(content.document.meta.fileName && { from: content.document.meta.fileName }) },
    };
  },
};
