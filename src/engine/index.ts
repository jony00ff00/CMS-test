// Pure TypeScript engine: no React, no DOM APIs. See CLAUDE.md.
export * from './types';
export * from './document';
export * from './docx';
export * from './json';
export * from './source';
export { nodeRegistry } from './nodes';
export const ENGINE_VERSION = '0.2.0';
