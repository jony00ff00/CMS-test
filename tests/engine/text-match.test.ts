import { describe, expect, it } from 'vitest';
import { allIndexesOf, contextSimilarity, diceSimilarity, fuzzyFind, levenshtein, similarity } from '../../src/engine';

describe('text matching', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  it('scores similarity between 0 and 1', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('Pricing', 'Pricng')).toBeCloseTo(6 / 7);
    expect(similarity('abc', 'xyz')).toBe(0);
    const long = 'lorem ipsum dolor sit amet '.repeat(30);
    expect(similarity(long, long + 'x')).toBeGreaterThan(0.99);
    expect(diceSimilarity('night', 'nacht')).toBeCloseTo(0.25);
  });

  it('compares context from the right ends', () => {
    expect(contextSimilarity({ prefix: 'the ', suffix: ' plan' }, { prefix: 'xxxx the ', suffix: ' plan costs' })).toBe(1);
    expect(contextSimilarity({ prefix: '', suffix: '' }, { prefix: 'a', suffix: 'b' })).toBe(1);
    expect(contextSimilarity({ prefix: 'abcd', suffix: '' }, { prefix: 'wxyz', suffix: '' })).toBe(0.5);
  });

  it('finds all exact occurrences', () => {
    expect(allIndexesOf('aaa', 'aa')).toEqual([0, 1]);
    expect(allIndexesOf('abc', '')).toEqual([]);
  });

  it('finds the closest substring', () => {
    const text = 'Plant a source node first. Then connect a selector to it.';
    expect(fuzzyFind(text, 'Plant a sorce node', 3)).toEqual([{ start: 0, end: 19, distance: 1 }]);
    expect(fuzzyFind(text, 'conect a selectr', 3)).toEqual([{ start: 32, end: 50, distance: 2 }]);
    expect(fuzzyFind(text, 'completely different', 3)).toEqual([]);
    expect(fuzzyFind('abc abd', 'abx', 1).map((h) => h.start)).toEqual([0, 4]);
  });

  it('finds long patterns by their ends', () => {
    const body = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about nodes.`).join(' ');
    const pattern = body.slice(200, 900);
    const edited = body.slice(0, 500) + 'X' + body.slice(501);
    const [hit] = fuzzyFind(edited, pattern, 20);
    expect(hit.start).toBe(200);
    expect(hit.end).toBe(900);
    expect(hit.distance).toBeLessThanOrEqual(2);
  });
});

describe('fuzzyFind agrees with edit distance', () => {
  it('reports the real distance of every hit', () => {
    const text = 'Plant a source node first. Then connect a selector to it. The selector reads nodes.';
    for (const pattern of ['selectr', 'conect a selectr', 'Plant a sorce', 'nodez', 'the selector', 'xyz node']) {
      for (const hit of fuzzyFind(text, pattern, 4)) {
        expect(levenshtein(text.slice(hit.start, hit.end), pattern), pattern).toBe(hit.distance);
      }
    }
  });
});
