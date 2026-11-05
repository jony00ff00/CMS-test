import type { NodeDefinition } from '../graph';
import { detectFormat, importSource, ACCEPTED_EXTENSIONS } from '../source';
import type { JsonMapping } from '../types';

export interface DocumentSourceConfig {
  /** Id of a file in the project's file store. */
  fileId?: string;
  /** For .json files. Without it, every string field is imported as text. */
  json?: JsonMapping;
  /** For .docx files: extra mammoth style-map rules. */
  docx?: { styleMap?: string[] };
}

export const documentSource: NodeDefinition<DocumentSourceConfig> = {
  type: 'documentSource',
  label: 'Document Source',
  description: `Loads a ${ACCEPTED_EXTENSIONS.filter((e) => e !== '.htm' && e !== '.xhtml').join(', ')} file`,
  inputs: [],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  dependencies: (config, ctx) => (config.fileId ? (ctx.files[config.fileId]?.hash ?? 'missing') : undefined),
  async evaluate(_inputs, config, ctx) {
    if (!config.fileId) return { outputs: {}, waiting: 'Choose a .html, .docx or .json file' };
    const file = ctx.files[config.fileId];
    if (!file) return { outputs: {}, waiting: 'The chosen file is no longer in the project; choose it again' };
    const doc = await importSource(file, { json: config.json, docx: config.docx });
    return {
      outputs: { document: doc },
      warnings: doc.meta.warnings,
      info: { file: file.name, format: detectFormat(file.name) ?? 'unknown', title: doc.meta.title ?? '' },
    };
  },
};
