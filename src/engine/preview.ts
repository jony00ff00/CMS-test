// Preview helpers: mark a selection's matches so the editor can show them.
import { applySnippet } from './snippets';
import type { CmsDocument, Selection, Snippet } from './types';

/** Attribute on every highlighted element (value: the match number, from 1). */
export const MATCH_ATTRIBUTE = 'data-cms-match';

const HIGHLIGHT: Snippet = {
  kind: 'snippet',
  id: 'cms-preview-highlight',
  name: 'Highlight',
  version: 1,
  mode: 'attributes',
  template: `${MATCH_ATTRIBUTE}="{{number}}" data-cms-status="{{match.status}}"`,
  params: [],
};

/**
 * A copy of the selection's document with each match marked: matched elements get `data-cms-match`,
 * matched text is wrapped in a <span> with it. The text stays exactly the same, so text offsets
 * measured in the preview still match the original document.
 */
export async function highlightSelection(selection: Selection): Promise<CmsDocument> {
  if (selection.matches.length === 0) return selection.document;
  const result = await applySnippet(selection, HIGHLIGHT, {
    matchData: (i) => ({ status: selection.matches[i]?.status ?? 'exact' }),
  });
  return result.document;
}

export const HIGHLIGHT_CSS = `
[${MATCH_ATTRIBUTE}] { outline: 2px solid #f59e0b; outline-offset: 2px; background: rgba(245, 158, 11, 0.14); border-radius: 2px; }
span[${MATCH_ATTRIBUTE}] { outline-width: 1px; outline-offset: 0; background: rgba(245, 158, 11, 0.32); }
[${MATCH_ATTRIBUTE}][data-cms-status='fuzzy'] { outline-style: dashed; outline-color: #7c3aed; background: rgba(124, 58, 237, 0.12); }
`;
