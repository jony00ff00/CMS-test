import type { NodeDefinition } from '../graph';
import { detectFormat, importSource, ACCEPTED_EXTENSIONS } from '../source';
import type { JsonMapping } from '../types';

export interface DocumentSourceConfig {
  /** Id of a file in the project's file store. */
  fileId?: string;
  /** For .json files. Without it, every string field is imported as text. */
  json?: JsonMapping;
  /**
   * For .docx files: extra mammoth style-map rules, or `review`: keep tracked changes, comments and direct formatting
   * (read by docx-review.ts instead of mammoth; the style map is not used then).
   */
  docx?: { styleMap?: string[]; review?: boolean };
  /** For .html files: keep the page's own scripts and styles where they are (only for code you trust). */
  html?: { keepCode?: boolean };
  /** For .pptx files: notes, hidden slides, which slides. */
  pptx?: { includeNotes?: boolean; includeHidden?: boolean; slides?: string; slideStyles?: boolean };
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
    if (!config.fileId) return { outputs: {}, waiting: 'Choose a .html, .docx, .pptx or .json file' };
    const file = ctx.files[config.fileId];
    if (!file) return { outputs: {}, waiting: 'The chosen file is no longer in the project; choose it again' };
    const doc = await importSource(file, { json: config.json, docx: config.docx, pptx: config.pptx, html: config.html });
    return {
      outputs: { document: doc },
      warnings: doc.meta.warnings,
      info: {
        file: file.name,
        format: detectFormat(file.name) ?? 'unknown',
        title: doc.meta.title ?? '',
        ...(doc.meta.review && {
          changes: Object.values(doc.meta.review.revisions).filter((r) => !r.hidden).length,
          comments: Object.keys(doc.meta.review.comments).length,
        }),
        ...(doc.meta.pptx && {
          slides: doc.meta.pptx.slides.filter((s) => s.included).length,
          slideCount: doc.meta.pptx.slideCount,
          hiddenSlides: doc.meta.pptx.slides.filter((s) => s.hidden).length,
        }),
      },
    };
  },
};
