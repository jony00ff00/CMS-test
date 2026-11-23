import type { ChangeEvent } from 'react';
import type React from 'react';
import {
  blockName, cssWidth, describeInsertion, IMAGE_EXTENSIONS, mediaType, valueKind, VIDEO_EXTENSIONS, type GraphNode, type InsertContent, type InsertionPoint,
  type InsertItem, type InsertKind, type InsertPlace, type ObjectNodeConfig, type ObjectPlace, type ReplaceOptions, type Selection, type SelectorNodeConfig, type Width,
} from '../../engine';
import { editorStore, useEditor, type EditorState } from '../../store/editor-store';
import { SourceFields } from './FillTemplateEditor';
import { nodeLabel } from '../node-label';
import { CheckboxField, CodeField, SelectField, TextAreaField, TextField } from './fields';

const KINDS: { value: InsertKind; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'code', label: 'Code' },
  { value: 'image', label: 'Image (upload a file)' },
  { value: 'video', label: 'Video (upload a file)' },
  { value: 'imageUrl', label: 'Linked image (from a web address)' },
  { value: 'videoUrl', label: 'Linked video (web address, YouTube or Vimeo)' },
  { value: 'selection', label: 'Content from another node' },
];

const EMPTY: Record<InsertKind, InsertContent> = {
  text: { kind: 'text', text: '' },
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

/** What comes into an Insert node's Where input: nothing, a Point, a Selection or a document (or HTML). */
export type WhereKind = 'none' | 'point' | 'selection' | 'document' | 'html';

export function whereKindOf(s: EditorState, nodeId: string): WhereKind | undefined {
  const edge = s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'where');
  if (!edge) return 'none';
  const r = s.results[edge.source];
  const value = r?.status === 'ok' ? r.outputs[edge.sourcePort] : undefined;
  if (value !== undefined) return valueKind(value);
  // Not run yet: guess from the port.
  return edge.sourcePort === 'point' ? 'point' : edge.sourcePort === 'selection' ? 'selection' : undefined;
}

const PUT_FOR_POINT: { value: ObjectPlace | ''; label: string }[] = [
  { value: '', label: 'Where the Point says' },
  { value: 'before', label: 'Before each place' },
  { value: 'after', label: 'After each place' },
  { value: 'start', label: 'Inside each, at the start' },
  { value: 'end', label: 'Inside each, at the end' },
  { value: 'replace', label: 'Instead of what its Selector matched' },
  { value: 'inside', label: 'Instead of what is inside each match' },
];
const PUT_FOR_SELECTION: { value: ObjectPlace | ''; label: string }[] = [
  { value: '', label: 'Instead of each match (replace it)' },
  { value: 'inside', label: 'Instead of what is inside each match' },
  { value: 'before', label: 'Before each match' },
  { value: 'after', label: 'After each match' },
  { value: 'start', label: 'Inside each match, at the start' },
  { value: 'end', label: 'Inside each match, at the end' },
];

