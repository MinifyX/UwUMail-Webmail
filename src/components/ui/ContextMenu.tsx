import type { MenuItem } from "@uwusuite/design";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ContextMenuProps {
  /** Where the menu opens, in viewport pixels; null while it is closed. */
  at: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
  label?: string;
}

/**
 * The same popup list, opened at a point: a right click, a long press, or the corner of a "…"
 * button. It is drawn above everything else, so a scrolling sidebar doesn't cut it off.
 */
export function ContextMenu({ at, items, onClose, label }: ContextMenuProps) {
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  // Where the focus goes back to once the menu closes, so the keyboard stays where it was.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    if (!at || !list.current) {
      setPosition(null);
      return;
    }
    const { width, height } = list.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      top: at.y + height > window.innerHeight - 8 ? Math.max(8, at.y - height) : at.y,
    });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    opener.current = document.activeElement as HTMLElement | null;
    list.current?.querySelector<HTMLButtonElement>("[role^=menuitem]")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      event.stopPropagation();
      event.preventDefault();
      close.current();
      opener.current?.focus();
    };
    const onAway = () => close.current();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onAway);
    window.addEventListener("blur", onAway);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onAway);
      window.removeEventListener("blur", onAway);
    };
  }, [at]);

  if (!at) return null;
  const moveFocus = (step: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };
  return createPortal(
    <div
      ref={list}
      role="menu"
      aria-label={label}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
      // Unmeasured it stays see-through, not hidden: hidden elements can't take the focus.
      style={position ?? { left: at.x, top: at.y, opacity: 0 }}
      className="fixed z-50 flex w-max max-w-[min(320px,calc(100vw-16px))] min-w-[200px] animate-pop flex-col rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-float"
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            // Before the action, so one that opens a dialog can still move the focus on.
            opener.current?.focus();
            item.onSelect();
          }}
          className={clsx(
            "rounded-xl px-3 py-2 text-left text-meta font-medium break-words hover:bg-pink-tint/60 focus:bg-pink-tint/60 focus:outline-none",
            item.danger && "text-danger",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
