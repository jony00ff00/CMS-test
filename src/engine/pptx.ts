// Import PowerPoint (.pptx) files: each slide becomes a <section class="slide">, in the deck's order.
//
// A .pptx is a zip of XML parts. The deck's slide list (ppt/presentation.xml) and its relationships give the
// order; each slide's shapes give titles, text, bullets and lists; notes pages give speaker notes. Placeholders
// that do not say what they are (title, body, ...) are looked up in the slide's layout.
// JSZip and xmldom are loaded on demand (mammoth uses them too, so .docx and .pptx share them).
import type JSZipType from 'jszip';
import { parseHtml } from './document';
import type { CmsDocument, PptxSlideInfo } from './types';

export interface PptxOptions {
  fileName?: string;
  /** Speaker notes as <aside class="speaker-notes"> at the end of each slide. Default true. */
  includeNotes?: boolean;
  /** Slides hidden in the deck. Default false. */
  includeHidden?: boolean;
  /** Which slides, by their number in the deck, e.g. "1-5, 8". Empty: all. */
  slides?: string;
}

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
const relId = (el: XmlElement | null | undefined): string | undefined => (el?.hasAttributeNS(NS.r, 'id') ? el.getAttributeNS(NS.r, 'id')! : attr(el, 'r:id'));
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
  kind: 'title' | 'subtitle' | 'body' | 'text';
  /** For "title": a centred title (title slides). */
  centred?: boolean;
  y: number;
  x: number;
  paragraphs: Paragraph[];
}

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
    const shapes = readShapes(path(slide, 'cSld', 'spTree'), layout.types, slideRels, warnings, number);
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

/** The shapes with text on a slide (groups read through), with their position for reading order. */
function readShapes(tree: XmlElement | undefined, layoutTypes: Map<string, string>, slideRels: Map<string, Rel>, warnings: string[], slide: number): Shape[] {
  const shapes: Shape[] = [];
  const unsupported = new Set<string>();
  const visit = (container: XmlElement | undefined) => {
    for (const el of kids(container)) {
      switch (el.localName) {
        case 'grpSp':
          visit(el);
          break;
        case 'sp': {
          const ph = path(el, 'nvSpPr', 'nvPr', 'ph');
          const type = ph ? (attr(ph, 'type') ?? layoutTypes.get(attr(ph, 'idx') ?? '') ?? 'body') : undefined;
          if (type && SKIPPED_PLACEHOLDERS.has(type)) break;
          const txBody = kid(el, 'txBody');
          if (!txBody) break;
          const kind: Shape['kind'] =
            type === 'title' || type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'subtitle' : type ? 'body' : 'text';
          const off = path(el, 'spPr', 'xfrm', 'off');
          const paragraphs = readParagraphs(txBody, kind === 'body', slideRels);
          if (!paragraphs.some((p) => plain(p.html).trim())) break;
          shapes.push({ kind, centred: type === 'ctrTitle', y: Number(attr(off, 'y') ?? 0), x: Number(attr(off, 'x') ?? 0), paragraphs });
          break;
        }
        case 'graphicFrame': {
          const uri = attr(path(el, 'graphic', 'graphicData'), 'uri') ?? '';
          unsupported.add(uri.includes('table') ? 'table' : uri.includes('chart') ? 'chart' : uri.includes('diagram') ? 'SmartArt' : 'embedded object');
          break;
        }
        case 'pic':
          unsupported.add('picture');
          break;
        default:
          break;
      }
    }
  };
  visit(tree);
  // Pictures and tables come in the next step (P2); say what was left out until then.
  for (const what of unsupported) warnings.push(`Slide ${slide}: a ${what} is not imported yet`);
  return shapes;
}

/** Title first, then the other placeholders, then other shapes; each group top to bottom, left to right. */
function order(shapes: Shape[]): Shape[] {
  const rank = (s: Shape) => (s.kind === 'title' ? 0 : s.kind === 'subtitle' || s.kind === 'body' ? 1 : 2);
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
