// Insert new content (code, images, videos) into a document, at a picked point or at every match of a selector.
import type { Element, ElementContent, Nodes, Root } from 'hast';
import { createAnchor, resolveAnchor } from './anchors';
import { enclosingBlock, indexDocument, rangeOf } from './doc-index';
import { BLOCK_TAGS, parseHtml } from './document';
import type { StoredFile } from './graph';
import { runSelector, type SelectorConfig } from './selectors';
import { applySnippet } from './snippets';
import type { Anchor, Asset, CmsDocument, Match, Selection, Snippet, SnippetAsset } from './types';
import { hashString } from './hash';

export type InsertContent =
  | {
      kind: 'code';
      code: string;
      language?: string;
      /** "block": shown as code. "html": added to the page as HTML. */
      render: 'block' | 'html';
      /** CSS and JavaScript added to the page once (like a snippet's), e.g. to style or run the inserted HTML. */
      css?: string;
      js?: string;
    }
  /**
   * Plain text (never read as HTML). "paragraphs" (default): a blank line starts a new paragraph, a single line
   * break stays a line break. "inline": the text alone, e.g. at the cursor inside a paragraph.
   */
  | { kind: 'text'; text: string; as?: 'paragraphs' | 'inline' }
  | { kind: 'image'; fileId?: string; alt: string; caption?: string; width?: Width; href?: string }
  | { kind: 'video'; fileId?: string; caption?: string; width?: Width; autoplay?: boolean; loop?: boolean; muted?: boolean }
  | { kind: 'imageUrl'; url: string; alt: string; caption?: string; width?: Width; href?: string }
  | { kind: 'videoUrl'; url: string; caption?: string; width?: Width }
  /**
   * A copy of what comes into the Object's Content input (a selection, or a whole document such as an Extractor's),
   * from any document. Options: what to put it in, whether the source's own styles come along (default yes), and
   * whether its headings keep their levels or fit under the heading before the point.
   */
  | { kind: 'selection'; wrap?: CopyWrap; className?: string; styles?: boolean; headings?: 'keep' | 'fit' };

/** What copied content is put in: nothing, a box with a class, or a section labelled with where it came from. */
export type CopyWrap = 'none' | 'div' | 'section';

export type InsertKind = InsertContent['kind'];

/** A CSS width such as "320px", "20em", "50%" or "auto". A plain number (or "320") means pixels. Empty means 100%. */
export type Width = string | number;

const UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax', 'svw', 'svh', 'dvw', 'dvh', 'ch', 'ex', 'lh', 'cm', 'mm', 'in', 'pt', 'pc'];

/** The width to use, and a warning when what was typed is not a width (then 100% is used). */
export function cssWidth(input: Width | undefined): { value: string; warning?: string } {
  const full = { value: '100%' };
  if (input === undefined || input === '') return full;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? { value: `${input}px` } : { ...full, warning: `${input} is not a width; using 100%` };
  }
  const t = input.trim().toLowerCase();
  if (!t) return full;
  if (t === 'auto') return { value: 'auto' };
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*([a-z%]*)$/.exec(t);
  if (!m) return { ...full, warning: `"${input}" is not a width (use for example 320px, 20em or 50%); using 100%` };
  const unit = m[2] || 'px';
  if (!UNITS.includes(unit)) return { ...full, warning: `"${m[2]}" is not a unit (use ${UNITS.slice(0, 6).join(', ')}, …); using 100%` };
  if (Number(m[1]) === 0) return { ...full, warning: 'A width of 0 would hide it; using 100%' };
  return { value: `${Number(m[1])}${unit}` };
}

/** before / after: next to the target. start / end: inside it, as its first / last content. */
export type InsertPlace = 'before' | 'after' | 'start' | 'end';

export interface InsertionPoint {
  /** A block (paragraph, heading, ...) or a short piece of text next to the cursor. */
  anchor: Anchor;
  place: InsertPlace;
}

export type InsertWhere =
  | { mode: 'point'; point?: InsertionPoint }
  | { mode: 'selector'; selector: SelectorConfig; place: InsertPlace };

/**
 * What a Selector's Point output carries: the document and where in it things go (a picked point, or a place
 * next to every match of the Selector). An Object node puts its content there.
 */
export interface PointValue {
  kind: 'point';
  document: CmsDocument;
  where: InsertWhere;
}

export interface InsertResult {
  document: CmsDocument;
  warnings: string[];
  inserted: number;
  /** The picked point could not be found in this version of the document. */
  needsAttention: boolean;
  /** Set when nothing can be inserted yet (no content, no point). */
  waiting?: string;
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};
const VIDEO_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime' };

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_TYPES).map((e) => `.${e}`);
export const VIDEO_EXTENSIONS = Object.keys(VIDEO_TYPES).map((e) => `.${e}`);

export function mediaType(fileName: string): { kind: 'image' | 'video'; contentType: string } | undefined {
  const ext = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1] ?? '';
  if (IMAGE_TYPES[ext]) return { kind: 'image', contentType: IMAGE_TYPES[ext] };
  if (VIDEO_TYPES[ext]) return { kind: 'video', contentType: VIDEO_TYPES[ext] };
  return undefined;
}

