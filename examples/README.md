# Example projects

Open a project with **Open project…** in the app; the first one also opens with the **Two documents**
button. Both projects below are made by `npm run example:scrolly`; run it
after changing a file in `scrolly/` (a test fails while a project file is out of date).

## A scrolly from Word text and HTML code

`ge16-scrolly.node-cms.json` puts the text written in Word (`scrolly/ge16-scrolly-short-text.docx`) into the code of a
scrollytelling graphic (`scrolly/ge16-scrolly-short.html`: its markup, CSS and JavaScript, made by a developer). Both
files are inside the project file; they are here on their own too. Writers change the Word document, developers
change the HTML, and the project puts the two together again: choose the new file in either Document Source.

It makes two pages from the same filled code: an **interactive** one (the scrolly, as its code makes it) and a
**static** one (the same text as an article: no graphic and no JavaScript, with the data tables shown).

| Node | What it does |
| --- | --- |
| **Scrolly code (HTML)** (Document Source) | Loads the code. "Keep its scripts and styles (code you trust)" is on, so its `<style>` and `<script>` stay inside `<ge16-scrolly>`, where the script expects them. |
| **Scrolly text (Word)** (Document Source) | Loads the text. Its Word style rules turn the document's own styles Kicker, Title and Dek into `p.kicker`, `p.title` and `p.dek`. |
| **Fill the scrolly** (Fill template) | One row per slot: `.gs-kicker` ← `.kicker`, `.gs-headline` ← `.title`, `.gs-dek` ← `.dek` (all three required), a **repeat** of `.gs-step` with one card per Word heading that contains "Step" (its `.gs-card` gets what is under the heading; the heading is a label for writers and is left out; at least one step), and the footer (the note and the link's text; the link keeps its address). |
| **Interactive page** (Output) | The scrolly; the preview runs the graphic. "Don't download while there are problems" is on. |
| **Static version** group | **Graphic and its code** (Selector: the element's `<script>` and `<style>`, and `.gs-graphic`; it expects all three) → **Leave them out** (Insert: in place of each match, with nothing connected to Content, so they are removed) → **Article look** (a custom Snippet: a `div.gs-static` around the page, with its own CSS for the header, the steps as paragraphs, the tables and the footer). |
| **Static page** (Output) | The article: the same header, step text, tables and footer, with no script (a few kB). Problems with the text show here too. |

The step cards follow the Word document: a writer who adds a step gets another card, and one who removes a step loses
one. Card *i* keeps the code's own card *i* (its `data-step`, which the script uses for the graphic's state); extra
steps copy the last card, so they show the last state until a developer adds a state for them. A missing kicker,
headline or dek, or no steps at all, is a problem: the page is still shown, with the problem on the node, the Output and
the preview, and it cannot be downloaded until it is fixed.

The Word document's text has been rewritten since the HTML file was made (new headline, dek, step text and footer
note); the project puts the new text into the code, which is the point: the code does not change when the text does.

Rules for the writers: keep the Kicker, Title and Dek styles on the first three paragraphs, start each step with a
heading that contains "Step", and keep "Footer" as the last heading. Bold, italics and links in the text come through.

## The scrolly made from the Word text alone

`ge16-scrolly-from-text.node-cms.json` has one file, the Word document, and turns that plain text into the finished
scrolly page. Nothing is combined: the code is in the project's **snippet library** (six snippets, "Scrolly step
card", "Scrolly graphic and steps", "Scrolly header", "Link", "Scrolly footer and tables" and "GE16 scrolly
element"), and the nodes put it around the text step by step. The page it makes has the same markup as
`scrolly/ge16-scrolly-short.html`, with the Word document's text (which has been rewritten since the HTML file was
made: new headline, dek, step headings and paragraphs).

The Word document's own paragraph styles become the code's classes in **Scrolly text (Word)** (its Word style rules:
Kicker → `p.gs-kicker`, Title → `h2.gs-headline`, Dek → `p.gs-dek`, and the writers' Note is left out). Then each
Selector picks part of the document as the step before left it, and the Snippet after it changes that part:

| Group | Selector → Snippet | What happens |
| --- | --- | --- |
| Steps | **Step text** (under each heading containing "Step") → **Step cards** | Each step's text goes into `<article class="gs-step" data-step="…"><div class="gs-card">`. The names (`tie`, `distribution`, …) are the snippet's "Step names, in order" setting: the script looks the steps up by name. |
| | **Writers' headings** (`h2:not(.gs-headline)`) → **Remove them** | The "Step …" and "Footer" headings are for the writers; they go. |
| | **All step cards** (`.gs-step`, "Join neighbouring matches into one") → **Graphic and steps** | The ten cards, as one, go into `.gs-steps`, next to the graphic's markup. |
| Header | **Header text** (joined) → **Header**; **Headline** → **Headline id** | `<header class="gs-intro">` around kicker, headline and dek; the headline gets `id="gs-headline"`. |
| Footer | **Link text** → **Link**; **Footer text** (`.gs-scroller ~ p`, joined) → **Tables and footer** | "Read the full brief" becomes a link; the tables for screen readers and `<footer class="gs-footer">` come after the graphic. |
| Element, CSS and JS | **Everything** → **Scrolly element** | `<ge16-scrolly id="ge16-scrolly" …>` around it all, with the graphic's CSS and JavaScript. A few lines before the script put a copy of the CSS inside the element (the script moves it into its shadow root). |

**Scrolly page** (Output) is the finished page. To change the code, edit the snippets in the library (Snippet node
→ "Edit in library") and save a new version; the nodes then offer the update. To change the text, choose a new Word
document in **Scrolly text (Word)**. The rules for writers are the same as above.

## One Word document, two outputs

`two-outputs.node-cms.json` (made by `npm run example:two-outputs`, button **Two outputs**) turns one Word document,
`two-outputs/garden-year.docx` ("A year at Riverside Community Garden": text and three tables of figures, no
pictures), into two pages. Editors change only the Word file; both pages follow. The pictures and videos are not in
the document: the CMS adds them.

One flow makes both pages (six nodes). The **Interactive page** Output is a *page variant* ("interactive"), and two
nodes have their own settings for it (shown on the canvas as "Own settings: interactive"; pick the page under
"Settings for" in a node's inspector to see or change them):

| Node | Static page (the nodes' own settings) | Interactive page (its own settings) |
| --- | --- | --- |
| **Data tables** (Selector `table`) | The three tables | (same) |
| **Charts** (Snippet) | "Chart (static)": each table is drawn once as a chart (bar, line, donut: the snippet's "Chart type for each table" setting), with no animation or hover | "Chart (interactive)": the bars grow, the lines draw and the donut fills in when the chart scrolls into view (not for people who prefer reduced motion), and hovering shows the values |
| **Pictures and videos** (Insert, three items) | A picture at each place (after the introduction, before "Rainfall and soil moisture", before "Where the harvest went"), with its alternative text and caption | A short looping video (autoplaying, muted) at the same places, with the same captions |

Each item has its own place, so a heading the writer renames or removes shows up as a problem on that page.
In both pages, the table stays (hidden from view) for screen readers. The pictures and videos
(`two-outputs/*.png`, `*.webm`) are drawn by `scripts/make-example-media.py` (Pillow and ffmpeg).
