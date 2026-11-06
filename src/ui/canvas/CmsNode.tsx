import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { describeInsertion, nodeRegistry, refStatus, type GraphNode, type InsertNodeConfig, type NodeResult, type SelectorConfig, type SnippetNodeConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';

export type CmsFlowNode = Node<Record<string, never>, 'cms'>;

const STATUS_LABEL: Record<string, string> = { ok: 'OK', waiting: 'Waiting', error: 'Error', blocked: 'Blocked' };

function CmsNodeView({ id, selected }: NodeProps<CmsFlowNode>) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id));
  const result = useEditor((s) => s.results[id]);
  const library = useEditor((s) => s.library);
  if (!node) return null;
  const libraryStatus = node.type === 'snippet' ? refStatus(library, (node.config as SnippetNodeConfig).ref) : undefined;
  const def = nodeRegistry[node.type];
  const status = result?.status ?? 'waiting';
  const warnings = result?.warnings.length ?? 0;
  const rows = Math.max(def.inputs.length, def.outputs.length);

  return (
    <div className={`cms-node cms-node-${node.type} status-${status}${selected ? ' is-selected' : ''}`} data-testid={`node-${id}`}>
      <header>
        <NodeTitle id={id} name={node.name} label={def.label} />
        <span className={`status-pill status-${status}`} title={result?.message}>
          {STATUS_LABEL[status]}
        </span>
      </header>
      <div className="cms-node-summary">{summarize(node, result)}</div>
      {libraryStatus?.outdated && <div className="update-pill node-badge">Update available: v{libraryStatus.latest!.version}</div>}
      {typeof result?.info.needsAttention === 'number' && (
        <div className="attention-pill node-badge">
          {result.info.needsAttention} selection{result.info.needsAttention === 1 ? ' needs' : 's need'} attention
        </div>
      )}
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

/** The node's name (or its type), with the type below a given name. Double-click to rename. */
function NodeTitle({ id, name, label }: { id: string; name?: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    const done = (save: boolean) => {
      if (save) editorStore.getState().renameNode(id, draft);
      setEditing(false);
    };
    return (
      <input
        className="node-name-input nodrag"
        aria-label={`Name of ${id}`}
        autoFocus
        value={draft}
        placeholder={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep Backspace from deleting the node
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
        }}
      />
    );
  }
  return (
    <span
      className="cms-node-title"
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(name ?? '');
        setEditing(true);
      }}
    >
      {name?.trim() || label}
      {name?.trim() && <span className="cms-node-type">{label}</span>}
    </span>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'es'}`;

function summarize(node: GraphNode, result: NodeResult | undefined): string {
  const info = result?.info ?? {};
  switch (node.type) {
    case 'documentSource':
      if (!info.file) return 'No file chosen';
      if (typeof info.slideCount !== 'number') return `${info.file}`;
      return `${info.file} · ${info.slides === info.slideCount ? '' : `${info.slides} of `}${info.slideCount} slide${info.slideCount === 1 ? '' : 's'}${info.hiddenSlides ? ` (${info.hiddenSlides} hidden)` : ''}`;
    case 'selector': {
      const c = node.config as SelectorConfig;
      const what =
        c.mode === 'css' ? c.selector || '(empty)'
        : c.mode === 'regex' ? `/${c.pattern}/${c.flags ?? ''}`
        : c.mode === 'heading' ? `Section "${c.text}"`
        : c.mode === 'jsonField' ? c.path
        : c.mode === 'all' ? (c.scope === 'blocks' ? 'Every block' : 'Everything')
        : `${c.anchors.length} saved selection${c.anchors.length === 1 ? '' : 's'}`;
      return typeof info.matches === 'number' ? `${what} · ${plural(info.matches, 'match')}` : what;
    }
    case 'snippet': {
      const c = node.config as SnippetNodeConfig;
      const applied = typeof info.applied === 'number' ? ` · applied ${info.applied}×` : '';
      const version = c.ref ? ` v${c.ref.version}` : ' (custom)';
      return `${c.snippet.name}${version}${applied}`;
    }
    case 'insert': {
      const c = node.config as InsertNodeConfig;
      const where = c.where.mode === 'selector' ? `${c.where.place} each match` : c.where.point ? 'at a picked point' : 'no point yet';
      return `${describeInsertion(c.content)} · ${where}`;
    }
    case 'output':
      if (info.format === 'json') return `JSON · ${info.changed} field${info.changed === 1 ? '' : 's'} changed`;
      if (typeof info.bytes !== 'number') return 'Nothing to show yet';
      const several = typeof info.combined === 'number' ? `${info.combined} combined · ` : typeof info.documents === 'number' ? `${info.documents} documents · ` : '';
      return `${several}${(info.bytes / 1024).toFixed(1)} kB of HTML`;
    case 'connector':
      return typeof info.blocks === 'number' ? `Result as a document · ${info.blocks} block${info.blocks === 1 ? '' : 's'}` : 'Connect an Output’s Result';
    default:
      return '';
  }
}