const INSERT_CSS =
  '.cms-figure{margin:1rem 0}.cms-figure figcaption{font-size:.9em;color:#555;margin-top:.35rem}' +
  '.cms-figure img,.cms-figure video,img.cms-insert,video.cms-insert{max-width:100%;height:auto}' +
  'pre.cms-insert-code{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:6px;overflow:auto;font-size:.9rem}' +
  '.cms-embed{position:relative;max-width:100%;aspect-ratio:16/9}.cms-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}';

const el = (tagName: string, properties: Element['properties'], children: ElementContent[] = []): Element => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const text = (value: string): ElementContent => ({ type: 'text', value });

interface Built {
  nodes: ElementContent[];
  assets: Asset[];
  /** Block content cannot go inside a paragraph. */
  block: boolean;
  warnings: string[];
  snippetAssets?: NonNullable<CmsDocument['meta']['snippetAssets']>;
  /** CSS of the document the content came from (its `<style>`, the slide look), added to the target. */
  styles?: string[];
}

/** The CSS and JavaScript of inserted code, as a page asset added once per distinct code. */
function codeAssets(content: Extract<InsertContent, { kind: 'code' }>): SnippetAsset[] | undefined {
  const css = content.css?.trim();
  const js = content.js?.trim();
  if (!css && !js) return undefined;
  return [{ key: `object-${hashString(`${css ?? ''}\u0000${js ?? ''}`)}`, name: 'Inserted code', ...(css && { css }), ...(js && { js }) }];
}

