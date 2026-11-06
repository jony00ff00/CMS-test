// Import PowerPoint (.pptx) files: each slide becomes a <section class="slide">, in the deck's order.
//
// A .pptx is a zip of XML parts. The deck's slide list (ppt/presentation.xml) and its relationships give the
// order; each slide's shapes give titles, text, bullets and lists; notes pages give speaker notes. Placeholders
// that do not say what they are (title, body, ...) are looked up in the slide's layout.
// JSZip and xmldom are loaded on demand (mammoth uses them too, so .docx and .pptx share them).
import type JSZipType from 'jszip';
import { parseHtml } from './document';
import { hashBytes } from './hash';
import type { Asset, CmsDocument, PptxSlideInfo } from './types';

export interface PptxOptions {
  fileName?: string;
  /** Speaker notes as <aside class="speaker-notes"> at the end of each slide. Default true. */
  includeNotes?: boolean;
  /** Slides hidden in the deck. Default false. */
  includeHidden?: boolean;
  /** Which slides, by their number in the deck, e.g. "1-5, 8". Empty: all. */
  slides?: string;
  /** Add `SLIDE_CSS`, so slides look like slides (cards with a number), in the preview and the exported page. Default true. */
  slideStyles?: boolean;
}

/**
 * Slides as cards with their number, notes in a muted box, simple table and picture styles. The labels come from
 * CSS (`::before`), so they are not part of the text: selections and offsets are the same with or without them.
 */
export const SLIDE_CSS = [
  'section.slide{position:relative;box-sizing:border-box;max-width:960px;margin:1.25rem auto;padding:2.4rem 2rem 1.5rem;border:1px solid #d8dbe2;border-radius:10px;background:#fff;box-shadow:0 1px 3px rgb(15 23 42/.08)}',
  'section.slide::before{content:"Slide " attr(data-slide);position:absolute;top:.75rem;left:2rem;font:600 .7rem/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a7f8a}',
  'section.slide[data-hidden]::before{content:"Slide " attr(data-slide) " \\00b7  hidden"}',
  'section.slide>h1:first-child,section.slide>h2:first-child{margin-top:0}',
  'section.slide .subtitle{font-size:1.15em;color:#555}',
  '.speaker-notes{margin-top:1.25rem;padding:.6rem .8rem;border-radius:6px;background:#f6f7f9;color:#555;font-size:.9em}',
  '.speaker-notes::before{content:"Notes";display:block;margin-bottom:.25rem;font:600 .7rem/1.2 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a7f8a}',
  '.speaker-notes p{margin:.25rem 0}',
  'section.slide table{border-collapse:collapse;margin:.75rem 0}',
  'section.slide th,section.slide td{border:1px solid #d8dbe2;padding:.35rem .6rem;text-align:left;vertical-align:top}',
  'section.slide th{background:#f6f7f9}',
  'section.slide figure{margin:.75rem 0}section.slide img{max-width:100%;height:auto}',
  '.slide-chart figcaption{margin-top:.3rem;font-size:.85em;color:#555}',
].join('\n');

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

/** Placeholder types that are not content (they repeat on every slide). */
const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);

/** "1-5, 8" → the slide numbers, or a warning. Numbers outside 1..count are ignored with a warning. */
export function parseSlideRange(input: string | undefined, count: number): { slides?: Set<number>; warnings: string[] } {
  const warnings: string[] = [];
  if (!input?.trim()) return { warnings };
  const slides = new Set<number>();
  for (const part of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) {
      warnings.push(`"${part}" is not a slide number or range (e.g. 2-5)`);
      continue;
    }
    let [from, to] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (from > to) [from, to] = [to, from];
    for (let n = from; n <= to; n++) {
      if (n >= 1 && n <= count) slides.add(n);
    }
    if (from < 1 || to > count) warnings.push(`The deck has ${count} slide${count === 1 ? '' : 's'}: "${part}" goes beyond that`);
  }
  if (slides.size === 0 && warnings.length === 0) warnings.push('No slides chosen');
  return { slides, warnings };
}

