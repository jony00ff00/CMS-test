import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const PREVIEW_WIDTH = { default: 440, min: 260 };
/** Leave room for the canvas and the other sidebars. */
const maxWidth = () => Math.max(PREVIEW_WIDTH.min, innerWidth - 720);
export const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(PREVIEW_WIDTH.min, w)));

/**
 * The bar on the left edge of the preview sidebar: drag it to make the preview wider or narrower. Arrow keys work
 * too (left: wider), Home / End give the smallest / largest size, and a double click goes back to the normal size.
 */
export function PreviewResizer({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Capture the pointer so moving over the preview's iframe does not lose it.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clampWidth(drag.current.startWidth + (drag.current.startX - e.clientX)));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 20;
    const next =
      e.key === 'ArrowLeft' ? width + step
      : e.key === 'ArrowRight' ? width - step
      : e.key === 'Home' ? PREVIEW_WIDTH.min
      : e.key === 'End' ? maxWidth()
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onChange(clampWidth(next));
  };

  return (
    <div
      className="preview-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the preview"
      aria-valuenow={width}
      aria-valuemin={PREVIEW_WIDTH.min}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title="Drag to resize · double-click for the normal size"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(clampWidth(PREVIEW_WIDTH.default))}
      onKeyDown={onKeyDown}
    />
  );
}
