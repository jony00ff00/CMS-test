// Node type registry. Each node type lives in its own file in this folder and is registered here.
import type { NodeRegistry } from '../graph';
import { connector, connectorInputKind } from './connector';
import { documentSource } from './document-source';
import { extractor } from './extractor';
import { fillTemplateNode } from './fill-template';
import { object } from './object';
import { output } from './output';
import { selector } from './selector';
import { snippet } from './snippet';

export const nodeRegistry: NodeRegistry = {
  [documentSource.type]: documentSource,
  [selector.type]: selector,
  [snippet.type]: snippet,
  [extractor.type]: extractor,
  [object.type]: object,
  [fillTemplateNode.type]: fillTemplateNode,
  [output.type]: output,
  [connector.type]: connector,
};

export { connector, connectorInputKind, documentSource, extractor, fillTemplateNode, object, output, selector, snippet };
export type { ConnectorConfig, ConnectorInputKind } from './connector';
export type { InsertItem, ObjectNodeConfig, ObjectPlace } from './object';
export type { ExtractorConfig } from './extractor';
export type { FillTemplateNodeConfig } from './fill-template';
export type { SelectorNodeConfig } from './selector';
export { cleanClassName, cleanClassNames, customSnippet, DEFAULT_SNIPPET, type CustomSnippet, type SnippetNodeConfig } from './snippet';
export type { DocumentSourceConfig } from './document-source';
export type { OutputConfig } from './output';
