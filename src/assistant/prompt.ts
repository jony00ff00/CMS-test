// The messages sent to the language model: what the nodes are, what the project holds now, and the person's request.
import type { Graph, NodeRegistry, SnippetLibrary, StoredFile } from '../engine';
import { latestVersion } from '../engine';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** What each node's settings mean, in the words the model needs (the registry gives ports and descriptions). */
const SETTINGS: Record<string, string> = {
  documentSource: `{ "file": "<a file name from Files>" }. Optional: "html": { "keepCode": true } keeps a trusted HTML file's scripts and styles; "docx": { "styleMap": ["p[style-name='Kicker'] => p.kicker"] }.`,
  selector: `A selector mode and its fields, plus optional "place" (before | after | start | end: where its Point output points, default after), "join" (true: neighbouring matches become one), "expect" ({ "min": n, "max": n }: another number of matches is a problem). Modes:
  { "mode": "css", "selector": "h2" }
  { "mode": "heading", "text": "Watering", "match": "contains" | "exact", "level": 2, "includeHeading": true } (a heading and everything up to the next heading of the same or higher level)
  { "mode": "regex", "pattern": "\\\\d+ cm", "flags": "i", "scope": "match" | "block" }
  { "mode": "all", "scope": "document" | "blocks" } (everything as one match, or each top-level block)
  { "mode": "image", "images": "1, 3-4", "text": "in the alt text", "scope": "image" | "frame" }
  { "mode": "slide", "slides": "2-5", "title": "contains", "part": "slide" | "title" | "content" | "notes" }
  { "mode": "jsonField", "path": "$.items[*].body" }
  "point" and "manual" are picked by hand in the preview: only use them when asked, and say so.`,
  snippet: `One of:
  { "library": "<snippet id from Snippet library>", "params": { "<name>": "<value>" } }
  { "custom": { "className": "card", "wrap": "none" | "div" | "span" }, "css": ".card{...}", "js": "..." } (adds classes to each match, or wraps it in a div / span with them)
  { "mode": "wrap" | "prepend" | "append" | "replace" | "attributes", "template": "<div class=\\"card\\">{{content}}</div>", "css": "..." } (its own Handlebars template: {{content}} is the matched content, also {{text}}, {{number}}, {{count}})
  Optional "documentScope": "document" | "blocks" when a whole document comes in.`,
  extractor: `Like a Selector (same modes and fields, not point), plus "keepContext" (default true). It outputs a document of only what it picked.`,
  object: `"content" is what it adds, one of:
  { "kind": "text", "text": "Plain text", "as": "paragraphs" | "inline" }
  { "kind": "code", "code": "<p>HTML</p>", "render": "html" | "block", "css": "...", "js": "..." }
  { "kind": "imageUrl", "url": "https://…", "alt": "…", "caption": "…", "width": "50%" }
  { "kind": "videoUrl", "url": "https://… (YouTube / Vimeo become embeds)", "caption": "…" }
  { "kind": "image", "file": "<file name>", "alt": "…", "caption": "…" } / { "kind": "video", "file": "<file name>" }
  { "kind": "selection", "wrap": "none" | "div" | "section", "styles": true, "headings": "keep" | "fit" } (content from another node: connect it to the "content" input)
  "place": before | after | start | end | replace | inside, relative to what comes into "where" (a Selector's "point" or "selection" output; default for a selection: replace). With "content" kind "selection" and nothing connected to "content", replace / inside remove what was matched.
  "pairs": true: match i gets part i of the content.
  Several things at different places: "items": [{ "id": "a", "label": "…", "selector": { a Selector mode }, "place": "after", "content": { … } }] with a document connected to "where".`,
  fillTemplate: `{ "rows": [ { "id": "r1", "slot": ".title", "from": { a Selector mode, in the content }, "target": "inside" | "element", "required": true }, { "id": "r2", "repeat": ".step", "items": { a Selector mode: each match is one item }, "rows": [ slot rows, filled from the item ], "min": 1 } ] }. Connect the page's code to "template" and the text to "content".`,
  output: `{ "format": "html" | "json" | "slides", "variant": "<page variant name>" (a second page from the same flow), "strict": true (no download while there are problems), "combine": "merge" | "append" (several inputs) }`,
  connector: `{} (turns whatever comes in into a document, selection, HTML or result).`,
};

