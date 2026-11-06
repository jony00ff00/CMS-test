import type { ChangeEvent } from 'react';
import {
  blockName, cssWidth, IMAGE_EXTENSIONS, mediaType, VIDEO_EXTENSIONS, type GraphNode, type InsertContent, type InsertionPoint, type InsertKind,
  type InsertPlace, type ObjectNodeConfig, type Selection, type SelectorNodeConfig, type Width,
} from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { nodeLabel } from '../node-label';
import { CheckboxField, CodeField, SelectField, TextField } from './fields';

const KINDS: { value: InsertKind; label: string }[] = [
  { value: 'code', label: 'Code' },
  { value: 'image', label: 'Image (upload a file)' },
  { value: 'video', label: 'Video (upload a file)' },
  { value: 'imageUrl', label: 'Linked image (from a web address)' },
  { value: 'videoUrl', label: 'Linked video (web address, YouTube or Vimeo)' },
  { value: 'selection', label: 'Selected content (from the Selection input)' },
];

const EMPTY: Record<InsertKind, InsertContent> = {
  code: { kind: 'code', code: '', language: 'html', render: 'block' },
  image: { kind: 'image', alt: '' },
  video: { kind: 'video' },
  imageUrl: { kind: 'imageUrl', url: '', alt: '' },
  videoUrl: { kind: 'videoUrl', url: '' },
  selection: { kind: 'selection' },
};

export const PLACES: { value: InsertPlace; label: string }[] = [
  { value: 'after', label: 'After it' },
  { value: 'before', label: 'Before it' },
  { value: 'end', label: 'Inside it, at the end' },
  { value: 'start', label: 'Inside it, at the start' },
];

export function ObjectEditor({ node }: { node: GraphNode }) {
  const config = node.config as ObjectNodeConfig;
  const { content } = config;
  const store = editorStore.getState();
  const update = (patch: Partial<ObjectNodeConfig>) => store.updateConfig<ObjectNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const edit = (patch: Partial<InsertContent>) => update({ content: { ...content, ...patch } as InsertContent });

  return (
    <>
      <SelectField
        label="Object"
        value={content.kind}
        options={KINDS}
        onChange={(kind) => update({ content: kind === content.kind ? content : { ...EMPTY[kind] } })}
      />
      <ContentFields node={node} content={content} onChange={edit} />
      <PointSource nodeId={node.id} />
    </>
  );
}

const EVERY_MATCH: Record<InsertPlace, string> = {
  after: 'after every match',
  before: 'before every match',
  start: 'inside every match, at the start',
  end: 'inside every match, at the end',
};

/** Where the Object goes: the Selector connected to its Point input. */
function PointSource({ nodeId }: { nodeId: string }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'point'));
  const from = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const store = editorStore.getState();
  if (!from) {
    return (
      <p className="hint warn-text">
        Connect a Selector's <strong>Point</strong> output to say where this goes: a point you click in the preview
        (Select by: “A point I click in the preview”), or next to every match.
      </p>
    );
  }
  const c = from.config as SelectorNodeConfig;
  const where = from.type !== 'selector'
    ? ''
    : c.mode === 'point'
      ? c.point ? 'at the point picked in the preview' : 'at a point not picked yet'
      : EVERY_MATCH[c.place ?? 'after'];
  return (
    <div className="field">
      <span className="field-label">Where</span>
      <p className="small">
        <button type="button" className="link" onClick={() => store.select(from.id)}>
          {nodeLabel(from)}
        </button>
        {where && ` · ${where}`}
      </p>
    </div>
  );
}

/** What a point picked in the preview is next to. */
export function PointSummary({ nodeId, point }: { nodeId: string; point?: InsertionPoint }) {
  const result = useEditor((s) => s.results[nodeId]);
  if (!point) {
    return <p className="hint">With this Selector selected, click in the preview where the point should be.</p>;
  }
  const quote = (point.anchor.textQuote?.exact ?? '').replace(/\n/g, ' ');
  // Text before the cursor: its end matters. A whole block: its start.
  const end = quote.length > 40 ? `…${quote.slice(-39)}` : quote;
  const start = quote.length > 40 ? `${quote.slice(0, 39)}…` : quote;
  const what =
    point.anchor.target === 'text'
      ? point.place === 'after' ? `Right after “${end}”` : `Right before “${start}”`
      : `${point.place === 'before' ? 'Before' : 'After'} the ${blockName(point.anchor.structural?.tagName ?? 'block')} “${start}”`;
  return (
    <div className="field">
      <p className="point-summary">
        {what}
        {result?.info.needsAttention ? <span className="attention-pill">needs attention</span> : null}
      </p>
      <p className="hint">Click somewhere else in the preview to move it.</p>
    </div>
  );
}

