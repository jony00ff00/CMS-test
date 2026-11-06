import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const PREVIEW_HEIGHT = { default: 260, min: 120 };
const maxHeight = () => Math.max(PREVIEW_HEIGHT.min, innerHeight - 160);
export const clampHeight = (h: number) => Math.round(Math.min(maxHeight(), Math.max(PREVIEW_HEIGHT.min, h)));

/**
 * The bar on top of the preview: drag it to make the preview taller or shorter. Arrow keys work too,
 * Home / End give the smallest / largest size, and a double click goes back to the normal size.
 */
export function PreviewResizer({ height, onChange }: { height: number; onChange: (height: number) => void }) {
  const drag = useRef<{ startY: number; startHeight: number } | undefined>(undefined);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Capture the pointer so moving over the preview's iframe does not lose it.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: height };
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clampHeight(drag.current.startHeight + (drag.current.startY - e.clientY)));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 20;
    const next =
      e.key === 'ArrowUp' ? height + step
      : e.key === 'ArrowDown' ? height - step
      : e.key === 'Home' ? PREVIEW_HEIGHT.min
      : e.key === 'End' ? maxHeight()
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onChange(clampHeight(next));
  };

  return (
    <div
      className="preview-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the preview"
      aria-valuenow={height}
      aria-valuemin={PREVIEW_HEIGHT.min}
      aria-valuemax={maxHeight()}
      tabIndex={0}
      title="Drag to resize · double-click for the normal size"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(clampHeight(PREVIEW_HEIGHT.default))}
      onKeyDown={onKeyDown}
    />
  );
}
