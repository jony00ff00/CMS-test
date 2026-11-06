import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo-name>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    // Large, rarely needed libraries (mammoth, Handlebars, Markdown, CodeMirror) are loaded with import().
    // The libraries the editor needs at start go into a few separate files, so the app's own code stays small
    // and each part is cached on its own. Only list libraries that are loaded at start here: a library that is
    // only imported lazily would be pulled into the start-up download by a group.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'flow', test: /node_modules[\\/](@xyflow|d3-[a-z-]+|classcat)[\\/]/, priority: 2 },
            {
              name: 'html',
              test: /node_modules[\\/](parse5|entities|hast[\w-]*|rehype[\w-]*|unified|unist[\w-]*|vfile[\w-]*|property-information|html-[\w-]+|space-separated-tokens|comma-separated-tokens|zwitch|ccount|character-entities[\w-]*|stringify-entities|css-selector-parser|nth-check|bcp-47-match|direction|web-namespaces|bail|trough|devlop|is-plain-obj|extend|jsonpath-plus)[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/engine/**/*.test.ts', 'tests/store/**/*.test.ts'],
    environment: 'node',
  },
});
