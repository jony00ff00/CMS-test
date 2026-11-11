import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { cleanClassNames, describeInsertion, nodeRegistry, refStatus, type GraphNode, type NodeResult, type ObjectNodeConfig, type ReplaceNodeConfig, type PositionNodeConfig, type SelectorConfig, type SelectorNodeConfig, type SnippetNodeConfig } from '../../engine';
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

const SLIDE_PART_LABELS = { slide: 'Slides', title: 'Slide titles', content: 'Slide content', notes: 'Speaker notes' } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(s|x|ch|sh)$/.test(word) ? 'es' : 's'}`;

function describeSelector(c: SelectorConfig): string {
  return c.mode === 'css' ? c.selector || '(empty)'
    : c.mode === 'regex' ? `/${c.pattern}/${c.flags ?? ''}`
    : c.mode === 'heading' ? `Section "${c.text}"`
    : c.mode === 'jsonField' ? c.path
    : c.mode === 'all' ? (c.scope === 'blocks' ? 'Every block' : 'Everything')
    : c.mode === 'slide' ? `${SLIDE_PART_LABELS[c.part ?? 'slide']} · ${c.slides?.trim() ? `slides ${c.slides.trim()}` : 'all slides'}${c.title?.trim() ? ` titled “${c.title.trim()}”` : ''}`
    : c.mode === 'point' ? 'A point'
    : c.mode === 'image' ? `${c.images?.trim() ? `Images ${c.images.trim()}` : 'Images'}${c.text?.trim() ? ` with “${c.text.trim()}”` : ''}${c.scope === 'frame' ? ' + figure' : ''}`
    : `${c.anchors.length} saved selection${c.anchors.length === 1 ? '' : 's'}`;
}

function summarize(node: GraphNode, result: NodeResult | undefined): string {
  const info = result?.info ?? {};
  switch (node.type) {
    case 'documentSource':
      if (!info.file) return 'No file chosen';
      if (typeof info.changes === 'number') return `${info.file} · ${plural(info.changes as number, 'change')}, ${plural(info.comments as number, 'comment')}`;
      if (typeof info.slideCount !== 'number') return `${info.file}`;
      return `${info.file} · ${info.slides === info.slideCount ? '' : `${info.slides} of `}${info.slideCount} slide${info.slideCount === 1 ? '' : 's'}${info.hiddenSlides ? ` (${info.hiddenSlides} hidden)` : ''}`;
    case 'selector':
    case 'extractor': {
      const c = node.config as SelectorNodeConfig;
      if (c.mode === 'point') return c.point ? `A point${info.needsAttention ? ' (needs attention)' : ''}` : 'Click in the preview to pick the point';
      const kept = node.type === 'extractor' && typeof info.matches === 'number' ? ' · the rest removed' : '';
      return `${describeSelector(c)}${c.join ? ' joined' : ''}${typeof info.matches === 'number' ? ` · ${plural(info.matches, 'match')}` : ''}${kept}`;
    }
    case 'snippet': {
      const c = node.config as SnippetNodeConfig;
      const applied = typeof info.applied === 'number' ? ` · applied ${info.applied}×` : '';
      const name = c.custom ? `Custom ${cleanClassNames(c.custom.className).map((x) => `.${x}`).join('')}` : `${c.snippet.name}${c.ref ? ` v${c.ref.version}` : ' (custom)'}`;
      const extra = c.css?.trim() || c.js?.trim() ? ' + own CSS/JS' : '';
      return `${name}${extra}${applied}`;
    }
    case 'object': {
      const c = node.config as ObjectNodeConfig;
      const added = info.alone ? ' · on its own' : typeof info.inserted === 'number' ? ` · added ${info.inserted}×` : '';
      return `${describeInsertion(c.content)}${added}`;
    }
    case 'position': {
      const c = node.config as PositionNodeConfig;
      if (!c.point) return 'Click in the preview to pick the point';
      if (info.needsAttention) return 'The point needs attention';
      return typeof info.inserted === 'number' ? `At a point${info.from ? ` · from ${info.from}` : ''} · added ${info.inserted}×` : 'At a point';
    }
    case 'changes': {
      if (typeof info.kept !== 'number') return 'Connect a Word file read in review mode';
      const parts = [`${info.kept} kept`, info.accepted ? `${info.accepted} accepted` : '', info.rejected ? `${info.rejected} rejected` : ''].filter(Boolean);
      return `${parts.join(' · ')} · ${plural(info.threadsKept as number, 'comment thread')}`;
    }
    case 'replace': {
      const c = node.config as ReplaceNodeConfig;
      if (typeof info.replaced !== 'number') return 'Connect a selection (and content)';
      if (info.removed) return `No content: removed ${info.replaced}×${c.target === 'inside' ? ' · inside' : ''}`;
      const wrap = `${c.wrap === 'div' ? ' in a box' : c.wrap === 'section' ? ' in a section' : ''}${c.pairs ? ' · match by match' : ''}${c.target === 'inside' ? ' · inside' : ''}`;
      return `${info.from ? `From ${info.from}` : 'Content'}${wrap} · replaced ${info.replaced}×`;
    }
    case 'output':
      if (info.format === 'json') return `JSON · ${info.changed} field${info.changed === 1 ? '' : 's'} changed`;
      if (info.format === 'slides') return `Slide deck · ${info.slides} slide${info.slides === 1 ? '' : 's'}`;
      if (typeof info.bytes !== 'number') return 'Nothing to show yet';
      return `${typeof info.combined === 'number' ? `${info.combined} combined · ` : typeof info.documents === 'number' ? `${info.documents} documents · ` : ''}${(info.bytes / 1024).toFixed(1)} kB of HTML`;
    case 'connector':
      return typeof info.from === 'string' ? `From ${info.from === 'html' ? 'HTML' : `a ${info.from}`} · any kind out` : 'Connect anything';
    default:
      return '';
  }
}
