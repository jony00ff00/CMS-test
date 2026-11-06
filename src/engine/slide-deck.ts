// "Slide deck" export: the document as slides, one at a time, with a small viewer
// (arrow keys, Page Up / Down, Space, Home / End, N for notes, #3 in the address opens slide 3).
//
// A document from a .pptx already has its slides (`section.slide`). Any other document is split into slides at
// its top-level h1 / h2 headings, so a Word file or a web page can be shown as a deck too.
// Without JavaScript the page is still readable: the viewer's CSS only applies once its script has run.
import type { ElementContent, RootContent } from 'hast';
import { indexDocument, slidesOf } from './doc-index';
import type { CmsDocument, SnippetAsset } from './types';

export interface SlideDeckResult {
  document: CmsDocument;
  slides: number;
  warnings: string[];
}

const isElement = (n: RootContent): n is Extract<RootContent, { type: 'element' }> => n.type === 'element';
const blank = (n: RootContent) => (n.type === 'text' && !n.value.trim()) || n.type === 'comment';

/** The document with slides: as it is when it has them, otherwise split at its top-level headings. */
export function toSlideDeck(doc: CmsDocument): SlideDeckResult {
  const warnings: string[] = [];
  const ix = indexDocument(doc);
  const slides = slidesOf(ix);
  if (slides.length) {
    // Content outside every slide (e.g. something inserted between slides) has no slide to be shown on.
    const outside = doc.tree.children.filter((n) => !blank(n) && !(isElement(n) && containsSlide(n)));
    if (outside.length) {
      warnings.push(
        `${outside.length} block${outside.length === 1 ? ' is' : 's are'} outside the slides, so ${outside.length === 1 ? 'it is' : 'they are'} not shown in the deck (they are in the page without JavaScript)`,
      );
    }
    return { document: withViewer(doc), slides: slides.length, warnings };
  }

  // Split at h1 / h2 (also when a snippet wrapped the heading, e.g. a callout that starts with it); content before
  // the first heading is a slide of its own.
  const groups: RootContent[][] = [];
  for (const n of doc.tree.children) {
    if (isElement(n) && startsWithHeading(n)) groups.push([n]);
    else if (groups.length) groups[groups.length - 1].push(n);
    else if (!blank(n)) groups.push([n]);
    else continue;
  }
  const nonEmpty = groups.filter((g) => g.some((n) => !blank(n)));
  if (nonEmpty.length === 0) {
    warnings.push('The document is empty, so the deck has no slides');
    return { document: withViewer(doc), slides: 0, warnings };
  }
  const tree = structuredClone(doc.tree);
  tree.children = nonEmpty.map((children, i) => ({
    type: 'element',
    tagName: 'section',
    properties: { className: ['slide'], dataSlide: String(i + 1) },
    children: structuredClone(children) as ElementContent[],
  }));
  warnings.push(
    nonEmpty.length === 1
      ? 'The document has no slides or top-level headings, so it is one slide'
      : `The document has no slides, so a new slide starts at each top-level heading (${nonEmpty.length} slides)`,
  );
  return { document: withViewer({ ...doc, tree }), slides: nonEmpty.length, warnings };
}

function startsWithHeading(el: Extract<RootContent, { type: 'element' }>, depth = 0): boolean {
  if (el.tagName === 'h1' || el.tagName === 'h2') return true;
  if (depth >= 3) return false;
  const first = el.children.find((c) => !(c.type === 'text' && !c.value.trim()) && c.type !== 'comment');
  return first?.type === 'element' && startsWithHeading(first, depth + 1);
}

function containsSlide(el: Extract<RootContent, { type: 'element' }>): boolean {
  const cls = el.properties.className;
  if (el.tagName === 'section' && Array.isArray(cls) && cls.includes('slide')) return true;
  return el.children.some((c) => c.type === 'element' && containsSlide(c));
}

function withViewer(doc: CmsDocument): CmsDocument {
  const assets = (doc.meta.snippetAssets ?? []).filter((a) => a.key !== DECK_VIEWER.key);
  return { ...doc, meta: { ...doc.meta, snippetAssets: [...assets, DECK_VIEWER] } };
}