/** The other way round: [1, 2, 3, 5, 7, 8] → "1-3, 5, 7-8". */
export function formatSlideRange(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Small XML helpers (xmldom elements; localName so prefixes do not matter)

type XmlElement = Element;

const kids = (el: XmlElement | null | undefined, name?: string): XmlElement[] => {
  const out: XmlElement[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as XmlElement).localName === name)) out.push(n as XmlElement);
  }
  return out;
};
const kid = (el: XmlElement | null | undefined, name: string) => kids(el, name)[0];
/** An attribute's value, or undefined when it is missing (xmldom returns "" for missing attributes). */
const attr = (el: XmlElement | null | undefined, name: string): string | undefined => (el?.hasAttribute(name) ? el.getAttribute(name)! : undefined);
/** A relationship id (r:id), whatever prefix the file uses for the relationships namespace. */
const relId = (el: XmlElement | null | undefined, name = 'id'): string | undefined =>
  el?.hasAttributeNS(NS.r, name) ? el.getAttributeNS(NS.r, name)! : attr(el, `r:${name}`);
const path = (el: XmlElement | null | undefined, ...names: string[]) => names.reduce<XmlElement | undefined>((e, n) => kid(e, n), el ?? undefined);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Resolve a relationship target ("../slides/slide1.xml") against the part that refers to it. */
function resolveTarget(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const relsPathOf = (part: string) => {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

// ---------------------------------------------------------------------------------------------

interface Paragraph {
  level: number;
  list: 'bullet' | 'number' | 'none';
  html: string;
}

interface Shape {
  /** "block": already rendered (a table, picture, chart, SmartArt). */
  kind: 'title' | 'subtitle' | 'body' | 'text' | 'block';
  /** For "title": a centred title (title slides). */
  centred?: boolean;
  /** In a placeholder (comes right after the title in reading order). */
  placeholder?: boolean;
  y: number;
  x: number;
  paragraphs: Paragraph[];
  html?: string;
}

/** What reading a slide needs from the package. */
interface SlideContext {
  slide: number;
  layoutTypes: Map<string, string>;
  rels: Map<string, Rel>;
  warnings: string[];
  xml: (part: string) => Promise<XmlElement | undefined>;
  partRels: (part: string) => Promise<Map<string, Rel>>;
  bytes: (part: string) => Promise<Uint8Array | undefined>;
  assets: Record<string, Asset>;
}

/** Picture types browsers show, by file extension. */
const PICTURE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
};
/** 1 px = 9525 EMU (English Metric Units, PowerPoint's unit). */
const EMU_PER_PX = 9525;

export async function importPptx(data: ArrayBuffer | Uint8Array, options: PptxOptions = {}): Promise<CmsDocument> {
  const name = options.fileName ?? 'the .pptx file';
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Old .ppt files and password-protected .pptx files are OLE compound files, not zips.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error(
      `${name} is an older PowerPoint file (.ppt) or is password protected. Open it in PowerPoint and save it as .pptx without a password.`,
    );
  }
  const [{ default: JSZip }, { DOMParser }] = await Promise.all([import('jszip'), import('@xmldom/xmldom')]);
  let zip: JSZipType;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(`Could not read ${name}: it is not a valid .pptx file`);
  }
  const warnings: string[] = [];
  const assets: Record<string, Asset> = {};
  const bytesOf = async (part: string) => zip.file(part)?.async('uint8array');
  const parser = new DOMParser({ errorHandler: { warning: () => {} } });
  const xmlCache = new Map<string, XmlElement | undefined>();
  const xml = async (part: string): Promise<XmlElement | undefined> => {
    if (xmlCache.has(part)) return xmlCache.get(part);
    const file = zip.file(part);
    const root = file ? (parser.parseFromString(await file.async('string'), 'application/xml').documentElement as unknown as XmlElement) : undefined;
    xmlCache.set(part, root ?? undefined);
    return root ?? undefined;
  };
  const rels = async (part: string): Promise<Map<string, Rel>> => {
    const out = new Map<string, Rel>();
    for (const r of kids(await xml(relsPathOf(part)), 'Relationship')) {
      const external = attr(r, 'TargetMode') === 'External';
      const target = attr(r, 'Target') ?? '';
      out.set(attr(r, 'Id') ?? '', { type: (attr(r, 'Type') ?? '').split('/').pop() ?? '', target: external ? target : resolveTarget(part, target), external });
    }
    return out;
  };

  const presentationPart = 'ppt/presentation.xml';
  const presentation = await xml(presentationPart);
  if (!presentation) throw new Error(`Could not read ${name}: it has no presentation part (is it a PowerPoint file?)`);
  const presRels = await rels(presentationPart);
  const slideParts = kids(kid(presentation, 'sldIdLst'), 'sldId')
    .map((s) => presRels.get(relId(s) ?? ''))
    .filter((r): r is Rel => !!r && r.type === 'slide' && !!zip.file(r.target))
    .map((r) => r.target);

  const range = parseSlideRange(options.slides, slideParts.length);
  warnings.push(...range.warnings);
  const includeNotes = options.includeNotes ?? true;
  const slidesInfo: PptxSlideInfo[] = [];
  const html: string[] = [];

  // Placeholder types from layouts, by layout part and placeholder idx.
  const layoutTypes = new Map<string, Map<string, string>>();
  const layoutInfo = async (layoutPart: string | undefined) => {
    if (!layoutPart) return { types: new Map<string, string>(), name: undefined as string | undefined };
    if (!layoutTypes.has(layoutPart)) {
      const types = new Map<string, string>();
      for (const sp of descendants(await xml(layoutPart), 'sp')) {
        const ph = path(sp, 'nvSpPr', 'nvPr', 'ph');
        if (attr(ph, 'idx')) types.set(attr(ph, 'idx')!, attr(ph, 'type') ?? 'body');
      }
      layoutTypes.set(layoutPart, types);
    }
    return { types: layoutTypes.get(layoutPart)!, name: attr(kid(await xml(layoutPart), 'cSld'), 'name') };
  };

  for (const [i, part] of slideParts.entries()) {
    const number = i + 1;
    const slide = await xml(part);
    if (!slide) continue;
    const hidden = attr(slide, 'show') === '0';
    const slideRels = await rels(part);
    const layoutPart = [...slideRels.values()].find((r) => r.type === 'slideLayout')?.target;
    const layout = await layoutInfo(layoutPart);
    const shapes = await readShapes(path(slide, 'cSld', 'spTree'), {
      slide: number,
      layoutTypes: layout.types,
      rels: slideRels,
      warnings,
      xml,
      partRels: rels,
      bytes: bytesOf,
      assets,
    });
    const title = shapes.find((s) => s.kind === 'title');
    const titleText = title ? plain(title.paragraphs.map((p) => p.html).join(' ')) : '';
    const included = (!hidden || !!options.includeHidden) && (!range.slides || range.slides.has(number));
    slidesInfo.push({ number, title: titleText || undefined, hidden, included, layout: layout.name });
    if (!included) continue;

    const attrs = [`class="slide"`, `data-slide="${number}"`];
    if (layout.name) attrs.push(`data-layout="${escapeHtml(layout.name)}"`);
    if (hidden) attrs.push('data-hidden=""');
    const body: string[] = [];
    for (const shape of order(shapes)) body.push(renderShape(shape));
    if (includeNotes) {
      const notesPart = [...slideRels.values()].find((r) => r.type === 'notesSlide')?.target;
      const notes = notesPart ? await readNotes(await xml(notesPart), await rels(notesPart)) : [];
      if (notes.some((p) => plain(p.html).trim())) body.push(`<aside class="speaker-notes">${renderParagraphs(notes, 'text')}</aside>`);
    }
    html.push(`<section ${attrs.join(' ')}>${body.join('')}</section>`);
  }

  if (slideParts.length === 0) warnings.push(`${name} has no slides`);
  else if (html.length === 0) warnings.push('No slides are included (they are hidden or outside the chosen range)');

  const doc = parseHtml(html.join('\n'), { fileName: options.fileName, origin: 'pptx' });
  doc.meta.title = slidesInfo.find((s) => s.included && s.title)?.title ?? doc.meta.title;
  doc.meta.warnings.push(...warnings);
  doc.assets = assets;
  if (options.slideStyles ?? true) doc.meta.styles.push(SLIDE_CSS);
  doc.meta.pptx = { slideCount: slideParts.length, slides: slidesInfo };
  return doc;
}