/** The elements to insert. Returns a reason instead when the content is not complete yet. */
export function buildInsertion(content: InsertContent, files: Record<string, StoredFile>): Built | { waiting: string } | { error: string } {
  const warnings: string[] = [];
  // With a caption, the figure gets the width and the media fills it, so the caption wraps to the same width.
  const width = cssWidth('width' in content ? content.width : undefined);
  if (width.warning) warnings.push(width.warning);
  const sized = (media: Element, caption?: string) => {
    // A linked image: size the image, not the link around it.
    const target = media.tagName === 'a' && media.children[0]?.type === 'element' ? media.children[0] : media;
    target.properties.style = caption?.trim() ? 'width:100%' : `width:${width.value}`;
    return media;
  };
  const figure = (media: Element, caption?: string): { node: Element; block: boolean } =>
    caption?.trim()
      ? {
          node: el('figure', { className: ['cms-figure'], style: `width:${width.value}` }, [sized(media, caption), el('figcaption', {}, [text(caption.trim())])]),
          block: true,
        }
      : { node: sized(media), block: false };
  switch (content.kind) {
    case 'code': {
      if (!content.code.trim()) return { waiting: 'Write the code to insert' };
      if (content.render === 'html') {
        const parsed = parseHtml(content.code);
        warnings.push(...parsed.meta.warnings);
        const nodes = parsed.tree.children as ElementContent[];
        if (nodes.length === 0) return { error: 'The HTML is empty once scripts and the like are removed' };
        return { nodes, assets: [], block: nodes.some((n) => n.type === 'element' && BLOCK_TAGS.has(n.tagName)), warnings, snippetAssets: codeAssets(content) };
      }
      const code = el('code', content.language ? { className: [`language-${content.language}`] } : {}, [text(content.code)]);
      return {
        nodes: [el('pre', { className: ['cms-insert-code'], ...(content.language ? { dataLanguage: content.language } : {}) }, [code])],
        assets: [],
        block: true,
        warnings,
        snippetAssets: codeAssets(content),
      };
    }
    case 'text': {
      if (!content.text.trim()) return { waiting: 'Write the text to add' };
      const lines = (t: string): ElementContent[] =>
        t.split('\n').flatMap((line, i) => (i ? [el('br', {}), text(line)] : [text(line)]));
      if (content.as === 'inline') return { nodes: lines(content.text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')), assets: [], block: false, warnings };
      const paragraphs = content.text
        .replace(/\r\n?/g, '\n')
        .split(/\n(?:[ \t]*\n)+/)
        .map((p) => p.replace(/^\n+|\n+$/g, ''))
        .filter((p) => p.trim());
      return { nodes: paragraphs.map((p) => el('p', {}, lines(p))), assets: [], block: true, warnings };
    }
    case 'image':
    case 'video': {
      if (!content.fileId) return { waiting: `Choose ${content.kind === 'image' ? 'an image' : 'a video'} file` };
      const file = files[content.fileId];
      if (!file) return { waiting: 'The chosen file is no longer in the project; choose it again' };
      const type = mediaType(file.name);
      if (!type || type.kind !== content.kind) {
        return { error: `${file.name} is not ${content.kind === 'image' ? 'an image' : 'a video'} (${(content.kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS).join(', ')})` };
      }
      const asset: Asset = { id: `insert-${file.hash}`, contentType: type.contentType, base64: toBase64(file.data) };
      if (content.kind === 'image') {
        let media: Element = el('img', { src: `asset:${asset.id}`, alt: content.alt, className: ['cms-insert'] });
        if (content.href?.trim()) media = linked(media, content.href, warnings);
        const f = figure(media, content.caption);
        if (!content.alt.trim()) warnings.push('The image has no alternative text');
        return { nodes: [f.node], assets: [asset], block: f.block, warnings };
      }
      const video = el('video', {
        src: `asset:${asset.id}`,
        controls: true,
        playsInline: true,
        className: ['cms-insert'],
        ...(content.autoplay ? { autoPlay: true, muted: true } : {}),
        ...(content.muted ? { muted: true } : {}),
        ...(content.loop ? { loop: true } : {}),
      });
      return { nodes: [figure(video, content.caption).node], assets: [asset], block: true, warnings };
    }
    case 'imageUrl': {
      const url = checkUrl(content.url);
      if ('waiting' in url || 'error' in url) return url;
      let media: Element = el('img', { src: url.href, alt: content.alt, className: ['cms-insert'], loading: 'lazy' });
      if (content.href?.trim()) media = linked(media, content.href, warnings);
      if (!content.alt.trim()) warnings.push('The image has no alternative text');
      const f = figure(media, content.caption);
      return { nodes: [f.node], assets: [], block: f.block, warnings };
    }
    case 'videoUrl': {
      const url = checkUrl(content.url);
      if ('waiting' in url || 'error' in url) return url;
      const embed = embedUrl(url.href);
      const media = embed
        ? el('div', { className: ['cms-embed'] }, [
            el('iframe', {
              src: embed,
              title: content.caption?.trim() || 'Video',
              allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
              allowFullScreen: true,
              loading: 'lazy',
              referrerPolicy: 'strict-origin-when-cross-origin',
            }),
          ])
        : el('video', { src: url.href, controls: true, playsInline: true, className: ['cms-insert'], preload: 'metadata' });
      if (embed) warnings.push('YouTube and Vimeo videos may not play in the preview (it is sandboxed); they do play in the exported page');
      return { nodes: [figure(media, content.caption).node], assets: [], block: true, warnings };
    }
    case 'selection':
      return { waiting: "Connect a document or a selection to this Object's Content input" };
    default:
      return { error: `Unknown kind of insertion "${(content as { kind: string }).kind}"` };
  }
}

function linked(media: Element, href: string, warnings: string[]): Element {
  const url = checkUrl(href);
  if ('href' in url) return el('a', { href: url.href }, [media]);
  warnings.push(`The link "${href}" is not a web address, so the image is not linked`);
  return media;
}

/** Only http(s) addresses; anything else (javascript:, data:, file:) is refused. */
export function checkUrl(input: string): { href: string } | { waiting: string } | { error: string } {
  const value = input.trim();
  if (!value) return { waiting: 'Enter the address of the image or video' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return { error: `"${value}" is not a web address` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Only http and https addresses can be used' };
  return { href: url.href };
}

/** The embed address for YouTube and Vimeo links, or undefined for anything else. */
export function embedUrl(href: string): string | undefined {
  const url = new URL(href);
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(url.pathname)?.[1];
  }
  if (id && /^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vimeo = /\/(?:video\/)?(\d+)/.exec(url.pathname)?.[1];
    if (vimeo) return `https://player.vimeo.com/video/${vimeo}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Copying a selection

const EXTRACT = 'cms-extract';

const extractSnippet: Snippet = {
  kind: 'snippet',
  id: 'cms-extract',
  name: 'Copy',
  version: 1,
  mode: 'wrap',
  template: `<${EXTRACT}>{{content}}</${EXTRACT}>`,
  params: [],
};

/**
 * A copy of everything a selection picked, in document order (text ranges keep their inline formatting).
 * The copy loses `data-json-path`: it is not the JSON field itself, and two blocks for one field would confuse
 * write-back. Images it uses and the snippet CSS / JS of its document come along. With `context`, so do the
 * elements around each match (their tag and attributes, not their other content).
 */
export async function copySelection(selection: Selection, options: { context?: boolean } = {}): Promise<Built> {
  const warnings = [...selection.warnings];
  if (selection.matches.length === 0) return { nodes: [], assets: [], block: false, warnings: [...warnings, 'The selection is empty, so nothing was inserted'] };
  const marked = await applySnippet(selection, extractSnippet);
  const nodes: ElementContent[] = [];
  if (options.context) {
    // The elements around each match come along (without their other content), so CSS aimed at them, or at a
    // wrapper such as a callout, still applies: text from a <p class="tip"> stays in a <p class="tip">.
    const prune = (children: Nodes[]): ElementContent[] =>
      children.flatMap((c): ElementContent[] => {
        if (c.type !== 'element') return [];
        if (c.tagName === EXTRACT) {
          const copy = structuredClone(c);
          unwrapMarkers(copy);
          return copy.children;
        }
        const kept = prune(c.children);
        return kept.length ? [{ ...c, properties: { ...c.properties }, children: kept }] : [];
      });
    nodes.push(...prune(marked.document.tree.children as Nodes[]));
  } else {
    const collect = (children: Nodes[], inside: boolean) => {
      for (const c of children) {
        if (c.type !== 'element') {
          if (inside) nodes.push(structuredClone(c) as ElementContent);
          continue;
        }
        if (c.tagName === EXTRACT) {
          collect(c.children, true); // nested (overlapping matches): copied once
          continue;
        }
        if (inside) {
          const copy = structuredClone(c);
          unwrapMarkers(copy);
          nodes.push(copy);
        } else collect(c.children, false);
      }
    };
    collect(marked.document.tree.children as Nodes[], false);
  }

  const doc = selection.document;
  const assets: Asset[] = [];
  const visit = (n: ElementContent) => {
    if (n.type !== 'element') return;
    delete n.properties.dataJsonPath;
    const src = n.properties.src;
    if (typeof src === 'string' && src.startsWith('asset:')) {
      const a = doc.assets[src.slice('asset:'.length)];
      if (a && !assets.includes(a)) assets.push(a);
    }
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return {
    nodes,
    assets,
    block: nodes.some((n) => n.type === 'element' && BLOCK_TAGS.has(n.tagName)),
    warnings,
    snippetAssets: doc.meta.snippetAssets,
  };
}

const HEADING = /^h([1-6])$/;
const headingLevel = (n: ElementContent): number => (n.type === 'element' ? Number(HEADING.exec(n.tagName)?.[1] ?? 0) : 0);

/** Every heading in `nodes`, in document order. */
function headingsIn(nodes: ElementContent[], out: Element[] = []): Element[] {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    if (headingLevel(n)) out.push(n);
    headingsIn(n.children, out);
  }
  return out;
}

/**
 * Move headings so the highest one sits one level below `level` (the heading before the place), keeping the
 * steps between them. Headings past level 6 stay <h6>; their text goes into `deep`.
 */
export function fitHeadings(nodes: ElementContent[], level: number, deep: string[] = []): ElementContent[] {
  const headings = headingsIn(nodes);
  if (!headings.length) return nodes;
  const top = Math.min(...headings.map(headingLevel));
  const shift = level + 1 - top;
  for (const h of headings) {
    const next = headingLevel(h) + shift;
    if (next > 6) deep.push(`“${textContent(h).slice(0, 40)}”`);
    h.tagName = `h${Math.max(1, Math.min(6, next))}`;
  }
  return nodes;
}

const textContent = (n: ElementContent): string => (n.type === 'text' ? n.value : n.type === 'element' ? n.children.map(textContent).join('') : '');

/** Letters, digits, - and _ only; a default when nothing is left. */
const safeClass = (name: string | undefined, fallback: string) => (name ?? '').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

/** Where copied content came from, for the section label. */
export const sourceName = (doc: CmsDocument) => doc.meta.fileName ?? doc.meta.title ?? 'another document';

/**
 * What the Object's "Content from another node" adds: a copy of the selection, put in a box or a labelled
 * section if asked, with the source's own styles unless turned off.
 */
export async function copyContent(selection: Selection, options: Extract<InsertContent, { kind: 'selection' }> = { kind: 'selection' }): Promise<Built> {
  const copy = await copySelection(selection);
  const doc = selection.document;
  const styles = options.styles === false ? [] : doc.meta.styles.filter((css) => css.trim());
  const wrap = options.wrap ?? 'none';
  if (wrap === 'none' || copy.nodes.length === 0) return { ...copy, styles };
  const name = sourceName(doc);
  const wrapped =
    wrap === 'div'
      ? el('div', { className: [safeClass(options.className, 'inserted')] }, copy.nodes)
      : el('section', { className: ['cms-from', ...(options.className?.trim() ? [safeClass(options.className, 'cms-from')] : [])], dataFrom: name }, [
          el('p', { className: ['cms-from-label'] }, [text(`From ${name}`)]),
          ...copy.nodes,
        ]);
  return { ...copy, nodes: [wrapped], block: true, styles: wrap === 'section' ? [...styles, FROM_CSS] : styles };
}

const FROM_CSS = `.cms-from { margin: 1rem 0; padding: .75rem 1rem; border-left: 3px solid #94a3b8; background: #f8fafc; }
.cms-from-label { margin: 0 0 .4rem; font: 600 .75rem/1.4 system-ui, sans-serif; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }`;

function unwrapMarkers(el: Element) {
  el.children = el.children.flatMap((c) => {
    if (c.type !== 'element') return [c];
    unwrapMarkers(c);
    return c.tagName === EXTRACT ? c.children : [c];
  });
}

// ---------------------------------------------------------------------------------------------
// Placement

const PLACEHOLDER = 'cms-insert';

const placeSnippet = (place: InsertPlace): Snippet => ({
  kind: 'snippet',
  id: 'cms-insert',
  name: 'Insert',
  version: 1,
  mode: place === 'before' || place === 'start' ? 'prepend' : 'append',
  inside: place === 'start' || place === 'end',
  template: `<${PLACEHOLDER} data-i="{{index}}"></${PLACEHOLDER}>`,
  params: [],
});

/** Elements that may only hold inline content: block insertions go next to them instead of inside. */
/** Media that the Object node treats as blocks (they never go inside a paragraph). */
const MEDIA_BLOCKS = new Set(['video', 'audio', 'iframe']);
const PHRASING_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'summary', 'caption', 'figcaption']);

interface Targets {
  matches: Match[];
  place: InsertPlace;
  warnings: string[];
  needsAttention: boolean;
  waiting?: string;
}

/** Where the insertion goes, worked out against this version of the document. */
export function insertionTargets(doc: CmsDocument, where: InsertWhere, block: boolean): Targets {
  const ix = indexDocument(doc);
  const warnings: string[] = [];
  let matches: Match[];
  let place: InsertPlace;
  let needsAttention = false;

  if (where.mode === 'point') {
    if (!where.point) return { matches: [], place: 'after', warnings, needsAttention, waiting: 'Pick the point: select its Selector and click in the preview' };
    const r = resolveAnchor(ix, where.point.anchor);
    if (!r.match) {
      return { matches: [], place: 'after', warnings: [`The insertion point needs attention: ${r.reason}`], needsAttention: true };
    }
    if (r.status === 'fuzzy') warnings.push('The text at the insertion point changed a little; check that it is still in the right place');
    matches = [r.match];
    place = where.point.place;
  } else {
    const selection = runSelector(doc, where.selector);
    warnings.push(...selection.warnings);
    matches = selection.matches.map((m) => m.match);
    place = where.place;
  }

  // Text matches: start / end mean before / after the text.
  if (place === 'start' || place === 'end') {
    if (matches.some((m) => m.kind === 'text')) place = place === 'start' ? 'before' : 'after';
  }
  if (block) {
    // A video or code block cannot sit inside a paragraph: put it next to the paragraph.
    let moved = false;
    matches = matches.map((m) => {
      if (m.kind !== 'text') return m;
      moved = true;
      return enclosingBlock(ix, place === 'before' ? m.start : Math.max(m.start, m.end - 1)) ?? m;
    });
    if (place === 'start' || place === 'end') {
      const inline = matches.some((m) => {
        if (m.kind !== 'nodes' || m.end - m.start !== 1) return false;
        const node = nodeAt(doc, m);
        return node?.type === 'element' && PHRASING_BLOCKS.has(node.tagName);
      });
      if (inline) {
        place = place === 'start' ? 'before' : 'after';
        moved = true;
      }
    }
    if (moved) warnings.push(`This content cannot go inside a paragraph, so it goes ${place === 'before' ? 'before' : 'after'} it`);
    // Several text matches in one paragraph now point at the same paragraph: insert once.
    const seen = new Set<string>();
    matches = matches.filter((m) => {
      const k = JSON.stringify(m);
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
  if (matches.length === 0 && where.mode === 'selector' && !warnings.length) warnings.push('The selector matched nothing, so nothing was inserted');
  return { matches, place, warnings, needsAttention };
}

function nodeAt(doc: CmsDocument, m: Extract<Match, { kind: 'nodes' }>): Nodes | undefined {
  let node: Nodes = doc.tree;
  for (const i of m.parent) {
    if (!('children' in node)) return undefined;
    node = node.children[i];
  }
  return 'children' in node ? node.children[m.start] : undefined;
}

/** Put `nodesFor(i)` at each target. Never changes `doc`. */
async function place(doc: CmsDocument, targets: Pick<Targets, 'matches' | 'place'>, nodesFor: (i: number, level: number) => ElementContent[], snippet = placeSnippet(targets.place)) {
  const selection: Selection = { kind: 'selection', document: doc, matches: targets.matches.map((match) => ({ match, text: '' })), warnings: [] };
  const result = await applySnippet(selection, snippet);
  // The level of the last heading before each place (0: none), in document order.
  let level = 0;
  const replace = (children: ElementContent[]): ElementContent[] =>
    children.flatMap((c) => {
      if (c.type !== 'element') return [c];
      if (c.tagName === PLACEHOLDER) return nodesFor(Number(c.properties.dataI ?? 0), level);
      const h = headingLevel(c);
      if (h) level = h;
      c.children = replace(c.children);
      return [c];
    });
  result.document.tree.children = replace(result.document.tree.children as ElementContent[]) as typeof result.document.tree.children;
  return { document: result.document, warnings: result.warnings, inserted: result.applied };
}

/** Adds what built content needs to the document it went into: the source's styles, images, snippet CSS / JS. */
function addBuiltAssets(out: CmsDocument, built: Built) {
  for (const css of built.styles ?? []) if (!out.meta.styles.includes(css)) out.meta = { ...out.meta, styles: [...out.meta.styles, css] };
  for (const a of built.assets) out.assets = { ...out.assets, [a.id]: a };
  // Copied content keeps its look: the snippet CSS and JS of the document it came from come along.
  for (const a of built.snippetAssets ?? []) {
    if (!(out.meta.snippetAssets ?? []).some((x) => x.key === a.key)) out.meta.snippetAssets = [...(out.meta.snippetAssets ?? []), a];
  }
}

/** Insert `content` into a copy of `doc`. */
export async function insertContent(
  doc: CmsDocument,
  where: InsertWhere,
  content: InsertContent,
  files: Record<string, StoredFile>,
  selection?: Selection,
): Promise<InsertResult> {
  const built = content.kind === 'selection' && selection ? await copyContent(selection, content) : buildInsertion(content, files);
  if ('waiting' in built) return { document: doc, warnings: [], inserted: 0, needsAttention: false, waiting: built.waiting };
  if ('error' in built) throw new Error(built.error);
  const targets = insertionTargets(doc, where, built.block);
  if (targets.waiting) return { document: doc, warnings: [], inserted: 0, needsAttention: false, waiting: targets.waiting };
  const warnings = [...built.warnings, ...targets.warnings];
  if (built.nodes.length === 0) return { document: doc, warnings, inserted: 0, needsAttention: targets.needsAttention };
  if (targets.matches.length === 0) return { document: doc, warnings, inserted: 0, needsAttention: targets.needsAttention };

  const fit = content.kind === 'selection' && content.headings === 'fit';
  const deep: string[] = [];
  const placed = await place(doc, targets, (_i, level) => {
    const nodes = structuredClone(built.nodes);
    if (fit && level) fitHeadings(nodes, level, deep);
    return nodes;
  });
  if (deep.length) warnings.push(`Some headings would be deeper than level 6, so they stay <h6>: ${[...new Set(deep)].join(', ')}`);
  const out = placed.document;
  addBuiltAssets(out, built);
  const assets = out.meta.snippetAssets ?? [];
  if (!assets.some((a) => a.key === 'cms-insert@1')) out.meta.snippetAssets = [...assets, { key: 'cms-insert@1', name: 'Insert', css: INSERT_CSS }];
  return { document: out, warnings: [...warnings, ...placed.warnings], inserted: placed.inserted, needsAttention: false };
}

// ---------------------------------------------------------------------------------------------
// Replacing

/** How the Replace node copies its content in: the options of the Object's "Content from another node". */
export type ReplaceOptions = Omit<Extract<InsertContent, { kind: 'selection' }>, 'kind'>;

/** What the Replace node replaces, and which content each match gets. */
export interface ReplaceMode {
  /** "element" (default): the selected element itself. "inside": what is inside it (the element and its attributes stay). */
  target?: 'element' | 'inside';
  /**
   * Match by match: the 1st match gets the 1st part of the content (the 1st match of a selection, or the 1st block of
   * a document), the 2nd the 2nd, and so on. Off: every match gets all of it.
   */
  pairs?: boolean;
}

export interface ReplaceResult {
  document: CmsDocument;
  warnings: string[];
  /** How many matches were replaced. */
  replaced: number;
}

const replaceSnippet: Snippet = {
  kind: 'snippet',
  id: 'cms-replace',
  name: 'Replace',
  version: 1,
  mode: 'replace',
  template: `<${PLACEHOLDER} data-i="{{index}}"></${PLACEHOLDER}>`,
  params: [],
};

/** Content that fits inside a paragraph (or heading): one paragraph's content without its <p>, or inline nodes. */
function inlineOf(built: Built): ElementContent[] | undefined {
  const items = built.nodes.filter((n) => n.type === 'element' || (n.type === 'text' && n.value.trim()));
  const single = items.length === 1 && items[0].type === 'element' ? items[0] : undefined;
  return single && PHRASING_BLOCKS.has(single.tagName) ? single.children : !built.block ? built.nodes : undefined;
}

/**
 * A copy of the selection's document with every match replaced by a copy of `content` (what another node picked,
 * from any document). Selected text inside a paragraph takes inline content: one paragraph's content goes in
 * without its <p>; other block content replaces the whole paragraph (with a warning). With `target: 'inside'`, a
 * selected element keeps its tag and attributes and only what is inside it is replaced (a paragraph or heading
 * then takes the content of one paragraph without its <p>). With `pairs`, match i gets part i of the content.
 */
export async function replaceSelection(selection: Selection, content: Selection, options: ReplaceOptions & ReplaceMode = {}): Promise<ReplaceResult> {
  const doc = selection.document;
  const warnings = [...selection.warnings];
  if (selection.matches.length === 0) {
    if (!warnings.length) warnings.push('The selection is empty, so nothing was replaced');
    return { document: doc, warnings, replaced: 0 };
  }
  const copyOptions = { kind: 'selection' as const, ...options };
  const pieces = options.pairs
    ? await Promise.all(content.matches.map((m) => copyContent({ ...content, matches: [m], warnings: [] }, copyOptions)))
    : [await copyContent(content, copyOptions)];
  for (const p of pieces) warnings.push(...p.warnings.filter((w) => !warnings.includes(w)));
  if (pieces.every((p) => p.nodes.length === 0)) {
    warnings.push('There is no content to put in, so nothing was replaced');
    return { document: doc, warnings, replaced: 0 };
  }
  if (options.pairs && pieces.length !== selection.matches.length) {
    const n = selection.matches.length;
    warnings.push(
      pieces.length > n
        ? `The content has ${pieces.length} parts for ${n} match${n === 1 ? '' : 'es'}: the last ${pieces.length - n} ${pieces.length - n === 1 ? 'is' : 'are'} left out`
        : `The content has ${pieces.length} part${pieces.length === 1 ? '' : 's'} for ${n} matches: the last ${n - pieces.length} stay${n - pieces.length === 1 ? 's' : ''} as ${n - pieces.length === 1 ? 'it was' : 'they were'}`,
    );
  }

  // One job per place: what goes there (a piece, inline or not), worked out against this document.
  const ix = indexDocument(doc);
  interface Job { match: Match; nodes: ElementContent[] }
  const fill: Job[] = []; // empty elements: the content goes inside
  const swap: Job[] = []; // everything else: replaced
  let widened = false;
  const seen = new Set<string>();
  selection.matches.forEach((m, i) => {
    const piece = options.pairs ? pieces[i] : pieces[0];
    if (!piece || piece.nodes.length === 0) return;
    let match = m.match;
    let nodes = piece.nodes;
    if (match.kind === 'text') {
      const inline = inlineOf(piece);
      if (inline) nodes = inline;
      else {
        match = enclosingBlock(ix, match.start) ?? match;
        widened ||= match.kind === 'nodes';
      }
    } else if (options.target === 'inside' && match.end - match.start === 1) {
      const el = nodeAt(doc, match);
      if (el?.type === 'element') {
        // A paragraph, heading or inline element (a link, …) takes inline content.
        if (PHRASING_BLOCKS.has(el.tagName) || !BLOCK_TAGS.has(el.tagName)) nodes = inlineOf(piece) ?? nodes;
        const inner: Match = { kind: 'nodes', parent: [...match.parent, match.start], start: 0, end: el.children.length };
        const key = JSON.stringify(inner);
        if (seen.has(key)) return;
        seen.add(key);
        (el.children.length ? swap : fill).push({ match: el.children.length ? inner : match, nodes });
        return;
      }
    } else if ((piece.block || piece.nodes.some((n) => n.type === 'element' && MEDIA_BLOCKS.has(n.tagName))) && match.parent.length) {
      // Block content (a video, a figure) for the only thing in a paragraph, e.g. an image from Word in its own
      // <p>: the paragraph is replaced, so no block ends up inside it.
      const { start, end } = match;
      const at = match.parent[match.parent.length - 1];
      const around: Match = { kind: 'nodes', parent: match.parent.slice(0, -1), start: at, end: at + 1 };
      const parent = nodeAt(doc, around);
      if (parent?.type === 'element' && PHRASING_BLOCKS.has(parent.tagName)) {
        const others = parent.children.filter((c, j) => (j < start || j >= end) && !(c.type === 'text' && !c.value.trim()));
        if (!others.length) match = around;
        else warnings.push(`Block content replaces part of a <${parent.tagName}>: it is put inside it, which browsers may show oddly`);
      }
    }
    const key = JSON.stringify(match);
    if (seen.has(key)) return;
    seen.add(key);
    swap.push({ match, nodes });
  });
  if (widened) warnings.push('The content is more than a paragraph’s text, so it replaces the whole paragraph around the selected text');

  const fit = options.headings === 'fit';
  const deep: string[] = [];
  const nodesFor = (jobs: Job[], filled: Set<number>) => (i: number, level: number) => {
    // A text range across blocks leaves one placeholder per block: only the first one gets the content.
    if (filled.has(i) || !jobs[i]) return [];
    filled.add(i);
    const nodes = structuredClone(jobs[i].nodes);
    if (fit && level) fitHeadings(nodes, level, deep);
    return nodes;
  };
  let out = doc;
  const placeWarnings: string[] = [];
  // Empty elements first: filling them moves nothing else, so the other matches stay where they were.
  const filledEmpty = new Set<number>();
  if (fill.length) {
    const r = await place(out, { matches: fill.map((j) => j.match), place: 'end' }, nodesFor(fill, filledEmpty));
    out = r.document;
    placeWarnings.push(...r.warnings);
  }
  const replaced = new Set<number>();
  if (swap.length) {
    const r = await place(out, { matches: swap.map((j) => j.match), place: 'after' }, nodesFor(swap, replaced), replaceSnippet);
    out = r.document;
    placeWarnings.push(...r.warnings);
  }
  if (deep.length) warnings.push(`Some headings would be deeper than level 6, so they stay <h6>: ${[...new Set(deep)].join(', ')}`);
  for (const p of pieces) addBuiltAssets(out, p);
  return { document: out, warnings: [...warnings, ...placeWarnings], replaced: filledEmpty.size + replaced.size };
}

const removeSnippet: Snippet = { kind: 'snippet', id: 'cms-remove', name: 'Remove', version: 1, mode: 'replace', template: '', params: [] };

/**
 * A copy of the selection's document without what it matched (a Replace node with nothing connected to Content).
 * With `target: 'inside'`, a selected element stays (tag and attributes) and only what is inside it goes.
 * JSON field blocks are never removed: what is inside them is.
 */
export async function removeSelection(selection: Selection, options: ReplaceMode = {}): Promise<ReplaceResult> {
  const doc = selection.document;
  const warnings = [...selection.warnings];
  if (selection.matches.length === 0) {
    if (!warnings.length) warnings.push('The selection is empty, so nothing was removed');
    return { document: doc, warnings, replaced: 0 };
  }
  const seen = new Set<string>();
  const matches = selection.matches.flatMap((m) => {
    let match = m.match;
    if (match.kind === 'nodes' && match.end - match.start === 1) {
      const el = nodeAt(doc, match);
      // An element to empty (inside), or a JSON field block (its content goes, the block stays).
      if (el?.type === 'element' && (options.target === 'inside' || el.properties?.dataJsonPath !== undefined)) {
        if (!el.children.length) return [];
        match = { kind: 'nodes', parent: [...match.parent, match.start], start: 0, end: el.children.length };
      }
    }
    const key = JSON.stringify(match);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...m, match }];
  });
  if (!matches.length) {
    warnings.push('The selected elements are already empty, so nothing was removed');
    return { document: doc, warnings, replaced: 0 };
  }
  const r = await applySnippet({ ...selection, matches, warnings: [] }, removeSnippet);
  return { document: r.document, warnings: [...warnings, ...r.warnings], replaced: matches.length };
}

/**
 * The content alone, as a document of its own (an Object with no Point connected): what it would add, ready to go
 * into a Replace node, another Object or an Output.
 */
export async function contentAlone(
  content: InsertContent,
  files: Record<string, StoredFile>,
  selection?: Selection,
): Promise<{ document: CmsDocument; warnings: string[] } | { waiting: string }> {
  const built = content.kind === 'selection' && selection ? await copyContent(selection, content) : buildInsertion(content, files);
  if ('waiting' in built) return built;
  if ('error' in built) throw new Error(built.error);
  const source = selection?.document;
  const doc: CmsDocument = {
    kind: 'document',
    tree: { type: 'root', children: structuredClone(built.nodes) as Root['children'] },
    meta: { origin: source?.meta.origin ?? 'html', fileName: source?.meta.fileName, styles: [], warnings: [] },
    assets: {},
  };
  addBuiltAssets(doc, built);
  if (content.kind !== 'selection') {
    doc.meta.snippetAssets = [...(doc.meta.snippetAssets ?? []), { key: 'cms-insert@1', name: 'Insert', css: INSERT_CSS }];
  }
  return { document: doc, warnings: built.warnings };
}

/** Attribute on preview-only markers; the preview ignores marked elements when it measures text. */
export const PREVIEW_ONLY = 'dataCmsPreview';

/** A copy of `doc` with a marker where the insertion will go (for the preview). */
export async function markInsertionPoint(doc: CmsDocument, where: InsertWhere, block: boolean): Promise<CmsDocument> {
  const targets = insertionTargets(doc, where, block);
  if (targets.matches.length === 0) return doc;
  const blockMarker = targets.matches.some((m) => m.kind === 'nodes') && targets.place !== 'start' && targets.place !== 'end';
  const marker = (): ElementContent[] => [
    blockMarker || block
      ? el('div', { [PREVIEW_ONLY]: '', className: ['cms-insert-marker'] }, [text('Insertion goes here')])
      : el('span', { [PREVIEW_ONLY]: '', className: ['cms-insert-caret'], title: 'Insertion goes here' }),
  ];
  return (await place(doc, targets, marker)).document;
}

export const INSERT_MARKER_CSS = `
.cms-insert-marker { margin: .4rem 0; padding: .3rem .6rem; border: 2px dashed #0d9488; border-radius: 6px; color: #0f766e;
  background: #f0fdfa; font: 600 12px/1.4 system-ui, sans-serif; }
.cms-insert-caret { display: inline-block; width: 3px; height: 1.1em; vertical-align: text-bottom; background: #0d9488; margin: 0 1px;
  border-radius: 2px; box-shadow: 0 0 0 3px rgba(13, 148, 136, .25); }
`;

/** A summary of what an insertion is, for node labels. */
export function describeInsertion(content: InsertContent): string {
  switch (content.kind) {
    case 'code':
      return `${content.render === 'html' ? 'HTML code' : `Code${content.language ? ` (${content.language})` : ''}`}${content.css?.trim() || content.js?.trim() ? ' + CSS/JS' : ''}`;
    case 'text':
      return content.as === 'inline' ? 'Text' : 'Text paragraphs';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'imageUrl':
      return 'Linked image';
    case 'videoUrl':
      return 'Linked video';
    case 'selection':
      return content.wrap === 'section' ? 'Content (labelled section)' : content.wrap === 'div' ? 'Content (in a box)' : 'Content from another node';
  }
}

function toBase64(data: StoredFile['data']): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// ---------------------------------------------------------------------------------------------
// Picking a point in the preview

const BLOCK_NAMES: Record<string, string> = {
  p: 'paragraph', li: 'list item', blockquote: 'quote', td: 'table cell', th: 'table cell', pre: 'code block',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', figure: 'figure',
  dt: 'term', dd: 'definition', summary: 'summary', div: 'block', section: 'section', aside: 'box', article: 'article',
};

/** A friendly name for a block element: "paragraph", "heading", "list item", ... */
export const blockName = (tagName: string) => BLOCK_NAMES[tagName] ?? tagName;

/** The block a cursor offset is in (a cursor at the very end of a block belongs to that block). */
function caretBlock(doc: CmsDocument, offset: number) {
  const ix = indexDocument(doc);
  const t = ix.text.text;
  const at = offset > 0 && (offset >= t.length || t[offset] === '\n') ? offset - 1 : offset;
  const block = enclosingBlock(ix, Math.max(0, at));
  if (!block) return undefined;
  const node = nodeAt(doc, block);
  const tagName = node?.type === 'element' ? node.tagName : 'block';
  return { ix, block, tagName, range: rangeOf(ix, block) ?? { start: offset, end: offset } };
}

/** What a cursor in the preview is in, for labels such as "After this paragraph". */
export function caretTarget(doc: CmsDocument, offset: number): { tagName: string; name: string } | undefined {
  const b = caretBlock(doc, offset);
  return b && { tagName: b.tagName, name: BLOCK_NAMES[b.tagName] ?? b.tagName };
}

/** How much text next to the cursor is saved, so the point can be found again after edits. */
const CARET_CONTEXT = 24;

/**
 * An insertion point from a cursor offset: "cursor" anchors the text right before the cursor (or after it,
 * at the start of a block) and inserts next to it; "before" / "after" anchor the whole block.
 */
export function insertionPointAt(doc: CmsDocument, offset: number, choice: 'cursor' | 'before' | 'after'): InsertionPoint | undefined {
  const b = caretBlock(doc, offset);
  if (!b) return undefined;
  const { ix, block, range } = b;
  if (choice !== 'cursor' || range.end === range.start) {
    return { anchor: createAnchor(ix, block), place: choice === 'before' ? 'before' : 'after' };
  }
  const at = Math.min(Math.max(offset, range.start), range.end);
  if (at > range.start) {
    // Start the saved text at a word boundary, so it does not begin halfway through a word.
    let start = Math.max(range.start, at - CARET_CONTEXT);
    const t = ix.text.text;
    if (start > range.start && /\w/.test(t[start - 1] ?? '')) {
      const next = t.slice(start, at).search(/\W\w/);
      if (next !== -1) start += next + 1;
    }
    return { anchor: createAnchor(ix, { kind: 'text', start, end: at }), place: 'after' };
  }
  return { anchor: createAnchor(ix, { kind: 'text', start: at, end: Math.min(range.end, at + CARET_CONTEXT) }), place: 'before' };
}
