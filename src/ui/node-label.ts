import type { GraphNode } from '../engine';

/** How a node is called in the UI: the name it was given, or its id. */
export const nodeLabel = (node: Pick<GraphNode, 'id' | 'name'> | undefined, fallback = ''): string =>
  node?.name?.trim() || node?.id || fallback;