function descendants(el: XmlElement | undefined, name: string): XmlElement[] {
  if (!el) return [];
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of kids(e)) {
      if (c.localName === name) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** The content on a slide (groups read through), with each shape's position for reading order. */
async function readShapes(tree: XmlElement | undefined, ctx: SlideContext): Promise<Shape[]> {
  const shapes: Shape[] = [];
  const visit = async (container: XmlElement | undefined) => {
    for (const el of kids(container)) {
      switch (el.localName) {
        case 'grpSp':
          await visit(el);
          break;
        case 'sp': {
          const ph = path(el, 'nvSpPr', 'nvPr', 'ph');
          const type = ph ? (attr(ph, 'type') ?? ctx.layoutTypes.get(attr(ph, 'idx') ?? '') ?? 'body') : undefined;
          if (type && SKIPPED_PLACEHOLDERS.has(type)) break;
          const txBody = kid(el, 'txBody');
          if (!txBody) break;
          const kind: Shape['kind'] =
            type === 'title' || type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'subtitle' : type ? 'body' : 'text';
          const paragraphs = readParagraphs(txBody, kind === 'body', ctx.rels);
          if (!paragraphs.some((p) => plain(p.html).trim())) break;
          shapes.push({ kind, centred: type === 'ctrTitle', ...position(path(el, 'spPr', 'xfrm')), paragraphs });
          break;
        }
        case 'pic': {
          const html = await readPicture(el, ctx);
          if (html) shapes.push({ kind: 'block', placeholder: !!path(el, 'nvPicPr', 'nvPr', 'ph'), ...position(path(el, 'spPr', 'xfrm')), paragraphs: [], html });
          break;
        }
        case 'graphicFrame': {
          const html = await readGraphicFrame(el, ctx);
          if (html) shapes.push({ kind: 'block', placeholder: !!path(el, 'nvGraphicFramePr', 'nvPr', 'ph'), ...position(kid(el, 'xfrm')), paragraphs: [], html });
          break;
        }
        default:
          break;
      }
    }
  };
  await visit(tree);
  return shapes;
}

const position = (xfrm: XmlElement | undefined) => {
  const off = kid(xfrm, 'off');
  return { x: Number(attr(off, 'x') ?? 0), y: Number(attr(off, 'y') ?? 0) };
};

/** A picture: stored as an asset (once per image), with its alt text, size and link. */
async function readPicture(pic: XmlElement, ctx: SlideContext): Promise<string | undefined> {
  const props = path(pic, 'nvPicPr', 'cNvPr');
  const nvPr = path(pic, 'nvPicPr', 'nvPr');
  if (kid(nvPr, 'videoFile') || kid(nvPr, 'audioFile') || kids(path(nvPr, 'extLst')).some((e) => descendants(e, 'media').length)) {
    ctx.warnings.push(`Slide ${ctx.slide}: a ${kid(nvPr, 'audioFile') ? 'sound' : 'video'} is not imported yet`);
    return undefined;
  }
  const rel = ctx.rels.get(relId(path(pic, 'blipFill', 'blip'), 'embed') ?? '');
  if (!rel || rel.external) {
    ctx.warnings.push(`Slide ${ctx.slide}: a picture ${rel?.external ? 'linked from outside the file' : 'without image data'} was left out`);
    return undefined;
  }
  const ext = rel.target.split('.').pop()?.toLowerCase() ?? '';
  const type = PICTURE_TYPES[ext];
  if (!type) {
    ctx.warnings.push(`Slide ${ctx.slide}: a .${ext} picture was left out (browsers cannot show ${ext.toUpperCase()} images)`);
    return undefined;
  }
  const data = await ctx.bytes(rel.target);
  if (!data) {
    ctx.warnings.push(`Slide ${ctx.slide}: a picture's file is missing from the deck`);
    return undefined;
  }
  const id = `pptx-${hashBytes(data)}`;
  ctx.assets[id] ??= { id, contentType: type, base64: toBase64(data) };
  const alt = attr(props, 'descr') ?? attr(props, 'title') ?? '';
  const cx = Number(attr(path(pic, 'spPr', 'xfrm', 'ext'), 'cx') ?? 0);
  const width = cx > 0 ? ` width="${Math.round(cx / EMU_PER_PX)}"` : '';
  let img = `<img src="asset:${id}" alt="${escapeHtml(alt)}"${width}>`;
  const link = ctx.rels.get(relId(kid(props, 'hlinkClick')) ?? '');
  if (link?.external && /^(https?:|mailto:)/i.test(link.target)) img = `<a href="${escapeHtml(link.target)}">${img}</a>`;
  return `<figure class="slide-picture">${img}</figure>`;
}

/** Tables, charts (as a table of their data), SmartArt (as a list); other objects are reported. */
async function readGraphicFrame(frame: XmlElement, ctx: SlideContext): Promise<string | undefined> {
  const data = path(frame, 'graphic', 'graphicData');
  const uri = attr(data, 'uri') ?? '';
  if (kid(data, 'tbl')) return renderTable(kid(data, 'tbl')!, ctx.rels);
  if (uri.endsWith('/chart')) {
    const part = ctx.rels.get(relId(kid(data, 'chart')) ?? '')?.target;
    const chart = part ? await ctx.xml(part) : undefined;
    const html = chart ? renderChart(chart) : undefined;
    ctx.warnings.push(`Slide ${ctx.slide}: a chart ${html ? 'is shown as a table of its data' : 'could not be read and was left out'}`);
    return html;
  }
  if (uri.endsWith('/diagram')) {
    const part = ctx.rels.get(relId(kid(data, 'relIds'), 'dm') ?? '')?.target;
    const model = part ? await ctx.xml(part) : undefined;
    const html = model ? renderSmartArt(model, part ? await ctx.partRels(part) : new Map()) : undefined;
    ctx.warnings.push(`Slide ${ctx.slide}: SmartArt ${html ? 'is shown as a list of its text' : 'has no text and was left out'}`);
    return html;
  }
  ctx.warnings.push(`Slide ${ctx.slide}: an embedded object was left out`);
  return undefined;
}

function cellContent(tc: XmlElement, rels: Map<string, Rel>): string {
  const paragraphs = readParagraphs(kid(tc, 'txBody') ?? tc, false, rels).filter((p) => plain(p.html).trim());
  // One plain paragraph goes straight into the cell; more keep their paragraphs and lists.
  if (paragraphs.length === 1 && paragraphs[0].list === 'none') return paragraphs[0].html;
  return renderParagraphs(paragraphs, 'text');
}

/** A table, with merged cells as colspan / rowspan and the first row as headers when the table says so. */
function renderTable(tbl: XmlElement, rels: Map<string, Rel>): string {
  const header = attr(kid(tbl, 'tblPr'), 'firstRow') === '1';
  const rows = kids(tbl, 'tr').map((tr, r) => {
    const th = header && r === 0;
    const cells = kids(tr, 'tc')
      // Cells covered by a merged cell are listed too, marked hMerge / vMerge: they are not separate cells.
      .filter((tc) => attr(tc, 'hMerge') !== '1' && attr(tc, 'vMerge') !== '1')
      .map((tc) => {
        const span = [
          Number(attr(tc, 'gridSpan') ?? 1) > 1 ? ` colspan="${attr(tc, 'gridSpan')}"` : '',
          Number(attr(tc, 'rowSpan') ?? 1) > 1 ? ` rowspan="${attr(tc, 'rowSpan')}"` : '',
        ].join('');
        const tag = th ? 'th' : 'td';
        return `<${tag}${span}>${cellContent(tc, rels)}</${tag}>`;
      });
    return `<tr>${cells.join('')}</tr>`;
  });
  const [first, ...rest] = rows;
  return header
    ? `<table><thead>${first ?? ''}</thead><tbody>${rest.join('')}</tbody></table>`
    : `<table><tbody>${rows.join('')}</tbody></table>`;
}

const texts = (el: XmlElement | undefined) => descendants(el, 't').map((t) => t.textContent ?? '').join('');

/** A chart's title and cached data (categories × series) as a table. */
function renderChart(chartSpace: XmlElement): string | undefined {
  const chart = kid(chartSpace, 'chart');
  const title = texts(kid(chart, 'title')).trim();
  const series = descendants(kid(chart, 'plotArea'), 'ser');
  if (series.length === 0) return title ? `<figure class="slide-chart"><figcaption>${escapeHtml(title)}</figcaption></figure>` : undefined;
  const points = (el: XmlElement | undefined) => {
    const out = new Map<number, string>();
    for (const pt of descendants(el, 'pt')) out.set(Number(attr(pt, 'idx') ?? 0), kid(pt, 'v')?.textContent ?? '');
    return out;
  };
  const names = series.map((ser, i) => descendants(kid(ser, 'tx'), 'v')[0]?.textContent ?? `Series ${i + 1}`);
  const cats = points(kid(series[0], 'cat'));
  const values = series.map((ser) => points(kid(ser, 'val') ?? kid(ser, 'yVal')));
  const count = Math.max(cats.size, ...values.map((v) => (v.size ? Math.max(...v.keys()) + 1 : 0)));
  const rows = Array.from({ length: count }, (_, i) =>
    `<tr><th>${escapeHtml(cats.get(i) ?? String(i + 1))}</th>${values.map((v) => `<td>${escapeHtml(v.get(i) ?? '')}</td>`).join('')}</tr>`,
  );
  return (
    `<figure class="slide-chart"><table><thead><tr><th></th>${names.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ''}</figure>`
  );
}

/** SmartArt's text, nested as the diagram's own hierarchy (its "parent of" connections). */
function renderSmartArt(model: XmlElement, rels: Map<string, Rel>): string | undefined {
  const pts = kids(kid(model, 'ptLst'), 'pt');
  const textOf = new Map<string, string>();
  let root: string | undefined;
  for (const pt of pts) {
    const type = attr(pt, 'type') ?? 'node';
    const id = attr(pt, 'modelId') ?? '';
    if (type === 'doc') root = id;
    if (type !== 'node' && type !== 'asst') continue;
    const html = readParagraphs(kid(pt, 't') ?? pt, false, rels)
      .map((p) => p.html)
      .filter((h) => plain(h).trim())
      .join('<br>');
    textOf.set(id, html);
  }
  const children = new Map<string, { id: string; ord: number }[]>();
  for (const cxn of kids(kid(model, 'cxnLst'), 'cxn')) {
    if ((attr(cxn, 'type') ?? 'parOf') !== 'parOf') continue;
    const src = attr(cxn, 'srcId') ?? '';
    children.set(src, [...(children.get(src) ?? []), { id: attr(cxn, 'destId') ?? '', ord: Number(attr(cxn, 'srcOrd') ?? 0) }]);
  }
  const list = (parent: string, depth: number): string => {
    if (depth > 20) return '';
    const items = (children.get(parent) ?? [])
      .sort((a, b) => a.ord - b.ord)
      .filter((c) => textOf.has(c.id))
      .map((c) => {
        const inner = list(c.id, depth + 1);
        return textOf.get(c.id) || inner ? `<li>${textOf.get(c.id) ?? ''}${inner}</li>` : '';
      })
      .filter(Boolean);
    return items.length ? `<ul>${items.join('')}</ul>` : '';
  };
  const html = root ? list(root, 0) : '';
  // No hierarchy to follow: every text in order.
  const flat = [...textOf.values()].filter((h) => plain(h).trim());
  if (html) return `<div class="slide-smartart">${html}</div>`;
  return flat.length ? `<div class="slide-smartart"><ul>${flat.map((h) => `<li>${h}</li>`).join('')}</ul></div>` : undefined;
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
}

/** Title first, then the other placeholders, then other shapes; each group top to bottom, left to right. */
function order(shapes: Shape[]): Shape[] {
  const rank = (s: Shape) => (s.kind === 'title' ? 0 : s.kind === 'subtitle' || s.kind === 'body' || s.placeholder ? 1 : 2);
  return [...shapes].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x);
}

