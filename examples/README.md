# Example projects

Open a project with **Open project…** in the app.

## A scrolly from Word text and HTML code

`ge16-scrolly.node-cms.json` puts the text written in Word (`scrolly/ge16-scrolly-short-text.docx`) into the code of a
scrollytelling graphic (`scrolly/ge16-scrolly-short.html`: its markup, CSS and JavaScript, made by a developer). Both
files are inside the project file; they are here on their own too. Writers change the Word document, developers
change the HTML, and the project puts the two together again: choose the new file in either Document Source.
Regenerate the project file after changing either file with `npm run example:scrolly`.

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

Rules for the writers: keep the Kicker, Title and Dek styles on the first three paragraphs, keep one "Step …" heading
per card in order, and keep "Footer" as the last heading. Bold, italics and links in the text come through.
