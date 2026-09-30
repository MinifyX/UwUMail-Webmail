import clsx from "clsx";
import { useRef, useState } from "react";

interface ResizeHandleProps {
  /** What it resizes, for screen readers: "Width of the folders". */
  label: string;
  /** The width of the column left of it, as it is on screen. */
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** The drag or the key press is over: keep the width. */
  onCommit: () => void;
  /** Double-click: back to the initial width. */
  onReset: () => void;
  /** The width a key asks for (arrows, Home, End), null for other keys. */
  keyedWidth: (key: string, shift: boolean) => number | null;
  className?: string;
}

/**
 * The gap between two columns, which drags the left one wider or narrower. With the keyboard it is
 * a focusable separator: ←/→ move it (Shift for bigger steps), Home and End go to the limits.
 */
export function ResizeHandle({
  label,
  width,
  min,
  max,
  onResize,
  onCommit,
  onReset,
  keyedWidth,
  className,
}: ResizeHandleProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) onResize(start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        onCommit();
      }}
      onPointerCancel={() => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        onCommit();
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const next = keyedWidth(event.key, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        // The shortcuts of the list (↑/↓, Home, End) stay out of it.
        event.stopPropagation();
        onResize(next);
        onCommit();
      }}
      className={clsx(
        "group relative w-3 shrink-0 cursor-col-resize touch-none select-none focus-visible:outline-none",
        className,
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "absolute inset-y-6 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors",
          dragging ? "bg-pink" : "bg-transparent group-hover:bg-line group-focus-visible:bg-pink",
        )}
      />
    </div>
  );
}