function readParagraphs(txBody: XmlElement, bulletsByDefault: boolean, slideRels: Map<string, Rel>): Paragraph[] {
  return kids(txBody, 'p').map((p) => {
    const pPr = kid(p, 'pPr');
    const level = Math.min(8, Number(attr(pPr, 'lvl') ?? 0));
    const list: Paragraph['list'] = kid(pPr, 'buAutoNum')
      ? 'number'
      : kid(pPr, 'buChar') || kid(pPr, 'buBlip')
        ? 'bullet'
        : kid(pPr, 'buNone')
          ? 'none'
          : bulletsByDefault
            ? 'bullet'
            : 'none';
    const parts: string[] = [];
    for (const r of kids(p)) {
      if (r.localName === 'br') parts.push('<br>');
      else if (r.localName === 'r' || r.localName === 'fld') parts.push(renderRun(r, slideRels));
    }
    return { level, list, html: parts.join('') };
  });
}

function renderRun(r: XmlElement, slideRels: Map<string, Rel>): string {
  const text = kids(r, 't').map((t) => t.textContent ?? '').join('');
  if (!text) return '';
  let out = escapeHtml(text);
  const rPr = kid(r, 'rPr');
  const on = (name: string) => {
    const v = attr(rPr, name);
    return v === '1' || v === 'true';
  };
  if (attr(rPr, 'baseline') && Number(attr(rPr, 'baseline')) > 0) out = `<sup>${out}</sup>`;
  else if (attr(rPr, 'baseline') && Number(attr(rPr, 'baseline')) < 0) out = `<sub>${out}</sub>`;
  // Links are underlined anyway (and PowerPoint marks them so); <u> only for other text.
  if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none' && !kid(rPr, 'hlinkClick')) out = `<u>${out}</u>`;
  if (attr(rPr, 'strike') && attr(rPr, 'strike') !== 'noStrike') out = `<s>${out}</s>`;
  if (on('i')) out = `<em>${out}</em>`;
  if (on('b')) out = `<strong>${out}</strong>`;
  const linkId = relId(kid(rPr, 'hlinkClick'));
  const link = linkId ? slideRels.get(linkId) : undefined;
  // Only links to web pages and e-mail addresses; links to other slides or files are left as text.
  if (link?.external && /^(https?:|mailto:)/i.test(link.target)) out = `<a href="${escapeHtml(link.target)}">${out}</a>`;
  return out;
}