/** The Insert node (type "object"): where (its Where input), how (Put it) and what (content, or several items). */
export function ObjectEditor({ node }: { node: GraphNode }) {
  const config = node.config as ObjectNodeConfig;
  const { content } = config;
  const kind = useEditor((s) => whereKindOf(s, node.id));
  const hasContent = useEditor((s) => s.graph.edges.some((e) => e.target === node.id && e.targetPort === 'content'));
  const store = editorStore.getState();
  const update = (patch: Partial<ObjectNodeConfig>) => store.updateConfig<ObjectNodeConfig>(node.id, (c) => ({ ...c, ...patch }));
  const edit = (patch: Partial<InsertContent>) => update({ content: { ...content, ...patch } as InsertContent });
  const several = !!config.items;
  const putOptions = kind === 'point' ? PUT_FOR_POINT : kind === 'selection' ? PUT_FOR_SELECTION : undefined;
  const place = config.place ?? (kind === 'selection' ? 'replace' : undefined);
  const replacing = (place === 'replace' || place === 'inside') && (kind === 'selection' || kind === 'point');

  return (
    <>
      <WhereSource nodeId={node.id} kind={kind} point={config.point} onClearPoint={() => update({ point: undefined })} />
      {kind !== 'none' && (
        <div className="field" role="radiogroup" aria-label="What it adds">
          <span className="field-label">What it adds</span>
          <label className="fill-check">
            <input type="radio" name={`${node.id}-several`} checked={!several} onChange={() => update({ items: undefined })} />
            One thing{putOptions ? ', where it says below' : ''}
          </label>
          <label className="fill-check">
            <input type="radio" name={`${node.id}-several`} checked={several} onChange={() => update({ items: config.items ?? [newItem([])] })} />
            Several items, each at its own place
          </label>
        </div>
      )}
      {several && kind !== 'none' ? (
        <ItemsEditor node={node} items={config.items!} onChange={(items) => update({ items })} />
      ) : (
        <>
          {putOptions && (
            <SelectField
              label="Put it"
              value={(config.place === 'replace' && kind === 'selection' ? '' : (config.place ?? '')) as ObjectPlace | ''}
              options={putOptions}
              onChange={(v) => update({ place: v === '' ? undefined : (v as ObjectPlace) })}
            />
          )}
          <SelectField
            label="Content"
            value={content.kind}
            options={KINDS}
            onChange={(k) => update({ content: k === content.kind ? content : { ...EMPTY[k] } })}
          />
          <ContentFields
            node={node}
            content={content}
            onChange={edit}
            none={
              replacing
                ? <>Nothing is connected to <strong>Content</strong>, so what is matched is {place === 'inside' ? 'emptied' : 'removed'}. Connect an Extractor, a Selector's Selection or any document to put something in its place.</>
                : undefined
            }
          />
          {replacing && content.kind === 'selection' && hasContent && (
            <CheckboxField
              label="Match by match"
              checked={!!config.pairs}
              hint="The 1st match gets the 1st part of the content (the 1st match of a selection, or the 1st block of a document), the 2nd the 2nd, and so on. Off: every match gets all of it."
              onChange={(pairs) => update({ pairs: pairs || undefined })}
            />
          )}
        </>
      )}
    </>
  );
}

let itemCounter = 0;
function newItem(items: InsertItem[]): InsertItem {
  let id: string;
  do id = `item-${++itemCounter}`;
  while (items.some((i) => i.id === id));
  return { id, selector: { mode: 'css', selector: '' }, place: 'after', content: { kind: 'image', alt: '' } };
}

