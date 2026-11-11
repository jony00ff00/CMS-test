# Example projects

Open a project with **Open project…** in the app; the first one also opens with the **Two documents**
button. Both projects below are made by `npm run example:scrolly`; run it
after changing a file in `scrolly/` (a test fails while a project file is out of date).

## A scrolly from Word text and HTML code

`ge16-scrolly.node-cms.json` puts the text written in Word (`scrolly/ge16-scrolly-short-text.docx`) into the code of a
scrollytelling graphic (`scrolly/ge16-scrolly-short.html`: its markup, CSS and JavaScript, made by a developer). Both
files are inside the project file; they are here on their own too. Writers change the Word document, developers
change the HTML, and the project puts the two together again: choose the new file in either Document Source.

| Node | What it does |
| --- | --- |
| **Scrolly code (HTML)** (Document Source) | Loads the code. "Keep its scripts and styles (code you trust)" is on, so its `<style>` and `<script>` stay inside `<ge16-scrolly>`, where the script expects them. |
| **Scrolly text (Word)** (Document Source) | Loads the text. Its Word style rules turn the document's own styles Kicker, Title and Dek into `p.kicker`, `p.title` and `p.dek`. |
| **Header** group | **Header slots** (`.gs-kicker, .gs-headline, .gs-dek` in the code) get **Header text** (`.kicker, .title, .dek` in Word). |
| **Steps** group | **Step cards** (`.gs-step .gs-card`, 10 of them) get **Step text**: what is under each Word heading that contains "Step" (the heading itself is a label for writers and is left out). A step can have several paragraphs. |
| **Footer** group | **Footer slots** (the note and the link) get **Footer text** (the paragraphs after the last heading, "Footer"). The link keeps its address. |
| **Scrolly page** (Output) | The finished page; the preview runs the graphic. |

Each **Fill …** node is a Replace node with "Replace: what is inside it" (the code's elements keep their classes and
data attributes) and "Match by match" (the 1st slot gets the 1st piece of text, the 2nd the 2nd, …). If the counts
differ, for example a step was added in Word but not in the code, the Replace node says so.

The Word document's text has been rewritten since the HTML file was made (new headline, dek, step text and footer
note); the project puts the new text into the code, which is the point: the code does not change when the text does.

Rules for the writers: keep the Kicker, Title and Dek styles on the first three paragraphs, keep one "Step …" heading
per card in order, and keep "Footer" as the last heading. Bold, italics and links in the text come through.

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
`two-outputs/garden-year.docx` ("A year at Riverside Community Garden": three pictures, three tables of figures), into
two pages. Editors change only the Word file; both pages follow.

| Page | How |
| --- | --- |
| **Static page** | **Data tables** (Selector `table`) → **Static charts** (Snippet "Chart (static)"): each table is drawn once as a chart (bar, line, donut: the snippet's "Chart type for each table" setting), with no animation or hover. The pictures stay. |
| **Interactive page** | **Data tables** → **Interactive charts** (Snippet "Chart (interactive)"): the bars grow, the lines draw and the donut fills in when the chart scrolls into view (not for people who prefer reduced motion), and hovering shows the values. Then, for each picture, a Selector finds it by its alternative text, and a Replace node puts a short looping video (an Object with the video file) in its place. |

In both, the table stays in the page (hidden from view) for screen readers. The pictures and videos
(`two-outputs/*.png`, `*.webm`) are drawn by `scripts/make-example-media.py` (Pillow and ffmpeg).
