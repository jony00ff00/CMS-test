import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo-name>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    // The editor needs the whole engine (HTML parser, CSS selectors, JSONPath) plus React Flow: about 720 kB.
    // Large, rarely needed libraries are loaded with import() and stay out of this chunk.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
  },
});
