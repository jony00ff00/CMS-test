// Generates the "scrolly from Word text alone" example: the project has one file, the Word document with the text
// (examples/scrolly/ge16-scrolly-short-text.docx), and turns it into the finished scrollytelling page. The code
// (markup around the text, the graphic, CSS, JavaScript) lives in the project's snippets. This script takes those
// code pieces from the developer's file (examples/scrolly/ge16-scrolly-short.html) when it builds the project; the
// project does not use that file.
// Run with `npm run example:scrolly`. Writes examples/ge16-scrolly-from-text.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFile, type Graph, type GraphNode, type NodeGroup, type Snippet } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
export const CODE_FILE = join(dir, 'scrolly', 'ge16-scrolly-short.html');
export const TEXT_FILE = join(dir, 'scrolly', 'ge16-scrolly-short-text.docx');
export const PROJECT_FILE = join(dir, 'ge16-scrolly-from-text.node-cms.json');

/** The code pieces of the developer's file. */
export function codePieces(html = readFileSync(CODE_FILE, 'utf8')) {
  const between = (start: string, end: string) => {
    const a = html.indexOf(start);
    const b = html.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`${start} … ${end} not found in the code file`);
    return html.slice(a, b);
  };
  const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').trim();
  return {
    /** The graphic: the markup the script draws into. */
    graphic: strip(between('<div class="gs-graphic">', '<div class="gs-steps">').replace(/\s*$/, '')),
    /** The tables for screen readers. */
    tables: strip(between('<div class="gs-sr-only">', '<footer')),
    css: between('<style>', '</style>').slice('<style>'.length).trim(),
    js: between('<script>', '</script>').slice('<script>'.length).trim(),
    /** The step names the script knows, in order. */
    steps: [...html.matchAll(/<article class="gs-step" data-step="([^"]+)"/g)].map((m) => m[1]),
  };
}

/** The Word document's own paragraph styles become the code's classes; the writers' note is left out. */
const STYLE_MAP = [
  "p[style-name='Kicker'] => p.gs-kicker:fresh",
  "p[style-name='Title'] => h2.gs-headline:fresh",
  "p[style-name='Dek'] => p.gs-dek:fresh",
  "p[style-name='Note'] => !",
];

const snippet = (id: string, name: string, description: string, template: string, extra: Partial<Snippet> = {}): Snippet => ({
  kind: 'snippet',
  id,
  name,
  description,
  version: 1,
  mode: 'wrap',
  template,
  params: [],
  ...extra,
});

/** The code, as library snippets (so a developer can update them in one place, as new versions). */
export function scrollySnippets(code = codePieces()): Snippet[] {
  return [
    snippet(
      'gs-step-card',
      'Scrolly step card',
      'One step of the scrolly: a card, named so the script knows which graphic goes with it',
      '<article class="gs-step" data-step="{{item params.steps index}}"><div class="gs-card">{{content}}</div></article>',
      { params: [{ name: 'steps', label: 'Step names, in order', type: 'text', default: code.steps.join(', ') }] },
    ),
    snippet(
      'gs-scroller',
      'Scrolly graphic and steps',
      'The graphic, with the step cards scrolling past it',
      `<div class="gs-scroller">\n${code.graphic}\n<div class="gs-steps">{{content}}</div>\n</div>`,
    ),
    snippet('gs-intro', 'Scrolly header', 'The kicker, headline and dek above the graphic', '<header class="gs-intro">{{content}}</header>'),
    snippet('gs-link', 'Link', 'Makes the selected text a link', '<a href="{{params.href}}">{{content}}</a>', {
      params: [{ name: 'href', label: 'Address', type: 'text', default: '#full-brief' }],
    }),
    snippet(
      'gs-footer',
      'Scrolly footer and tables',
      'The tables for screen readers, and the footer around the notes',
      `${code.tables}\n<footer class="gs-footer">{{content}}</footer>`,
    ),
    snippet(
      'ge16-scrolly',
      'GE16 scrolly element',
      'The element around everything, with the graphic’s CSS and JavaScript',
      '<ge16-scrolly id="ge16-scrolly" role="region" aria-labelledby="gs-headline" style="display:block">{{content}}</ge16-scrolly>',
      {
        css: code.css,
        // The script moves the graphic into a shadow root and takes along the <style> inside the element. The CMS
        // writes snippet CSS in the page head (marked data-snippet), so first put a copy of it inside the element.
        // (Found by its mark, or by the comment the CMS puts before every snippet's CSS.)
        js: [
          '(function(){',
          "  var host = document.getElementById('ge16-scrolly');",
          "  var css = Array.from(document.querySelectorAll('head style')).filter(function (s) {",
          "    return s.getAttribute('data-snippet') === 'ge16-scrolly@1' || s.textContent.indexOf('/* ge16-scrolly@1 */') === 0;",
          '  })[0];',
          "  if (host && css && !host.querySelector('style')) host.appendChild(css.cloneNode(true));",
          '})();',
          code.js,
        ].join('\n'),
      },
    ),
  ];
}

