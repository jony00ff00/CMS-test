/** Each node type's colour (the same as `--node-*` / `--port-*` in styles.css), for places CSS cannot reach. */
export const NODE_COLORS: Record<string, string> = {
  documentSource: '#2563eb',
  selector: '#d97706',
  snippet: '#7c3aed',
  extractor: '#4f46e5',
  object: '#0d9488',
  replace: '#be185d',
  position: '#0891b2',
  changes: '#16a34a',
  formatting: '#a16207',
  output: '#dc2626',
  connector: '#6b7280',
};
export const UNKNOWN_NODE_COLOR = '#cbd5e1';
