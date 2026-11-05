import { describe, expect, it } from 'vitest';
import {
  addVersion, carryParams, findVersion, latestVersion, refStatus, removeSnippet, snippetIdFor, validateSnippet, type Snippet,
} from '../../src/engine';
import { SEED_SNIPPETS, seedLibrary } from '../../src/snippets/seed';

const base: Snippet = { kind: 'snippet', id: 'box', name: 'Box', version: 0, mode: 'wrap', template: '<div>{{content}}</div>', params: [] };

describe('snippet library', () => {
  it('numbers versions and never changes saved ones', () => {
    const one = addVersion({}, base);
    expect(one.snippet.version).toBe(1);
    const two = addVersion(one.library, { ...one.snippet, template: '<section>{{content}}</section>' });
    expect(two.snippet.version).toBe(2);
    expect(two.library.box.map((s) => s.version)).toEqual([1, 2]);
    expect(findVersion(two.library, 'box', 1)?.template).toBe('<div>{{content}}</div>');
    expect(latestVersion(two.library, 'box')?.template).toBe('<section>{{content}}</section>');
    expect(one.library.box).toHaveLength(1);
  });

  it('removes snippets and makes unique ids from names', () => {
    const { library } = addVersion({}, base);
    expect(removeSnippet(library, 'box')).toEqual({});
    expect(snippetIdFor(library, 'Box')).toBe('box-2');
    expect(snippetIdFor(library, 'My Fancy  Box!')).toBe('my-fancy-box');
    expect(snippetIdFor({}, '***')).toBe('snippet');
  });

  it('tells nodes when an update is available or the snippet is gone', () => {
    const one = addVersion({}, base);
    const two = addVersion(one.library, one.snippet);
    expect(refStatus(two.library, { id: 'box', version: 1 })).toMatchObject({ outdated: true, missing: false });
    expect(refStatus(two.library, { id: 'box', version: 2 })).toMatchObject({ outdated: false });
    expect(refStatus({}, { id: 'box', version: 1 })).toMatchObject({ missing: true, outdated: false });
    expect(refStatus(two.library, undefined)).toBeUndefined();
  });

  it('keeps parameter values that still fit the new version', () => {
    const params = [
      { name: 'variant', type: 'select' as const, options: ['a', 'b'] },
      { name: 'title', type: 'text' as const },
    ];
    expect(carryParams({ variant: 'b', title: 'Hi', gone: 1 }, params)).toEqual({ variant: 'b', title: 'Hi' });
    expect(carryParams({ variant: 'c' }, params)).toBeUndefined();
    expect(carryParams(undefined, params)).toBeUndefined();
  });

  it('validates snippets before saving', () => {
    expect(validateSnippet(base)).toEqual([]);
    expect(
      validateSnippet({
        ...base,
        name: ' ',
        template: '',
        params: [
          { name: '1x', type: 'text' },
          { name: 'a', type: 'text' },
          { name: 'a', type: 'text' },
          { name: 'pick', type: 'select', options: [] },
          { name: 'size', type: 'select', options: ['s'], default: 'm' },
        ],
      }),
    ).toEqual([
      'Give the snippet a name',
      'The template is empty',
      'Parameter name "1x" must be letters, digits or _ (not starting with a digit)',
      'Two parameters are called "a"',
      'Parameter "pick" needs at least one option',
      'The default of "size" must be one of its options',
    ]);
  });

  it('starts with five valid snippets', () => {
    expect(SEED_SNIPPETS.map((s) => s.id)).toEqual(['callout', 'details', 'highlight', 'tooltip', 'code-block']);
    for (const s of SEED_SNIPPETS) expect(validateSnippet(s), s.id).toEqual([]);
    expect(Object.keys(seedLibrary())).toHaveLength(5);
  });
});