export function scrollyFromTextGraph(textId: string, snippets: Snippet[]): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 250, y: 40 + row * 190 });
  const lib = (id: string, params?: Record<string, unknown>) => {
    const s = snippets.find((x) => x.id === id)!;
    return { snippet: structuredClone(s), ref: { id, version: s.version }, params: params ?? Object.fromEntries(s.params.map((p) => [p.name, p.default])) };
  };
  const own = (name: string, mode: Snippet['mode'], template: string) => ({ snippet: snippet(`own-${name.toLowerCase().replace(/\W+/g, '-')}`, name, '', template, { mode }) });
  const nodes: GraphNode[] = [
    { id: 'text', type: 'documentSource', name: 'Scrolly text (Word)', position: at(0, 1), config: { fileId: textId, docx: { styleMap: STYLE_MAP } } },

    // 1. Each step's text in a card, then the "Step …" and "Footer" headings (labels for the writers) go.
    { id: 'step-text', type: 'selector', name: 'Step text', position: at(1, 0), config: { mode: 'heading', text: 'Step', match: 'contains', includeHeading: false } },
    { id: 'step-cards', type: 'snippet', name: 'Step cards', position: at(1, 1), config: lib('gs-step-card') },
    { id: 'labels', type: 'selector', name: 'Writers’ headings', position: at(2, 0), config: { mode: 'css', selector: 'h2:not(.gs-headline)' } },
    { id: 'remove-labels', type: 'snippet', name: 'Remove them', position: at(2, 1), config: own('Remove', 'replace', '') },

    // 2. The cards, all together, go next to the graphic.
    { id: 'cards', type: 'selector', name: 'All step cards', position: at(3, 0), config: { mode: 'css', selector: '.gs-step', join: true } },
    { id: 'scroller', type: 'snippet', name: 'Graphic and steps', position: at(3, 1), config: lib('gs-scroller') },

    // 3. The header: kicker, headline (with the id the region is labelled by) and dek.
    { id: 'intro-text', type: 'selector', name: 'Header text', position: at(4, 0), config: { mode: 'css', selector: '.gs-kicker, .gs-headline, .gs-dek', join: true } },
    { id: 'intro', type: 'snippet', name: 'Header', position: at(4, 1), config: lib('gs-intro') },
    { id: 'headline', type: 'selector', name: 'Headline', position: at(5, 0), config: { mode: 'css', selector: '.gs-headline' } },
    { id: 'headline-id', type: 'snippet', name: 'Headline id', position: at(5, 1), config: own('Headline id', 'attributes', 'id="gs-headline"') },

    // 4. The footer: the link, then the tables and the footer around the last paragraphs.
    { id: 'link-text', type: 'selector', name: 'Link text', position: at(6, 0), config: { mode: 'regex', pattern: 'Read the full brief', flags: '' } },
    { id: 'link', type: 'snippet', name: 'Link', position: at(6, 1), config: lib('gs-link') },
    { id: 'footer-text', type: 'selector', name: 'Footer text', position: at(7, 0), config: { mode: 'css', selector: '.gs-scroller ~ p', join: true } },
    { id: 'footer', type: 'snippet', name: 'Tables and footer', position: at(7, 1), config: lib('gs-footer') },

    // 5. The element around everything, with the CSS and JavaScript.
    { id: 'everything', type: 'selector', name: 'Everything', position: at(8, 0), config: { mode: 'all', scope: 'document' } },
    { id: 'element', type: 'snippet', name: 'Scrolly element', position: at(8, 1), config: lib('ge16-scrolly') },

    { id: 'page', type: 'output', name: 'Scrolly page', position: at(9, 1), config: { format: 'html', fullDocument: true, inlineAssets: true } },
  ];
  const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  // A chain: each Selector reads the document as the step before left it, and its Snippet changes that.
  const chain: [string, string][] = [
    ['step-text', 'step-cards'], ['labels', 'remove-labels'], ['cards', 'scroller'], ['intro-text', 'intro'], ['headline', 'headline-id'],
    ['link-text', 'link'], ['footer-text', 'footer'], ['everything', 'element'],
  ];
  const edges = chain.flatMap(([sel, snip], i) => [
    edge(i === 0 ? 'text' : chain[i - 1][1], 'document', sel, 'document'),
    edge(sel, 'selection', snip, 'selection'),
  ]);
  edges.push(edge('element', 'document', 'page', 'document'));
  const groups: NodeGroup[] = [
    { id: 'group-steps', name: 'Steps', nodeIds: ['step-text', 'step-cards', 'labels', 'remove-labels', 'cards', 'scroller'], color: '#7c3aed' },
    { id: 'group-header', name: 'Header', nodeIds: ['intro-text', 'intro', 'headline', 'headline-id'], color: '#2563eb' },
    { id: 'group-footer', name: 'Footer', nodeIds: ['link-text', 'link', 'footer-text', 'footer'], color: '#0d9488' },
    { id: 'group-element', name: 'Element, CSS and JS', nodeIds: ['everything', 'element'], color: '#be185d' },
  ];
  return { nodes, edges, groups };
}

export function buildScrollyFromTextExample() {
  const text = storeFile('ge16-scrolly-short-text.docx', new Uint8Array(readFileSync(TEXT_FILE)), 'scrolly-text');
  const snippets = scrollySnippets();
  const library = seedLibrary();
  for (const s of snippets) library[s.id] = [structuredClone(s)];
  return toProjectFile({ graph: scrollyFromTextGraph(text.id, snippets), files: { [text.id]: text }, library }, new Date('2026-11-10T00:00:00Z'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(PROJECT_FILE, `${JSON.stringify(buildScrollyFromTextExample(), null, 2)}\n`);
  console.log('wrote examples/ge16-scrolly-from-text.node-cms.json');
}
