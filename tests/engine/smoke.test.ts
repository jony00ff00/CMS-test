import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, nodeRegistry } from '../../src/engine';

const engineDir = join(import.meta.dirname, '..', '..', 'src', 'engine');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('engine', () => {
  it('loads in plain Node', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(nodeRegistry).toBeTypeOf('object');
  });

  it('stays pure: no React, no DOM APIs, no .tsx files', () => {
    const banned = [/from ['"]react/, /from ['"]@xyflow/, /\bdocument\./, /\bwindow\./];
    for (const file of sourceFiles(engineDir)) {
      // Ignore comments, so prose such as "the document." does not count.
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const pattern of banned) expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
    expect(readdirSync(engineDir, { recursive: true }).some((f) => String(f).endsWith('.tsx'))).toBe(false);
  });
});
