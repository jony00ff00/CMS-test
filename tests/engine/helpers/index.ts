import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Element, Root } from 'hast';
import { visitElements } from '../../../src/engine';

export const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name));

export function findAll(tree: Root, tagName: string): Element[] {
  const found: Element[] = [];
  visitElements(tree, (el) => {
    if (el.tagName === tagName) found.push(el);
  });
  return found;
}
