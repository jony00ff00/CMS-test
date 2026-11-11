// Generates the "Two outputs" example: one Word document (a garden's year in figures, with three pictures and three
// data tables) makes two pages. The static page draws the tables as charts once and keeps the pictures; the
// interactive page's charts animate in and show values on hover, and each picture becomes a short looping video.
// The pictures and videos are drawn by scripts/make-example-media.py (examples/two-outputs/).
// Run with `npm run example:two-outputs`. Writes examples/two-outputs/garden-year.docx and
// examples/two-outputs.node-cms.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { storeFile, type CanvasNote, type Graph, type GraphEdge, type GraphNode, type NodeGroup, type Snippet } from '../src/engine';
import { seedLibrary } from '../src/snippets/seed';
import { toProjectFile } from '../src/store/project';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const media = join(dir, 'two-outputs');
export const WORD_FILE = join(media, 'garden-year.docx');
export const PROJECT_FILE = join(dir, 'two-outputs.node-cms.json');

/** The three pictures: file name, alternative text, caption, and the word the Selectors find them by. */
export const PICTURES = [
  { name: 'garden-dawn', alt: 'The vegetable beds at dawn, with the sun rising behind the hills', caption: 'The beds at dawn in May.', find: 'dawn' },
  { name: 'bee-hives', alt: 'Three bee hives by the hedge, with bees flying around them', caption: 'Our three hives, kept by volunteers since March.', find: 'hives' },
  { name: 'rain-ponds', alt: 'Rain falling on the two ponds at the bottom of the garden', caption: 'Autumn rain filling the ponds.', find: 'rain' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const TABLES = [
  { title: 'Harvest by month', chart: 'bar', head: ['Month', 'Harvest (kg)'], rows: MONTHS.map((m, i) => [m, [4, 6, 15, 32, 58, 96, 140, 152, 118, 64, 21, 8][i]]) },
  {
    title: 'Rainfall and soil moisture',
    chart: 'line',
    head: ['Month', 'Rainfall (mm)', 'Soil moisture (%)'],
    rows: MONTHS.map((m, i) => [m, [78, 61, 55, 47, 52, 44, 38, 41, 57, 82, 96, 88][i], [64, 60, 55, 49, 43, 37, 31, 30, 38, 52, 63, 66][i]]),
  },
  { title: 'Where the harvest went', chart: 'donut', head: ['Destination', 'Share (%)'], rows: [['Volunteers', 38], ['Food bank', 31], ['Market stall', 19], ['Compost', 12]] },
] as const;

/** The Word document: what an editor writes. */
export async function wordDocument(): Promise<Buffer> {
  const picture = (p: (typeof PICTURES)[number]) => [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: 'png',
          data: readFileSync(join(media, `${p.name}.png`)),
          transformation: { width: 480, height: 270 },
          altText: { name: p.name, title: p.alt, description: p.alt },
        }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: p.caption, italics: true })] }),
  ];
  const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
  const table = (t: (typeof TABLES)[number]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ tableHeader: true, children: t.head.map((h) => cell(h, true)) }), ...t.rows.map((r) => new TableRow({ children: r.map((v) => cell(String(v))) }))],
    });
  const p = (text: string) => new Paragraph({ children: [new TextRun(text)] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'A year at Riverside Community Garden', heading: HeadingLevel.HEADING_1 }),
          p('Our volunteers grew more food than ever this year, kept bees for the first time and dug two ponds. These are the figures.'),
          ...picture(PICTURES[0]),
          new Paragraph({ text: TABLES[0].title, heading: HeadingLevel.HEADING_2 }),
          p('The harvest peaked in August, when the tomatoes, beans and courgettes all came in at once: 152 kg in one month.'),
          table(TABLES[0]),
          ...picture(PICTURES[1]),
          new Paragraph({ text: TABLES[1].title, heading: HeadingLevel.HEADING_2 }),
          p('A dry summer pulled the soil moisture down to 30% in August; the ponds and the autumn rain brought it back.'),
          table(TABLES[1]),
          ...picture(PICTURES[2]),
          new Paragraph({ text: TABLES[2].title, heading: HeadingLevel.HEADING_2 }),
          p('Most of the harvest went home with the volunteers who grew it, and nearly a third to the food bank.'),
          table(TABLES[2]),
          p('Figures from the garden’s own records, January to December.'),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/**
 * The chart script: draws each `figure.cms-chart` from the table inside it (kept, hidden from view, for screen
 * readers). `interactive`: bars grow, lines draw and the donut fills in when the chart scrolls into view (not for
 * people who prefer reduced motion), and hovering shows the values.
 */