/** Several items, each with its own place (a selector in the document at Where) and its own content. */
function ItemsEditor({ node, items, onChange }: { node: GraphNode; items: InsertItem[]; onChange: (items: InsertItem[]) => void }) {
  const set = (id: string, patch: Partial<InsertItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const out = [...items];
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };
  return (
    <div className="field">
      <ol className="fill-rows" aria-label="Items">
        {items.map((item, i) => (
          <li key={item.id}>
            <div className="fill-row-head">
              <span className="field-label">
                {i + 1}. {item.label || describeInsertion(item.content)}
              </span>
              <span className="fill-row-actions">
                <button type="button" className="ghost small-button" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="ghost small-button" aria-label={`Move item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="ghost small-button danger" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(items.filter((x) => x.id !== item.id))}>
                  ×
                </button>
              </span>
            </div>
            <div className="fill-row">
              <label className="fill-inline">
                <span>Name</span>
                <input type="text" value={item.label ?? ''} placeholder="e.g. Picture: hives" onChange={(e) => set(item.id, { label: e.target.value || undefined })} />
              </label>
              <SourceFields label="Where" value={item.selector} onChange={(selector) => set(item.id, { selector })} />
              <label className="fill-inline">
                <span>Put it</span>
                <select value={item.place} onChange={(e) => set(item.id, { place: e.target.value as InsertPlace })}>
                  {PLACES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fill-inline">
                <span>Content</span>
                <select
                  value={item.content.kind}
                  onChange={(e) => {
                    const k = e.target.value as InsertKind;
                    if (k !== item.content.kind && k !== 'selection') set(item.id, { content: { ...EMPTY[k] } as InsertItem['content'] });
                  }}
                >
                  {KINDS.filter((k) => k.value !== 'selection').map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <ContentFields
                node={node}
                content={item.content}
                onChange={(patch) => set(item.id, { content: { ...item.content, ...patch } as InsertItem['content'] })}
                onFile={(name, data) => editorStore.getState().chooseItemMediaFile(node.id, item.id, name, data)}
              />
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...items, newItem(items)])}>
        Add an item
      </button>
      <p className="hint">Each item goes next to every match of its own selector in the document at Where. A place that is not found is a problem.</p>
    </div>
  );
}

const EVERY_MATCH: Record<InsertPlace, string> = {
  after: 'after every match',
  before: 'before every match',
  start: 'inside every match, at the start',
  end: 'inside every match, at the end',
};

/** What is connected to Where, in words. */
function WhereSource({ nodeId, kind, point, onClearPoint }: { nodeId: string; kind?: WhereKind; point?: InsertionPoint; onClearPoint: () => void }) {
  const edge = useEditor((s) => s.graph.edges.find((e) => e.target === nodeId && e.targetPort === 'where'));
  const from = useEditor((s) => (edge ? s.graph.nodes.find((n) => n.id === edge.source) : undefined));
  const count = useEditor((s) => {
    const r = edge ? s.results[edge.source] : undefined;
    const value = r?.status === 'ok' ? (r.outputs[edge!.sourcePort] as Selection | undefined) : undefined;
    return value?.kind === 'selection' ? value.matches.length : undefined;
  });
  const store = editorStore.getState();
  if (!from) {
    return (
      <p className="hint">
        Nothing is connected to <strong>Where</strong>, so this node gives its content on its own, as a document (e.g.
        for another node's Content, or an Output). Connect a Selector's <strong>Point</strong> (a point you click, or
        next to every match), its <strong>Selection</strong> (next to or instead of what it picked), or a document (then
        click in the preview to pick the point).
      </p>
    );
  }
  const link = (
    <button type="button" className="link" onClick={() => store.select(from.id)}>
      {nodeLabel(from)}
    </button>
  );
  if (kind === 'point') {
    const c = from.config as SelectorNodeConfig;
    const where = from.type !== 'selector' ? '' : c.mode === 'point' ? (c.point ? 'at the point picked in the preview' : 'at a point not picked yet') : EVERY_MATCH[c.place ?? 'after'];
    return (
      <div className="field">
        <span className="field-label">Where</span>
        <p className="small">
          The Point of {link}
          {where && ` · ${where}`}
        </p>
      </div>
    );
  }
  if (kind === 'selection') {
    return (
      <div className="field">
        <span className="field-label">Where</span>
        <p className="small">
          What {link} selects{count === undefined ? '' : ` (${count} match${count === 1 ? '' : 'es'})`}
        </p>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="field-label">Where</span>
      <p className="small">In the document from {link}, at a point picked in the preview.</p>
      <PointSummary nodeId={nodeId} point={point} noun="Insert node" />
      {point && (
        <button type="button" className="link" onClick={onClearPoint}>
          Clear the point
        </button>
      )}
    </div>
  );
}

/** What a point picked in the preview is next to. */
export function PointSummary({ nodeId, point, noun = 'Selector' }: { nodeId: string; point?: InsertionPoint; noun?: string }) {
  const result = useEditor((s) => s.results[nodeId]);
  if (!point) {
    return <p className="hint">With this {noun} selected, click in the preview where the point should be.</p>;
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

function ContentFields({
  node,
  content,
  onChange,
  onFile,
  none,
}: {
  node: GraphNode;
  content: InsertContent;
  onChange: (patch: Partial<InsertContent>) => void;
  /** Where an uploaded file goes (default: this node's content). */
  onFile?: (name: string, data: Uint8Array) => void;
  /** Shown when nothing is connected to Content (when that is fine). */
  none?: React.ReactNode;
}) {
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
    const data = new Uint8Array(await chosen.arrayBuffer());
    if (onFile) onFile(chosen.name, data);
    else editorStore.getState().chooseMediaFile(node.id, chosen.name, data);
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
          <ContentSource nodeId={node.id} owner="Insert node" none={none} />
          <CopyOptionsFields options={content} onChange={onChange} />
        </>
      );
    case 'text':
      return (
        <>
          <TextAreaField
            label="Text"
            prose
            rows={6}
            value={content.text}
            placeholder="Write the text to add…"
            hint="Plain text: characters like < and & show as they are, never as HTML."
            onChange={(t) => onChange({ text: t })}
          />
          <SelectField
            label="Add it as"
            value={content.as ?? 'paragraphs'}
            options={[
              { value: 'paragraphs', label: 'Paragraphs (a blank line starts a new one)' },
              { value: 'inline', label: 'Text inside a paragraph (e.g. at the cursor)' },
            ]}
            onChange={(as) => onChange({ as: as === 'inline' ? 'inline' : undefined })}
          />
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

/** How copied content goes in (an Insert node's "Content from another node"). */
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
export function ContentSource({
  nodeId,
  owner = 'Object',
  original = 'The original stays where it is.',
  none,
}: {
  nodeId: string;
  owner?: string;
  original?: string;
  /** Shown instead of the warning when nothing is connected (when the node works without content). */
  none?: React.ReactNode;
}) {
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
    if (none) return <p className="hint">{none}</p>;
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
