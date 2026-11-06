// Node type registry. Each node type lives in its own file in this folder and is registered here.
import type { NodeRegistry } from '../graph';
import { connector } from './connector';
import { documentSource } from './document-source';
import { insert } from './insert';
import { output } from './output';
import { selector } from './selector';
import { snippet } from './snippet';

export const nodeRegistry: NodeRegistry = {
  [documentSource.type]: documentSource,
  [selector.type]: selector,
  [snippet.type]: snippet,
  [insert.type]: insert,
  [output.type]: output,
  [connector.type]: connector,
};

export { connector, documentSource, insert, output, selector, snippet };
export type { ConnectorConfig } from './connector';
export type { InsertNodeConfig } from './insert';
export { DEFAULT_SNIPPET, type SnippetNodeConfig } from './snippet';
export type { DocumentSourceConfig } from './document-source';
export type { OutputConfig } from './output';