export function chartScript(interactive: boolean): string {
  return `(function () {
  var INTERACTIVE = ${interactive};
  var NS = 'http://www.w3.org/2000/svg';
  var COLORS = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#7c3aed'];
  var still = !INTERACTIVE || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }
  function read(table) {
    var rows = Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
      return Array.prototype.map.call(tr.querySelectorAll('th, td'), function (c) { return c.textContent.trim(); });
    });
    var head = rows.shift();
    return {
      head: head,
      units: head.map(function (h) { var m = /\\(([^)]+)\\)/.exec(h); return m ? m[1] : ''; }),
      names: head.map(function (h) { return h.replace(/\\s*\\([^)]*\\)/, ''); }),
      labels: rows.map(function (r) { return r[0]; }),
      series: head.slice(1).map(function (_, i) { return rows.map(function (r) { return parseFloat(r[i + 1]) || 0; }); }),
    };
  }
  function nice(max) {
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.ceil(max / step) * step;
    return top / max > 1.6 ? Math.ceil(max / (step / 2)) * (step / 2) : top;
  }
  function tooltip(fig) {
    var tip = document.createElement('div');
    tip.className = 'cms-chart-tip';
    tip.hidden = true;
    fig.appendChild(tip);
    return {
      show: function (html, evt) {
        tip.innerHTML = html;
        tip.hidden = false;
        var box = fig.getBoundingClientRect();
        tip.style.left = Math.min(evt.clientX - box.left + 12, box.width - tip.offsetWidth - 4) + 'px';
        tip.style.top = (evt.clientY - box.top - tip.offsetHeight - 10) + 'px';
      },
      hide: function () { tip.hidden = true; },
    };
  }
  function legend(fig, names) {
    var ul = document.createElement('ul');
    ul.className = 'cms-chart-legend';
    names.forEach(function (n, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span style="background:' + COLORS[i % COLORS.length] + '"></span>' + n;
      ul.appendChild(li);
    });
    fig.appendChild(ul);
  }
  // Charts start drawn (static) or start empty and animate once they are in view (interactive).
  function reveal(fig, run) {
    if (still) return run();
    fig.classList.add('is-waiting');
    var go = function () { fig.classList.remove('is-waiting'); requestAnimationFrame(function () { requestAnimationFrame(run); }); };
    if (!('IntersectionObserver' in window)) return go();
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); }
    }, { threshold: 0.3 });
    io.observe(fig);
  }
  var W = 600, H = 310, L = 48, R = 16, T = 30, B = 36;
  function axes(svg, top, labels, unit) {
    for (var i = 0; i <= 4; i++) {
      var y = T + (H - T - B) * (1 - i / 4);
      el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'cms-chart-grid' }, svg);
      text(svg, L - 8, y + 4, String(Math.round(top * i / 4)), { 'text-anchor': 'end', class: 'cms-chart-axis' });
    }
    if (unit) text(svg, L - 8, T - 16, unit, { 'text-anchor': 'end', class: 'cms-chart-axis' });
    var band = (W - L - R) / labels.length;
    labels.forEach(function (l, i) { text(svg, L + band * (i + 0.5), H - B + 18, l, { 'text-anchor': 'middle', class: 'cms-chart-axis' }); });
    return band;
  }
  var draw = {
    bar: function (fig, svg, d) {
      var values = d.series[0], top = nice(Math.max.apply(null, values)), band = axes(svg, top, d.labels, d.units[1]);
      var tip = INTERACTIVE && tooltip(fig);
      var bars = values.map(function (v, i) {
        var h = (H - T - B) * v / top, x = L + band * i + band * 0.15, w = band * 0.7;
        var bar = el('rect', { x: x, width: w, y: still ? H - B - h : H - B, height: still ? h : 0, rx: 3, fill: COLORS[0], class: 'cms-chart-bar' }, svg);
        if (!still) bar.style.transitionDelay = (i * 45) + 'ms';
        if (tip) {
          bar.addEventListener('mousemove', function (e) { tip.show('<strong>' + d.labels[i] + '</strong> ' + v + ' ' + d.units[1], e); fig.classList.add('is-hovering'); bar.classList.add('is-active'); });
          bar.addEventListener('mouseleave', function () { tip.hide(); fig.classList.remove('is-hovering'); bar.classList.remove('is-active'); });
        }
        return { bar: bar, y: H - B - h, h: h };
      });
      reveal(fig, function () { bars.forEach(function (b) { b.bar.setAttribute('y', b.y); b.bar.setAttribute('height', b.h); }); });
    },
    line: function (fig, svg, d) {
      var all = [].concat.apply([], d.series), top = nice(Math.max.apply(null, all)), band = axes(svg, top, d.labels, '');
      var xs = d.labels.map(function (_, i) { return L + band * (i + 0.5); });
      var ys = function (v) { return T + (H - T - B) * (1 - v / top); };
      var paths = d.series.map(function (s, k) {
        var path = el('path', { d: s.map(function (v, i) { return (i ? 'L' : 'M') + xs[i] + ' ' + ys(v); }).join(' '), fill: 'none', stroke: COLORS[k], 'stroke-width': 3, class: 'cms-chart-line' }, svg);
        s.forEach(function (v, i) { el('circle', { cx: xs[i], cy: ys(v), r: 3.5, fill: COLORS[k], class: 'cms-chart-dot' }, svg); });
        return path;
      });
      legend(fig, d.head.slice(1));
      if (!still) paths.forEach(function (p) { var n = p.getTotalLength(); p.style.strokeDasharray = n; p.style.strokeDashoffset = n; });
      reveal(fig, function () { paths.forEach(function (p) { p.style.strokeDashoffset = 0; }); fig.classList.add('is-drawn'); });
      if (INTERACTIVE) {
        var tip = tooltip(fig), guide = el('line', { y1: T, y2: H - B, class: 'cms-chart-guide' }, svg);
        guide.style.display = 'none';
        var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
        hit.addEventListener('mousemove', function (e) {
          var box = svg.getBoundingClientRect(), x = (e.clientX - box.left) * W / box.width;
          var i = Math.max(0, Math.min(xs.length - 1, Math.round((x - L) / band - 0.5)));
          guide.setAttribute('x1', xs[i]); guide.setAttribute('x2', xs[i]); guide.style.display = '';
          tip.show('<strong>' + d.labels[i] + '</strong>' + d.series.map(function (s, k) { return '<br><span style="color:' + COLORS[k] + '">●</span> ' + d.names[k + 1] + ': ' + s[i] + ' ' + d.units[k + 1]; }).join(''), e);
        });
        hit.addEventListener('mouseleave', function () { tip.hide(); guide.style.display = 'none'; });
      }
    },
    donut: function (fig, svg, d) {
      var values = d.series[0], total = values.reduce(function (a, b) { return a + b; }, 0);
      var cx = W / 2, cy = H / 2, r = 100, C = 2 * Math.PI * r, start = 0;
      var tip = INTERACTIVE && tooltip(fig);
      var arcs = values.map(function (v, i) {
        var len = C * v / total;
        var arc = el('circle', { cx: cx, cy: cy, r: r, fill: 'none', stroke: COLORS[i % COLORS.length], 'stroke-width': 42, class: 'cms-chart-arc', transform: 'rotate(-90 ' + cx + ' ' + cy + ')' }, svg);
        arc.style.strokeDasharray = (still ? len : 0) + ' ' + C;
        arc.style.strokeDashoffset = -start;
        if (!still) arc.style.transitionDelay = (i * 150) + 'ms';
        if (tip) {
          arc.addEventListener('mousemove', function (e) { tip.show('<strong>' + d.labels[i] + '</strong> ' + v + d.units[1], e); arc.classList.add('is-active'); });
          arc.addEventListener('mouseleave', function () { tip.hide(); arc.classList.remove('is-active'); });
        }
        start += len;
        return { arc: arc, len: len };
      });
      text(svg, cx, cy + 6, d.names[1], { 'text-anchor': 'middle', class: 'cms-chart-centre' });
      legend(fig, d.labels.map(function (l, i) { return l + ' ' + values[i] + d.units[1]; }));
      reveal(fig, function () { arcs.forEach(function (a) { a.arc.style.strokeDasharray = a.len + ' ' + C; }); });
    },
  };
  Array.prototype.forEach.call(document.querySelectorAll('figure.cms-chart'), function (fig) {
    var table = fig.querySelector('table');
    var kind = draw[fig.getAttribute('data-chart')] ? fig.getAttribute('data-chart') : 'bar';
    if (!table || fig.querySelector('svg')) return;
    var d = read(table);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': d.head.join(', ') + ': see the table' });
    fig.insertBefore(svg, table);
    table.classList.add('cms-chart-table');
    draw[kind](fig, svg, d);
  });
})();`;
}