const DECK_CSS = [
  'html.cms-deck,html.cms-deck body{height:100%}',
  'html.cms-deck body{margin:0;background:#1f2430;display:flex;align-items:center;justify-content:center;overflow:hidden}',
  'html.cms-deck .cms-deck-off,html.cms-deck section.slide:not(.cms-current){display:none!important}',
  // Every slide is laid out at 960 × 540 and scaled to fit the window (--cms-deck-scale, set by the script),
  // so it looks the same in a small preview and full screen.
  'html.cms-deck section.slide.cms-current{display:block;position:fixed;left:50%;top:calc(50% - 1.4rem);box-sizing:border-box;width:960px;height:540px;max-width:none;margin:0;padding:2.5rem 3rem;overflow:auto;background:#fff;color:#111;border-radius:8px;font-size:20px;transform:translate(-50%,-50%) scale(var(--cms-deck-scale,1))}',
  'html.cms-deck .speaker-notes{display:none}',
  'html.cms-deck.cms-notes .speaker-notes{display:block}',
  '.cms-deck-bar{display:none}',
  'html.cms-deck .cms-deck-bar{display:flex;position:fixed;left:50%;bottom:.6rem;transform:translateX(-50%);gap:.4rem;align-items:center;padding:.3rem .5rem;border-radius:999px;background:rgb(255 255 255/.12);color:#fff;font:14px/1 system-ui,sans-serif}',
  '.cms-deck-bar button{font:inherit;color:inherit;background:transparent;border:1px solid rgb(255 255 255/.35);border-radius:999px;padding:.3rem .7rem;cursor:pointer}',
  '.cms-deck-bar button:hover,.cms-deck-bar button[aria-pressed="true"]{background:rgb(255 255 255/.2)}',
  '.cms-deck-bar button:disabled{opacity:.4;cursor:default}',
  '.cms-deck-count{min-width:4.5em;text-align:center;font-variant-numeric:tabular-nums}',
].join('\n');

/**
 * The viewer. It receives the page's document and window as `d` and `w` (passed in at the end), so this file holds
 * no browser code of its own. The bar is marked data-cms-preview, so the editor's preview does not count its text.
 */
const DECK_JS = `(function (d, w) {
  var slides = [].slice.call(d.querySelectorAll('section.slide'));
  if (!slides.length) return;
  var root = d.documentElement;
  root.classList.add('cms-deck');
  // What to show for a slide: its top-level block (the slide, or a wrapper around it); everything else is hidden.
  var top = function (el) { while (el.parentElement && el.parentElement !== d.body) el = el.parentElement; return el; };
  var tops = slides.map(top);
  [].slice.call(d.body.children).forEach(function (el) { if (tops.indexOf(el) < 0) el.classList.add('cms-deck-off'); });
  var bar = d.createElement('nav');
  bar.className = 'cms-deck-bar';
  bar.setAttribute('aria-label', 'Slides');
  bar.setAttribute('data-cms-preview', '');
  bar.innerHTML = '<button type="button" data-go="-1" aria-label="Previous slide">&#8249;</button>' +
    '<span class="cms-deck-count" aria-live="polite"></span>' +
    '<button type="button" data-go="1" aria-label="Next slide">&#8250;</button>' +
    '<button type="button" class="cms-deck-notes" aria-pressed="false" title="Speaker notes (N)">Notes</button>';
  d.body.appendChild(bar);
  var count = bar.querySelector('.cms-deck-count');
  var notesButton = bar.querySelector('.cms-deck-notes');
  var buttons = bar.querySelectorAll('[data-go]');
  var current = 0;
  var show = function (n) {
    current = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle('cms-current', k === current); });
    tops.forEach(function (t) { t.classList.toggle('cms-deck-off', t !== tops[current]); });
    count.textContent = (current + 1) + ' / ' + slides.length;
    buttons[0].disabled = current === 0;
    buttons[1].disabled = current === slides.length - 1;
    try { w.history.replaceState(null, '', '#' + (current + 1)); } catch (e) { /* not allowed here (e.g. a sandboxed preview) */ }
  };
  var notes = function (on) {
    root.classList.toggle('cms-notes', on);
    notesButton.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b === notesButton) notes(!root.classList.contains('cms-notes'));
    else show(current + Number(b.getAttribute('data-go')));
  });
  d.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.altKey || e.ctrlKey || e.metaKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') show(current + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') show(current - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else if (k === 'n' || k === 'N') notes(!root.classList.contains('cms-notes'));
    else return;
    e.preventDefault();
  });
  var fit = function () {
    var scale = Math.min((w.innerWidth - 24) / 960, (w.innerHeight - 64) / 540);
    root.style.setProperty('--cms-deck-scale', String(Math.max(0.1, scale)));
  };
  w.addEventListener('resize', fit);
  fit();
  var fromHash = parseInt(String(w.location.hash).slice(1), 10);
  show(fromHash > 0 ? fromHash - 1 : 0);
})(document, window);`;

/** Added to the document like a snippet's CSS and JS, so `serialize` writes it into the page. */
export const DECK_VIEWER: SnippetAsset = { key: 'cms-slide-deck@1', name: 'Slide deck', css: DECK_CSS, js: DECK_JS };
