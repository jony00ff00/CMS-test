// Import .docx files with mammoth: Word → semantic HTML → CmsDocument.
import type MammothModule from 'mammoth';
import { parseHtml } from './document';
import type { Asset, CmsDocument } from './types';

export interface DocxOptions {
  fileName?: string;
  /**
   * Extra mammoth style-map rules, e.g. "p[style-name='Quote'] => blockquote:fresh"
   * or "r[style-name='Highlight'] => mark". See https://github.com/mwilliamson/mammoth.js#writing-style-maps
   */
  styleMap?: string[];
}

/** Word styles everyone expects to be mapped, on top of mammoth's defaults. */
const DEFAULT_STYLE_MAP = [
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote.intense:fresh",
  "r[style-name='Strong'] => strong",
];

/** Convert a .docx file (as bytes) into a CmsDocument. Images become assets referenced as `asset:<id>`. */
export async function importDocx(data: ArrayBuffer | Uint8Array, options: DocxOptions = {}): Promise<CmsDocument> {
  // Loaded on demand: mammoth is large, and only .docx imports need it.
  const mammoth: typeof MammothModule = (await import('mammoth')).default;
  const arrayBuffer = toArrayBuffer(data);
  const assets: Record<string, Asset> = {};
  let imageCount = 0;

  const convertImage = mammoth.images.imgElement(async (image) => {
    const id = `img-${++imageCount}`;
    assets[id] = { id, contentType: image.contentType, base64: await image.readAsBase64String() };
    return { src: `asset:${id}` };
  });

  // Node's mammoth build reads `buffer`, the browser build reads `arrayBuffer`; JSZip accepts both.
  const input = { arrayBuffer, buffer: arrayBuffer } as unknown as { arrayBuffer: ArrayBuffer };
  let result: Awaited<ReturnType<typeof MammothModule.convertToHtml>>;
  try {
    result = await mammoth.convertToHtml(input, {
      // mammoth uses the first matching rule, so custom rules go first.
      styleMap: [...(options.styleMap ?? []), ...DEFAULT_STYLE_MAP],
      convertImage,
      // Never follow links to files outside the .docx package.
      externalFileAccess: false,
    });
  } catch (err) {
    throw new Error(`Could not read ${options.fileName ?? 'the .docx file'}: ${(err as Error).message}`);
  }

  const doc = parseHtml(result.value, { fileName: options.fileName, origin: 'docx' });
  doc.assets = assets;
  doc.meta.warnings.push(...result.messages.map((m) => m.message));
  return doc;
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