const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function renderShape(shape: Shape): string {
  if (shape.kind === 'block') return shape.html ?? '';
  if (shape.kind === 'title') {
    const tag = shape.centred ? 'h1' : 'h2';
    return `<${tag}>${shape.paragraphs.map((p) => p.html).filter((h) => plain(h).trim()).join('<br>')}</${tag}>`;
  }
  return renderParagraphs(shape.paragraphs, shape.kind === 'subtitle' ? 'subtitle' : 'text');
}

/** Paragraphs as <p>, and runs of list paragraphs as nested <ul> / <ol> by level. */
function renderParagraphs(paragraphs: Paragraph[], kind: 'text' | 'subtitle'): string {
  const out: string[] = [];
  // Open lists, innermost last: each has its tag and whether its last <li> is still open.
  const open: { tag: 'ul' | 'ol'; level: number }[] = [];
  const closeTo = (level: number) => {
    while (open.length && open[open.length - 1].level > level) out.push(`</li></${open.pop()!.tag}>`);
  };
  for (const p of paragraphs) {
    if (!plain(p.html).trim()) continue;
    if (p.list === 'none') {
      closeTo(-1);
      out.push(kind === 'subtitle' ? `<p class="subtitle">${p.html}</p>` : `<p>${p.html}</p>`);
      continue;
    }
    const tag = p.list === 'number' ? 'ol' : 'ul';
    closeTo(p.level);
    const top = open[open.length - 1];
    if (top && top.level === p.level && top.tag !== tag) {
      out.push(`</li></${open.pop()!.tag}>`);
    }
    const current = open[open.length - 1];
    if (current && current.level === p.level) {
      out.push(`</li><li>${p.html}`);
    } else {
      // A deeper level (or the first item): a new list, inside the open item when there is one.
      out.push(`<${tag}><li>${p.html}`);
      open.push({ tag, level: p.level });
    }
  }
  closeTo(-1);
  return out.join('');
}

async function readNotes(notes: XmlElement | undefined, notesRels: Map<string, Rel>): Promise<Paragraph[]> {
  if (!notes) return [];
  const out: Paragraph[] = [];
  for (const sp of descendants(path(notes, 'cSld', 'spTree'), 'sp')) {
    const type = attr(path(sp, 'nvSpPr', 'nvPr', 'ph'), 'type');
    if (type !== 'body') continue;
    const txBody = kid(sp, 'txBody');
    if (txBody) out.push(...readParagraphs(txBody, false, notesRels));
  }
  return out;
}
