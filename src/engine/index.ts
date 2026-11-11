// Pure TypeScript engine: no React, no DOM APIs. See CLAUDE.md.
export * from './types';
export * from './document';
export * from './combine';
export * from './docx';
export * from './docx-review';
export * from './review';
export * from './changes';
export * from './formatting';
export * from './pptx';
export * from './slide-deck';
export * from './json';
export * from './json-export';
export * from './source';
export * from './text-match';
export * from './doc-index';
export * from './anchors';
export * from './selectors';
export * from './ranges';
export * from './snippets';
export * from './preview';
export * from './insert';
export * from './library';
export * from './hash';
export * from './graph';
export * from './merge';
export * from './convert';
export * from './nodes';
/**
 * Raised whenever the engine learns something a project can use that an older app does not know (a node option, a
 * template helper, …). Project files record it, so an older app (e.g. a browser tab opened before an update) warns
 * instead of quietly making a different page.
 */
export const ENGINE_VERSION = '0.6.0';
