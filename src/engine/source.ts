// One entry point for every source file type. The DocumentSource node (M4) calls this.
import { parseHtml } from './document';
import { importDocx, type DocxOptions } from './docx';
import { importDocxReview } from './docx-review';
import { importJson } from './json';
import { importPptx, type PptxOptions } from './pptx';
import type { CmsDocument, JsonMapping, SourceFormat } from './types';

export interface SourceFile {
  name: string;
  data: string | ArrayBuffer | Uint8Array;
}

export interface SourceOptions {
  /** Only used for .json files. Without it, every string field is imported as text. */
  json?: JsonMapping;
  /** Only used for .docx files. `review`: keep tracked changes, comments and direct formatting (docx-review.ts). */
  docx?: Omit<DocxOptions, 'fileName'> & { review?: boolean };
  /** Only used for .html files: `keepCode` keeps the page's scripts and styles (code you trust). */
  html?: { keepCode?: boolean };
  /** Only used for .pptx files. */
  pptx?: Omit<PptxOptions, 'fileName'>;
}

const EXTENSIONS: Record<string, SourceFormat> = {
  html: 'html', htm: 'html', xhtml: 'html', docx: 'docx', json: 'json', pptx: 'pptx',
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS).map((e) => `.${e}`);

export function detectFormat(fileName: string): SourceFormat | undefined {
  const ext = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1];
  return ext ? EXTENSIONS[ext] : undefined;
}

const decode = (data: SourceFile['data']) => (typeof data === 'string' ? data : new TextDecoder().decode(data));

/** Import any supported file. Throws with a readable message for unsupported or broken files. */
export async function importSource(file: SourceFile, options: SourceOptions = {}): Promise<CmsDocument> {
  const format = detectFormat(file.name);
  switch (format) {
    case 'html':
      return parseHtml(decode(file.data), { fileName: file.name, keepCode: options.html?.keepCode });
    case 'json':
      return await importJson(file.data, options.json, { fileName: file.name });
    case 'docx':
      if (typeof file.data === 'string') throw new Error(`${file.name}: a .docx file must be read as binary data`);
      if (options.docx?.review) return importDocxReview(file.data, { fileName: file.name });
      return importDocx(file.data, { ...options.docx, fileName: file.name });
    case 'pptx':
      if (typeof file.data === 'string') throw new Error(`${file.name}: a .pptx file must be read as binary data`);
      return importPptx(file.data, { ...options.pptx, fileName: file.name });
    default:
      throw new Error(`${file.name}: unsupported file type. Use one of ${ACCEPTED_EXTENSIONS.join(', ')}`);
  }
}