/** The charts' look; the interactive one adds the transitions and the hover styles. */
export function chartCss(interactive: boolean): string {
  const base = [
    'figure.cms-chart{position:relative;margin:1.25rem 0;padding:1rem;border:1px solid #e5e7eb;border-radius:10px;background:#fff}',
    'figure.cms-chart svg{display:block;width:100%;height:auto;font:12px system-ui,sans-serif}',
    '.cms-chart-grid{stroke:#e5e7eb}.cms-chart-axis{fill:#6b7280}.cms-chart-centre{fill:#374151;font-weight:600;font-size:15px}',
    '.cms-chart-table{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.cms-chart-legend{display:flex;flex-wrap:wrap;gap:.4rem 1rem;margin:.5rem 0 0;padding:0;list-style:none;font:13px system-ui,sans-serif;color:#374151}',
    '.cms-chart-legend span{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:2px}',
  ];
  const motion = [
    '.cms-chart-bar{transition:y .7s cubic-bezier(.2,.8,.2,1),height .7s cubic-bezier(.2,.8,.2,1),opacity .2s}',
    '.cms-chart-line{transition:stroke-dashoffset 1.6s ease-in-out}',
    '.cms-chart-dot{opacity:0;transition:opacity .4s 1.2s}figure.cms-chart.is-drawn .cms-chart-dot{opacity:1}',
    '.cms-chart-arc{transition:stroke-dasharray .8s ease-out,stroke-width .2s}',
    'figure.is-hovering .cms-chart-bar{opacity:.35}figure.is-hovering .cms-chart-bar.is-active{opacity:1}',
    '.cms-chart-arc.is-active{stroke-width:52px;cursor:pointer}.cms-chart-bar{cursor:pointer}',
    '.cms-chart-guide{stroke:#9ca3af;stroke-dasharray:4 4}',
    '.cms-chart-tip{position:absolute;z-index:1;padding:.35rem .55rem;border-radius:6px;background:#111827;color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap}',
    '@media (prefers-reduced-motion:reduce){.cms-chart-bar,.cms-chart-line,.cms-chart-dot,.cms-chart-arc{transition:none}}',
    'figure.cms-chart video{display:block;max-width:100%}',
  ];
  return (interactive ? [...base, ...motion] : base).join('\n');
}

