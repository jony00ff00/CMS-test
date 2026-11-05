# Node CMS

A visual, node-based CMS that runs entirely in the browser:
**Document Source → Selector → Snippet → Output.**

- **Document Source** loads a `.html`, `.docx` or `.json` file (JSON fields are picked with JSONPath and read as
  text, HTML or Markdown).
- **Selector** picks parts of it: CSS selector, text pattern, the section under a heading, a JSON field, or text
  you select by hand in the preview. Hand-made selections follow the text when the file changes.
- **Snippet** wraps, adds to, replaces or adds attributes to the selection, using versioned snippets from a
  library (Handlebars templates with parameters, CSS and JavaScript).
- **Output** previews the result and exports it as an HTML page, or writes the changed fields back into the JSON file.

The project is saved in the browser, can be saved and opened as a project file, and has undo and redo.

Try it: https://jony00ff00.github.io/CMS-test/ (click **HTML example** or **JSON example**).

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run e2e        # browser tests (Playwright)
npm run build      # type check + production build
```

See `CLAUDE.md` for how the code is organised.