/** The system message: the rules of the answer, the node types, and the project as it is now. */
export function systemPrompt(registry: NodeRegistry, graph: Graph, files: Record<string, StoredFile>, library: SnippetLibrary, selectedId?: string): string {
  const types = Object.values(registry).map((d) => {
    const ports = (list: typeof d.inputs) => (list.length ? list.map((p) => `${p.name} (${p.type}${p.optional ? ', optional' : ''}${p.multiple ? ', several' : ''})`).join(', ') : 'none');
    return `### ${d.type} — ${d.label}\n${d.description}.\nInputs: ${ports(d.inputs)}. Outputs: ${ports(d.outputs)}.\nSettings: ${SETTINGS[d.type] ?? 'see its defaults'}`;
  });
  const snippets = Object.keys(library).map((id) => {
    const s = latestVersion(library, id)!;
    const params = s.params.map((p) => `${p.name}${p.options ? ` (${p.options.join(' | ')})` : ''}`).join(', ');
    return `- ${id}: ${s.name}${s.description ? ` — ${s.description}` : ''} (${s.mode}${params ? `; params: ${params}` : ''})`;
  });
  const fileList = Object.values(files).map((f) => `- ${f.name}`);
  return `You build and change flows in Node CMS, a node-based content tool. Documents (.html, .docx, .pptx, .json) are loaded by Document Source nodes; Selectors pick parts of them; Snippets wrap or style those parts; Insert nodes add content; Fill template fills a page's code with text; Output nodes make the page. Nodes are joined from an output port to an input port; a port type must match the input's type, and an "any" input takes every type.

Answer with ONE JSON object and nothing else:
{ "reply": "one or two sentences for the person: what you did, or the answer to their question", "operations": [ … ] }
Operations, applied in order:
{ "op": "add", "id": "<a new short id, e.g. src1>", "type": "<node type>", "name": "<a short name>", "config": { …settings, only what differs from the defaults } }
{ "op": "connect", "from": "<node>", "fromPort": "<output port>", "to": "<node>", "toPort": "<input port>" }
{ "op": "disconnect", "from": "<node>", "to": "<node>" }
{ "op": "configure", "node": "<node>", "config": { …settings to change; null removes one } }
{ "op": "rename", "node": "<node>", "name": "<new name>" }
{ "op": "remove", "node": "<node>" }
"<node>" is an existing node's id or name, or the id you gave a node in an "add" earlier in the list. Only use node types, ports, files and snippets listed below. A flow needs an Output at the end to show a page. If the request is a question, or unclear, answer in "reply" with no operations. Keep flows small: add only the nodes the request needs, and connect every node you add.

## Node types
${types.join('\n\n')}

## Snippet library
${snippets.join('\n') || '(empty)'}

## Files in the project
${fileList.join('\n') || '(none: the person uploads files in a Document Source node; you can add the node without a file)'}

## The project now
${describeGraph(graph, registry, selectedId)}`;
}

/** The graph as the model sees it: each node with its settings and connections. */
export function describeGraph(graph: Graph, registry: NodeRegistry, selectedId?: string): string {
  if (!graph.nodes.length) return '(empty: no nodes yet)';
  const lines = graph.nodes.map((n) => {
    const label = registry[n.type]?.label ?? n.type;
    return `- ${n.id} [${n.type}: ${label}]${n.name ? ` named “${n.name}”` : ''}${n.id === selectedId ? ' (selected)' : ''}: ${short(n.type, n.config)}`;
  });
  const edges = graph.edges.map((e) => `- ${e.source}.${e.sourcePort} → ${e.target}.${e.targetPort}`);
  return `Nodes:\n${lines.join('\n')}\nConnections:\n${edges.join('\n') || '(none)'}`;
}

/** A node's settings, shortened: no snippet bodies or stored anchors, long text cut. */
function short(type: string, config: unknown): string {
  const c = { ...(config as Record<string, unknown>) };
  if (type === 'snippet') {
    const s = c.snippet as { name?: string; mode?: string; template?: string } | undefined;
    delete c.snippet;
    c.snippet = c.ref ? `library ${(c.ref as { id: string }).id}` : s ? `${s.name} (${s.mode}: ${s.template})` : undefined;
    delete c.ref;
  }
  if (Array.isArray(c.anchors)) c.anchors = `${c.anchors.length} picked by hand`;
  if (c.point) c.point = 'picked in the preview';
  const text = JSON.stringify(c, (_k, v) => (typeof v === 'string' && v.length > 160 ? `${v.slice(0, 160)}…` : v));
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

/** What to send back when the answer could not be used, so the model can correct it. */
export function repairMessage(errors: string[]): string {
  return `Some of that could not be done:\n${errors.map((e) => `- ${e}`).join('\n')}\nAnswer again with the whole corrected JSON object (all operations, not only the fixed ones).`;
}