function ContentFields({ node, content, onChange }: { node: GraphNode; content: InsertContent; onChange: (patch: Partial<InsertContent>) => void }) {
  const file = useEditor((s) => ('fileId' in content && content.fileId ? s.files[content.fileId] : undefined));
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    const type = mediaType(chosen.name);
    const want = content.kind === 'image' ? 'image' : 'video';
    if (type?.kind !== want) {
      editorStore.getState().notify('error', `${chosen.name}: choose ${want === 'image' ? 'an image' : 'a video'} (${(want === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS).join(', ')})`);
      return;
    }
    editorStore.getState().chooseMediaFile(node.id, chosen.name, new Uint8Array(await chosen.arrayBuffer()));
  };
  const width = (w: Width | undefined, set: (w: string | undefined) => void) => {
    const parsed = cssWidth(w);
    return (
      <TextField
        label="Width"
        value={w === undefined ? '' : String(w)}
        placeholder="100%"
        hint={
          parsed.warning ?? (
            <>
              Any CSS unit: <code>320px</code>, <code>20em</code>, <code>2.5rem</code>, <code>50%</code>… A number alone is pixels; empty is 100%.
              {w !== undefined && w !== '' && <> Using <code>{parsed.value}</code>.</>}
            </>
          )
        }
        onChange={(v) => set(v.trim() ? v : undefined)}
      />
    );
  };

  switch (content.kind) {
    case 'selection':
      return <SelectionSource nodeId={node.id} />;
    case 'code':
      return (
        <>
          <SelectField
            label="Show it as"
            value={content.render}
            options={[
              { value: 'block', label: 'A code block (shown as text)' },
              { value: 'html', label: 'HTML, part of the page' },
            ]}
            hint={content.render === 'html' ? 'Scripts and event handlers are removed, as for any document.' : undefined}
            onChange={(render) => onChange({ render })}
          />
          {content.render === 'block' && (
            <SelectField
              label="Language"
              value={content.language ?? ''}
              options={['', 'html', 'css', 'javascript', 'json', 'shell', 'python', 'text'].map((l) => ({ value: l, label: l || 'None' }))}
              onChange={(language) => onChange({ language: language || undefined })}
            />
          )}
          <CodeField
            label="Code"
            language={content.render === 'html' || content.language === 'html' ? 'html' : content.language === 'css' ? 'css' : 'javascript'}
            value={content.code}
            onChange={(code) => onChange({ code })}
          />
        </>
      );
    case 'image':
    case 'video':
      return (
        <>
          <div className="field">
            <span className="field-label">{content.kind === 'image' ? 'Image file' : 'Video file'}</span>
            <div className="file-row">
              <label className="button">
                {file ? 'Choose another file…' : 'Choose a file…'}
                <input
                  type="file"
                  aria-label={content.kind === 'image' ? 'Image file' : 'Video file'}
                  className="visually-hidden"
                  accept={(content.kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS).join(',')}
                  onChange={pick}
                />
              </label>
              <span className={file ? 'file-name' : 'muted'}>{file ? file.name : 'No file yet'}</span>
            </div>
            <p className="hint">The file becomes part of the page and of the project file.</p>
          </div>
          {content.kind === 'image' ? (
            <>
              <TextField label="Alternative text" value={content.alt} placeholder="What the image shows" onChange={(alt) => onChange({ alt })} />
              <TextField label="Caption" value={content.caption ?? ''} onChange={(caption) => onChange({ caption: caption || undefined })} />
              {width(content.width, (w) => onChange({ width: w }))}
              <TextField label="Link to" value={content.href ?? ''} placeholder="https://… (optional)" onChange={(href) => onChange({ href: href || undefined })} />
            </>
          ) : (
            <>
              <TextField label="Caption" value={content.caption ?? ''} onChange={(caption) => onChange({ caption: caption || undefined })} />
              {width(content.width, (w) => onChange({ width: w }))}
              <CheckboxField label="Play automatically (muted)" checked={!!content.autoplay} onChange={(autoplay) => onChange({ autoplay })} />
              <CheckboxField label="Loop" checked={!!content.loop} onChange={(loop) => onChange({ loop })} />
              <CheckboxField label="Muted" checked={!!content.muted} onChange={(muted) => onChange({ muted })} />
            </>
          )}
        </>
      );
    case 'imageUrl':
      return (
        <>
          <TextField label="Image address" value={content.url} placeholder="https://example.com/picture.jpg" onChange={(url) => onChange({ url })} />
          <TextField label="Alternative text" value={content.alt} placeholder="What the image shows" onChange={(alt) => onChange({ alt })} />
          <TextField label="Caption" value={content.caption ?? ''} onChange={(caption) => onChange({ caption: caption || undefined })} />
          {width(content.width, (w) => onChange({ width: w }))}
          <TextField label="Link to" value={content.href ?? ''} placeholder="https://… (optional)" onChange={(href) => onChange({ href: href || undefined })} />
        </>
      );
    case 'videoUrl':
      return (
        <>
          <TextField
            label="Video address"
            value={content.url}
            placeholder="https://youtu.be/… or https://example.com/clip.mp4"
            hint="YouTube and Vimeo links are embedded; other addresses must point to a video file."
            onChange={(url) => onChange({ url })}
          />
          <TextField label="Caption" value={content.caption ?? ''} onChange={(caption) => onChange({ caption: caption || undefined })} />
          {width(content.width, (w) => onChange({ width: w }))}
        </>
      );
  }
}

/** Where the content for "Selected content" comes from. */
function SelectionSource({ nodeId }: { nodeId: string }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'selection'));
  const source = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const count = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    return r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as Selection | undefined)?.matches.length : undefined;
  });
  if (!source) {
    return (
      <p className="hint warn-text">
        Connect a Selector's Selection output to this Object's Selection input. What it selects is copied here; the
        Selector can look at this document or another one.
      </p>
    );
  }
  return (
    <p className="hint">
      A copy of what <strong>{nodeLabel(source)}</strong> selects
      {typeof count === 'number' ? ` (${count} match${count === 1 ? '' : 'es'})` : ''}, in document order, with its
      formatting and snippet styles. The original stays where it is.
    </p>
  );
}
