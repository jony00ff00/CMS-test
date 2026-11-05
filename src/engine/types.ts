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
