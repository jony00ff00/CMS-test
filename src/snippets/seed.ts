// The snippets a new project starts with. Content, not engine code: the code block's JavaScript runs in
// the published page.
import { DEFAULT_SNIPPET, type Snippet, type SnippetLibrary } from '../engine';

const css = (...rules: string[]) => rules.join('\n');

export const SEED_SNIPPETS: Snippet[] = [
  DEFAULT_SNIPPET,
  {
    kind: 'snippet',
    id: 'details',
    name: 'Collapsible details',
    description: 'Hides the content behind a clickable summary',
    version: 1,
    mode: 'wrap',
    template: '<details class="cms-details"{{#if params.open}} open{{/if}}>\n  <summary>{{params.summary}}</summary>\n  {{content}}\n</details>',
    params: [
      { name: 'summary', label: 'Summary', type: 'text', default: 'Show more' },
      { name: 'open', label: 'Open at first', type: 'boolean', default: false },
    ],
    css: css(
      '.cms-details{border:1px solid #d4d4d8;border-radius:6px;padding:.5rem .9rem;margin:1rem 0}',
      '.cms-details>summary{cursor:pointer;font-weight:600}',
      '.cms-details[open]>summary{margin-bottom:.5rem}',
    ),
  },
  {
    kind: 'snippet',
    id: 'highlight',
    name: 'Highlight',
    description: 'Marks text like a highlighter pen',
    version: 1,
    mode: 'wrap',
    template: '<mark class="cms-hl cms-hl-{{params.color}}">{{content}}</mark>',
    params: [{ name: 'color', label: 'Colour', type: 'select', options: ['yellow', 'green', 'pink'], default: 'yellow' }],
    css: css(
      '.cms-hl{padding:0 .15em;border-radius:3px}',
      '.cms-hl-yellow{background:#fef08a}',
      '.cms-hl-green{background:#bbf7d0}',
      '.cms-hl-pink{background:#fbcfe8}',
    ),
  },
  {
    kind: 'snippet',
    id: 'tooltip',
    name: 'Tooltip',
    description: 'Shows a note when the pointer is over the text',
    version: 1,
    mode: 'wrap',
    template: '<span class="cms-tip" tabindex="0" data-tip="{{params.tip}}">{{content}}</span>',
    params: [{ name: 'tip', label: 'Tooltip text', type: 'text', default: 'More about this' }],
    css: css(
      '.cms-tip{position:relative;border-bottom:1px dotted currentColor;cursor:help}',
      '.cms-tip::after{content:attr(data-tip);position:absolute;left:0;bottom:125%;z-index:1;white-space:nowrap;' +
        'background:#111827;color:#fff;font-size:.8rem;padding:.25rem .5rem;border-radius:4px;opacity:0;pointer-events:none;transition:opacity .15s}',
      '.cms-tip:hover::after,.cms-tip:focus::after{opacity:1}',
    ),
  },
  {
    kind: 'snippet',
    id: 'code-block',
    name: 'Code block',
    description: 'Shows the text as code, with a copy button',
    version: 1,
    mode: 'replace',
    template: '<pre class="cms-code" data-language="{{params.language}}"><code>{{text}}</code></pre>',
    params: [{ name: 'language', label: 'Language', type: 'select', options: ['text', 'html', 'css', 'javascript', 'json', 'shell'], default: 'text' }],
    css: css(
      '.cms-code{position:relative;background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:6px;overflow:auto;font-size:.9rem}',
      '.cms-code::before{content:attr(data-language);position:absolute;top:.3rem;right:4.5rem;font-size:.7rem;color:#94a3b8}',
      '.cms-copy{position:absolute;top:.35rem;right:.4rem;font-size:.75rem;padding:.1rem .5rem;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer}',
    ),
    js: [
      'document.querySelectorAll("pre.cms-code").forEach(function (pre) {',
      '  var button = document.createElement("button");',
      '  button.className = "cms-copy";',
      '  button.type = "button";',
      '  button.textContent = "Copy";',
      '  button.addEventListener("click", function () {',
      '    var done = function (ok) { button.textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { button.textContent = "Copy"; }, 1500); };',
      '    try { navigator.clipboard.writeText(pre.querySelector("code").textContent).then(function () { done(true); }, function () { done(false); }); }',
      '    catch (e) { done(false); }',
      '  });',
      '  pre.appendChild(button);',
      '});',
    ].join('\n'),
  },
];

export function seedLibrary(): SnippetLibrary {
  return Object.fromEntries(SEED_SNIPPETS.map((s) => [s.id, [structuredClone(s)]]));
}
