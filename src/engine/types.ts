// Core data types shared by the engine, the node types and the UI.
// These are the values that travel along graph edges (port types).
import type { Root } from 'hast';

export type SourceFormat = 'html' | 'docx' | 'json';

/** A binary file (such as an image) that belongs to a document. Base64 keeps it JSON-serializable. */
export interface Asset {
  id: string;
  contentType: string;
  base64: string;
}

export interface DocumentMeta {
  origin: SourceFormat;
  fileName?: string;
  title?: string;
  /** CSS taken from the source (for example <style> blocks in an HTML file). */
  styles: string[];
  /** Problems found while importing (removed scripts, unknown Word styles, ...). */
  warnings: string[];
  /** Only for JSON sources: what is needed to write the transformed content back into the file. */
  json?: JsonSourceInfo;
}

export type JsonPathSegment = string | number;
export type JsonFieldFormat = 'text' | 'html' | 'markdown';

export interface JsonFieldMapping {
  /** JSONPath, may match many values, e.g. "$.articles[*].body". */
  path: string;
  format: JsonFieldFormat;
  /** Wrapper element for each matched value. Default "div". */
  blockTag?: string;
}

export interface JsonMapping {
  /** "fields": each matched string becomes a block. "template": a Handlebars template renders the whole file. */
  mode: 'fields' | 'template';
  fields?: JsonFieldMapping[];
  template?: string;
}

export interface JsonSourceInfo {
  /** A copy of the parsed file. */
  data: unknown;
  mapping: JsonMapping;
  /** Every block in the document, with the exact field it came from (field mode only). */
  fields: { path: string; segments: JsonPathSegment[]; format: JsonFieldFormat }[];
}

/**
 * The internal document. `tree` is a hast root holding the body content only.
 * Images that came from the source file are stored in `assets` and referenced as `asset:<id>`.
 */
export interface CmsDocument {
  kind: 'document';
  tree: Root;
  meta: DocumentMeta;
  assets: Record<string, Asset>;
}

/** Text Quote anchor (W3C Web Annotation style). */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

/** A pointer to part of a document, stored with several strategies so it survives edits (see M2). */
export interface Anchor {
  id: string;
  structural?: { path: number[] };
  css?: string;
  textQuote?: TextQuote;
  textPosition?: { start: number; end: number };
  semantic?: { headingText: string; scope: 'section' | 'block' };
  jsonPath?: { path: string; textQuote?: TextQuote };
}

export interface Selection {
  kind: 'selection';
  document: CmsDocument;
  anchors: Anchor[];
}

export type SnippetMode = 'wrap' | 'prepend' | 'append' | 'replace' | 'attributes';

export interface SnippetParam {
  name: string;
  label?: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  default?: string | number | boolean;
}

export interface Snippet {
  kind: 'snippet';
  id: string;
  name: string;
  version: number;
  mode: SnippetMode;
  template: string;
  params: SnippetParam[];
  css?: string;
  js?: string;
}
