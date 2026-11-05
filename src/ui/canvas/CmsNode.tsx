import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { nodeRegistry, type GraphNode, type NodeResult, type SelectorConfig, type SnippetNodeConfig } from '../../engine';
import { useEditor } from '../../store/editor-store';

export type CmsFlowNode = Node<Record<string, never>, 'cms'>;

const STATUS_LABEL: Record<string, string> = { ok: 'OK', waiting: 'Waiting', error: 'Error', blocked: 'Blocked' };

function CmsNodeView({ id, selected }: NodeProps<CmsFlowNode>) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id));
  const result = useEditor((s) => s.results[id]);
  if (!node) return null;
  const def = nodeRegistry[node.type];
  const status = result?.status ?? 'waiting';
  const warnings = result?.warnings.length ?? 0;
  const rows = Math.max(def.inputs.length, def.outputs.length);

  return (
    <div className={`cms-node cms-node-${node.type} status-${status}${selected ? ' is-selected' : ''}`} data-testid={`node-${id}`}>
      <header>
        <span className="cms-node-title">{def.label}</span>
        <span className={`status-pill status-${status}`} title={result?.message}>
          {STATUS_LABEL[status]}
        </span>
      </header>
      <div className="cms-node-summary">{summarize(node, result)}</div>
      {result?.message && status !== 'ok' && <div className="cms-node-message">{result.message}</div>}
      {warnings > 0 && (
        <div className="cms-node-warnings">
          {warnings} warning{warnings === 1 ? '' : 's'}
        </div>
      )}
      <div className="cms-node-ports">
        {Array.from({ length: rows }, (_, i) => {
          const input = def.inputs[i];
          const output = def.outputs[i];
          return (
            <div className="cms-node-port-row" key={i}>
              <span className="port port-in">
                {input && (
                  <>
                    <Handle type="target" position={Position.Left} id={input.name} className={`handle-${input.type}`} />
                    {input.label}
                  </>
                )}
              </span>
              <span className="port port-out">
                {output && (
                  <>
                    {output.label}
                    <Handle type="source" position={Position.Right} id={output.name} className={`handle-${output.type}`} />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const CmsNode = memo(CmsNodeView);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;

function summarize(node: GraphNode, result: NodeResult | undefined): string {
  const info = result?.info ?? {};
  switch (node.type) {
    case 'documentSource':
      return info.file ? `${info.file}` : 'No file chosen';
    case 'selector': {
      const c = node.config as SelectorConfig;
      const what =
        c.mode === 'css' ? c.selector || '(empty)'
        : c.mode === 'regex' ? `/${c.pattern}/${c.flags ?? ''}`
        : c.mode === 'heading' ? `Section "${c.text}"`
        : c.mode === 'jsonField' ? c.path
        : `${c.anchors.length} saved selection${c.anchors.length === 1 ? '' : 's'}`;
      return typeof info.matches === 'number' ? `${what} · ${plural(info.matches, 'match')}` : what;
    }
    case 'snippet': {
      const c = node.config as SnippetNodeConfig;
      const applied = typeof info.applied === 'number' ? ` · applied ${info.applied}×` : '';
      return `${c.snippet.name} (${c.snippet.mode})${applied}`;
    }
    case 'output':
      return typeof info.bytes === 'number' ? `${(info.bytes / 1024).toFixed(1)} kB of HTML` : 'Nothing to show yet';
    default:
      return '';
  }
}
