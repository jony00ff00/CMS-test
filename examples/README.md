# Example projects

Open a project with **Open project…** in the app. Regenerate these files with `npm run example:two-columns`
(the script is `scripts/make-example-two-columns.ts`).

## Part of a Word document in two columns, pictures on the right

`word-two-columns.node-cms.json` (the Word document it uses, `garden-handbook.docx`, is inside the project file;
it is also here on its own). The section "Planting your first garden" has pictures between its paragraphs; the
result has the text on the left and the pictures, in the same order, on the right. The other sections stay as they
were. On narrow screens (under 520 px) the pictures go under the text.

| Node | What it does |
| --- | --- |
| **Word document** (Document Source) | Loads the .docx. Choose another file here to use your own document. |
| **The part to change** (Selector, section under a heading) | Picks what goes into the columns: everything under the heading containing "Planting", up to the next heading of the same level. The heading itself stays above the columns. Change the heading text to pick another part (or use another mode: "Selected by hand", a CSS selector, …). |
| **Two columns** (Snippet, from the library) | Wraps that part in `<div class="cms-two-col">` with a text column and an empty picture column, plus the CSS for the grid. Settings: the width of the picture column (40%) and the side (right or left). |
| **Pictures in the text** (Selector, CSS `.cms-two-col-text p:has(img)`) | The paragraphs holding the pictures, inside the text column only. |
| **Take them out of the text** (Snippet, replace with nothing) | Removes those paragraphs from the text column. |
| **The picture column** (Selector, CSS `.cms-two-col-media`, Point output "Inside it, at the end") | Where the pictures go. |
| **Pictures on the right** (Object, content from another node) | Puts a copy of what "Pictures in the text" selected into the picture column. |
| **Web page** (Output) | The result, with the pictures inside the page. |

The last four nodes are in the group "Pictures to the right column": collapse it to see the workflow as three steps.

To do the same with your own document: in **Word document** choose your .docx, then in **The part to change** type
(part of) the heading of the section to change. Pictures in Word are paragraphs of their own, so they move as a whole.
