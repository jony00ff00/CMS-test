import type { ChangeEvent } from 'react';
import {
  blockName, cssWidth, IMAGE_EXTENSIONS, mediaType, VIDEO_EXTENSIONS, type GraphNode, type InsertContent, type InsertionPoint, type InsertKind,
  type InsertPlace, type ObjectNodeConfig, type ReplaceOptions, type Selection, type SelectorNodeConfig, type Width,
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
  { value: 'selection', label: 'Content from another node' },
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
      return (
        <>
          <ContentSource nodeId={node.id} />
          <CopyOptionsFields options={content} onChange={onChange} />
        </>
      );
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
          <details className="advanced node-code" open={!!(content.css?.trim() || content.js?.trim())}>
            <summary>CSS and JavaScript for this code</summary>
            <CodeField
              label="CSS"
              language="css"
              value={content.css ?? ''}
              hint="Added to the page once, e.g. to style the inserted HTML (give it a class and target that)."
              onChange={(css) => onChange({ css: css || undefined })}
            />
            <CodeField
              label="JavaScript"
              language="javascript"
              value={content.js ?? ''}
              hint="Runs once when the page has loaded (in the preview too, which is sandboxed). Script tags in the code itself are removed; put scripts here."
              onChange={(js) => onChange({ js: js || undefined })}
            />
          </details>
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

/** How copied content goes in (the Object's "Content from another node" and the Replace node). */
export function CopyOptionsFields({ options, onChange, placeWord = 'point' }: { options: ReplaceOptions; onChange: (patch: ReplaceOptions) => void; placeWord?: string }) {
  return (
    <>
      <SelectField
        label="Put it in"
        value={options.wrap ?? 'none'}
        options={[
          { value: 'none', label: 'Nothing: add it as it is' },
          { value: 'div', label: 'A box with a class (<div>)' },
          { value: 'section', label: 'A section labelled with where it came from' },
        ]}
        onChange={(wrap) => onChange({ wrap })}
      />
      {(options.wrap === 'div' || options.wrap === 'section') && (
        <TextField
          label="Class name"
          monospace
          value={options.className ?? ''}
          placeholder={options.wrap === 'div' ? 'inserted' : 'cms-from'}
          hint={options.wrap === 'section' ? 'Added next to cms-from, for your own CSS.' : 'For your own CSS (a snippet’s or the page’s).'}
          onChange={(className) => onChange({ className: className || undefined })}
        />
      )}
      <CheckboxField
        label="Bring the source’s styles"
        checked={options.styles !== false}
        hint="Its own CSS (e.g. <style> in an HTML file, the slide look of a .pptx) is added to this page once. It applies to the whole page, so it can change how the rest looks."
        onChange={(styles) => onChange({ styles: styles ? undefined : false })}
      />
      <SelectField
        label="Heading levels"
        value={options.headings ?? 'keep'}
        options={[
          { value: 'keep', label: 'Keep them as they are' },
          { value: 'fit', label: `Fit them under the heading before the ${placeWord}` },
        ]}
        hint={options.headings === 'fit' ? 'E.g. after an <h2>, the highest inserted heading becomes <h3> and the others move with it.' : undefined}
        onChange={(headings) => onChange({ headings: headings === 'fit' ? 'fit' : undefined })}
      />
    </>
  );
}

/** Where "Content from another node" comes from: whatever is connected to the Content input. */
export function ContentSource({ nodeId, owner = 'Object', original = 'The original stays where it is.' }: { nodeId: string; owner?: string; original?: string }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'content'));
  const source = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const what = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    const value = r?.status === 'ok' ? r.outputs[edge!.sourcePort] : undefined;
    if (value === undefined) return undefined;
    if ((value as Selection).kind === 'selection') {
      const n = (value as Selection).matches.length;
      return `${n} match${n === 1 ? '' : 'es'}`;
    }
    return typeof value === 'string' ? 'HTML' : (value as { kind?: string }).kind === 'point' ? 'the places of a point' : 'all of its document';
  });
  if (!source) {
    return (
      <p className="hint warn-text">
        Connect something to this {owner}'s <strong>Content</strong> input: an Extractor (all it keeps), a Selector's
        Selection (what it selects), or any document. It is copied in; it can come from this document or another one.
      </p>
    );
  }
  return (
    <p className="hint">
      A copy of what comes from <strong>{nodeLabel(source)}</strong>
      {what ? ` (${what})` : ''}, in document order, with its formatting and snippet styles. {original}
    </p>
  );
}
