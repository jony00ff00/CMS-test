// Core data types shared by the engine, the node types and the UI.
// These are the values that travel along graph edges (port types).
import type { Root } from 'hast';

export type SourceFormat = 'html' | 'docx' | 'json' | 'pptx';

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
  /** Only for .pptx sources: the deck's slides (also those left out). */
  pptx?: { slideCount: number; slides: PptxSlideInfo[] };
  /** CSS and JS of the snippets applied so far, once per snippet version (see snippets.ts). */
  snippetAssets?: SnippetAsset[];
}

export interface PptxSlideInfo {
  /** Position in the deck, from 1 (hidden slides count). */
  number: number;
  title?: string;
  hidden: boolean;
  /** In the document (not hidden, or hidden slides included, and in the chosen range). */
  included: boolean;
  /** The slide layout's name, e.g. "Title and Content". */
  layout?: string;
}

export interface SnippetAsset {
  /** `${id}@${version}` */
  key: string;
  name: string;
  css?: string;
  js?: string;
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

/** A run of sibling nodes: children `start` (inclusive) to `end` (exclusive) of the node at path `parent`. */
export interface NodeMatch {
  kind: 'nodes';
  parent: number[];
  start: number;
  end: number;
}

/** A range of the document's text index (see buildTextIndex). May cross element boundaries. */
export interface TextMatch {
  kind: 'text';
  start: number;
  end: number;
}

export type Match = NodeMatch | TextMatch;

/**
 * How an anchor was found again: `exact` (same place, same text), `moved` (same text elsewhere),
 * `fuzzy` (text changed a little), `failed` (not found with enough confidence: needs attention).
 */
export type ResolveStatus = 'exact' | 'moved' | 'fuzzy' | 'failed';

/**
 * A stored pointer to part of a document. It keeps several strategies so it can be found again
 * after the document changes (see anchors.ts).
 */
export interface Anchor {
  id: string;
  target: 'nodes' | 'text';
  /** Child-index position (fast, but breaks when content is inserted above). */
  structural?: { parent: number[]; start: number; end: number; tagName: string };
  /** CSS path to the first node. `depth` is set when the path does not start from an id. */
  css?: { selector: string; depth?: number };
  textQuote?: TextQuote;
  textPosition?: { start: number; end: number };
  /** Set when the anchor is a heading or a whole heading section. */
  semantic?: { headingText: string; level: number; scope: 'section' | 'block' };
  /** Set when the anchor is a JSON field block, or text inside one. */
  jsonPath?: { path: string };
  /** Set when the anchor is on a slide (from a .pptx): the slide's number and title when it was made. */
  slide?: { number: number; title?: string };
}

export interface SelectionMatch {
  match: Match;
  /** The matched text, as it appears in the text index. */
  text: string;
  /** For anchored (manual) selections. */
  anchorId?: string;
  status?: ResolveStatus;
  confidence?: number;
}

/** Output of a Selector node: a document and the parts of it that were picked. */
export interface Selection {
  kind: 'selection';
  document: CmsDocument;
  matches: SelectionMatch[];
  warnings: string[];
}

/**
 * wrap: put the selected content inside the template (at {{content}}).
 * prepend / append: insert the template before / after the selected content (or inside it, see `inside`).
 * replace: replace the selected content with the template ({{content}} brings the original back).
 * attributes: the template is an attribute list (e.g. `class="hl" title="{{text}}"`) added to the selected elements;
 * selected text is wrapped in a <span> that gets the attributes.
 */
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
  /** One line shown in the library. */
  description?: string;
  version: number;
  mode: SnippetMode;
  /** Handlebars template. See applySnippet for the variables it can use. */
  template: string;
  params: SnippetParam[];
  /** For prepend / append on elements: insert as the first / last child instead of before / after. */
  inside?: boolean;
  css?: string;
  js?: string;
}