const chartSnippet = (interactive: boolean): Snippet => ({
  kind: 'snippet',
  id: interactive ? 'chart-interactive' : 'chart-static',
  name: interactive ? 'Chart (interactive)' : 'Chart (static)',
  description: interactive
    ? 'Draws the table as a chart that animates in and shows values on hover (the table stays for screen readers)'
    : 'Draws the table as a chart, without animation or hover (the table stays for screen readers)',
  version: 1,
  mode: 'wrap',
  template: '<figure class="cms-chart" data-chart="{{item params.types index}}">{{content}}</figure>',
  params: [{ name: 'types', label: 'Chart type for each table, in order (bar, line, donut)', type: 'text', default: TABLES.map((t) => t.chart).join(', ') }],
  css: chartCss(interactive),
  js: chartScript(interactive),
});

export function twoOutputsGraph(wordId: string, videoIds: string[], snippets: Snippet[]): Graph {
  const at = (col: number, row: number) => ({ x: 40 + col * 260, y: 60 + row * 190 });
  const lib = (id: string) => {
    const s = snippets.find((x) => x.id === id)!;
    return { snippet: structuredClone(s), ref: { id, version: s.version }, params: Object.fromEntries(s.params.map((p) => [p.name, p.default])) };
  };
  const nodes: GraphNode[] = [
    { id: 'word', type: 'documentSource', name: 'Garden report (Word)', position: at(0, 1.5), config: { fileId: wordId } },
    // The static page: tables → charts.
    { id: 'tables-static', type: 'selector', name: 'Data tables', position: at(1, 0), config: { mode: 'css', selector: 'table' } },
    { id: 'charts-static', type: 'snippet', name: 'Static charts', position: at(2, 0), config: lib('chart-static') },
    { id: 'static', type: 'output', name: 'Static page', position: at(3, 0), config: { format: 'html', fullDocument: true, inlineAssets: true } },
    // The interactive page: tables → interactive charts, then each picture → its video.
    { id: 'tables-interactive', type: 'selector', name: 'Data tables', position: at(1, 2), config: { mode: 'css', selector: 'table' } },
    { id: 'charts-interactive', type: 'snippet', name: 'Interactive charts', position: at(2, 2), config: lib('chart-interactive') },
  ];
  const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}.${sourcePort}>${target}.${targetPort}`, source, sourcePort, target, targetPort });
  const edges: GraphEdge[] = [
    edge('word', 'document', 'tables-static', 'document'),
    edge('tables-static', 'selection', 'charts-static', 'selection'),
    edge('charts-static', 'document', 'static', 'document'),
    edge('word', 'document', 'tables-interactive', 'document'),
    edge('tables-interactive', 'selection', 'charts-interactive', 'selection'),
  ];
  let previous = 'charts-interactive';
  PICTURES.forEach((p, i) => {
    const col = 3 + i * 2;
    nodes.push(
      { id: `picture-${p.find}`, type: 'selector', name: `Picture: ${p.find}`, position: at(col, 2), config: { mode: 'image', text: p.find } },
      {
        id: `video-${p.find}`,
        type: 'object',
        name: `Video: ${p.find}`,
        position: at(col, 3),
        config: { content: { kind: 'video', fileId: videoIds[i], autoplay: true, loop: true, muted: true } },
      },
      { id: `swap-${p.find}`, type: 'replace', name: `Picture → video (${p.find})`, position: at(col + 1, 2), config: {} },
    );
    edges.push(
      edge(previous, 'document', `picture-${p.find}`, 'document'),
      edge(`picture-${p.find}`, 'selection', `swap-${p.find}`, 'selection'),
      edge(`video-${p.find}`, 'document', `swap-${p.find}`, 'content'),
    );
    previous = `swap-${p.find}`;
  });
  nodes.push({ id: 'interactive', type: 'output', name: 'Interactive page', position: at(9, 2), config: { format: 'html', fullDocument: true, inlineAssets: true } });
  edges.push(edge(previous, 'document', 'interactive', 'document'));
  const groups: NodeGroup[] = [
    { id: 'group-static', name: 'Static page', nodeIds: ['tables-static', 'charts-static', 'static'], color: '#2563eb' },
    { id: 'group-charts', name: 'Interactive charts', nodeIds: ['tables-interactive', 'charts-interactive'], color: '#7c3aed' },
    { id: 'group-videos', name: 'Pictures become videos', nodeIds: PICTURES.flatMap((p) => [`picture-${p.find}`, `video-${p.find}`, `swap-${p.find}`]), color: '#059669' },
  ];
  const notes: CanvasNote[] = [
    {
      id: 'note-1',
      text: 'One Word document, two pages.\nTop: static charts and pictures. Bottom: the same figures as charts that animate and show values on hover, and the pictures as short videos.\nEdit the Word file once; both pages follow.',
      position: { x: 40, y: -110 },
      width: 520,
    },
  ];
  return { nodes, edges, groups, notes };
}

export async function buildTwoOutputsExample() {
  const word = storeFile('garden-year.docx', new Uint8Array(readFileSync(WORD_FILE)), 'garden-word');
  const videos = PICTURES.map((p) => storeFile(`${p.name}.webm`, new Uint8Array(readFileSync(join(media, `${p.name}.webm`))), `video-${p.find}`));
  const snippets = [chartSnippet(false), chartSnippet(true)];
  const library = seedLibrary();
  for (const s of snippets) library[s.id] = [structuredClone(s)];
  const files = Object.fromEntries([word, ...videos].map((f) => [f.id, f]));
  return toProjectFile({ graph: twoOutputsGraph(word.id, videos.map((v) => v.id), snippets), files, library }, new Date('2026-11-11T00:00:00Z'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(WORD_FILE, await wordDocument());
  writeFileSync(PROJECT_FILE, `${JSON.stringify(await buildTwoOutputsExample(), null, 2)}\n`);
  console.log('wrote examples/two-outputs/garden-year.docx and examples/two-outputs.node-cms.json');
}
