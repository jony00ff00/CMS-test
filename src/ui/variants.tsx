// Page variants in the editor: which variant is shown, and which variant's settings the inspector edits.
import { variantNames, variantsFor, type GraphNode } from '../engine';
import { editorStore, useEditor } from '../store/editor-store';

/** What the nodes' own settings are called next to the variants. */
export const DEFAULT_VARIANT_LABEL = 'Default';

/** The page shown on the canvas and in the preview. Only when some Output makes a variant. */
export function VariantPicker() {
  const names = useEditor((s) => variantNames(s.graph).join('\n'));
  const variant = useEditor((s) => s.variant);
  if (!names) return null;
  const list = names.split('\n');
  return (
    <div className="variant-picker" role="group" aria-label="Page variant shown">
      <span className="muted small">Page:</span>
      {[undefined, ...list].map((v) => (
        <button
          key={v ?? ''}
          type="button"
          className={`variant-chip${v === variant ? ' is-active' : ''}`}
          aria-pressed={v === variant}
          title={v ? `Show the nodes as the “${v}” page uses them` : 'Show the nodes with their own settings'}
          onClick={() => editorStore.getState().setVariant(v)}
        >
          {v ?? DEFAULT_VARIANT_LABEL}
        </button>
      ))}
    </div>
  );
}

/** In the inspector: edit the node's own settings, or its settings for one page variant. */
export function VariantSwitch({ node }: { node: GraphNode }) {
  const names = useEditor((s) => variantsFor(s.graph, node.id).join('\n'));
  const editVariant = useEditor((s) => s.editVariant);
  if (!names || node.type === 'output') return null;
  const list = names.split('\n');
  const differs = (v: string) => Object.keys(node.variants?.[v] ?? {});
  const changed = editVariant ? differs(editVariant) : [];
  return (
    <div className={`variant-switch${editVariant ? ' is-variant' : ''}`}>
      <div className="variant-switch-row" role="group" aria-label="Settings for">
        <span className="field-label">Settings for</span>
        {[undefined, ...list].map((v) => (
          <button
            key={v ?? ''}
            type="button"
            className={`variant-chip${v === editVariant ? ' is-active' : ''}`}
            aria-pressed={v === editVariant}
            onClick={() => editorStore.getState().setEditVariant(v)}
          >
            {v ?? 'All pages'}
            {v && differs(v).length > 0 && <span className="variant-dot" aria-label=" (differs)" />}
          </button>
        ))}
      </div>
      <p className="muted small" role="note">
        {editVariant ? (
          changed.length ? (
            <>
              The “{editVariant}” page uses its own {changed.join(', ')}.{' '}
              <button type="button" className="link" onClick={() => editorStore.getState().resetVariantSettings(node.id, editVariant)}>
                Use the same settings as all pages
              </button>
            </>
          ) : (
            <>Changes here apply only to the “{editVariant}” page.</>
          )
        ) : list.some((v) => differs(v).length) ? (
          <>Changes here apply to every page, except settings a page has its own of ({list.filter((v) => differs(v).length).join(', ')}).</>
        ) : (
          <>Changes here apply to every page. Pick a page to give it its own settings.</>
        )}
      </p>
    </div>
  );
}
