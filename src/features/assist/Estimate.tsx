import { useQuery } from "@tanstack/react-query";
import { cloneElement, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { backend } from "@/backend/backend";
import type { AssistEstimate, AssistEstimateRequest } from "@/backend/types";
import { useT } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { formatCost, useAssistCurrency } from "./cost";

/** How long a changing request (the draft being typed) has to stay still before it is asked about. */
export const ESTIMATE_SETTLE_MS = 400;
/** How long a finger has to rest on a button for its tooltip. */
export const LONG_PRESS_MS = 500;
/** How long a tooltip opened by a long press stays. */
const TOUCH_TIP_MS = 4000;

/**
 * About what a call of the assistant would cost, asked only while `active` (the tooltip is
 * showing) and kept per request, so hovering again costs nothing. A request that keeps changing
 * is asked about once it has been still for a moment. Null while unknown, on an older server
 * and on any error: then there is simply no estimate.
 */
export function useAssistEstimate(request: AssistEstimateRequest | null, active: boolean): AssistEstimate | null {
  const currency = useAssistCurrency();
  const key = request ? JSON.stringify(request) : null;
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    if (key === settled) return;
    const timer = setTimeout(() => setSettled(key), ESTIMATE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key, settled]);
  const { data } = useQuery({
    queryKey: [...queryKeys.assistEstimate, settled, currency],
    queryFn: () => backend().assistEstimate(JSON.parse(settled!) as AssistEstimateRequest, currency),
    enabled: active && settled !== null,
    // What is left today moves with every answer; the rest only with the text.
    staleTime: 60_000,
    retry: false,
  });
  return settled === key ? (data ?? null) : null;
}

/** "1,234" as "1,200": an estimate is no count. */
export function roughly(tokens: number): number {
  if (tokens < 100) return Math.max(1, Math.round(tokens));
  return tokens < 1000 ? Math.round(tokens / 10) * 10 : Math.round(tokens / 100) * 100;
}

/** "≈ 1,200 tokens · ≈ €0.02 · 48,000 left today", in the person's language and number format. */
export function useEstimateText(estimate: AssistEstimate | null): string | null {
  const { t, i18n } = useT();
  if (!estimate) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const total = roughly(estimate.totalTokens);
  const parts = [t("assist.estimate.tokens", { count: total, tokens: number.format(total) })];
  // A server from before prices has no cost, and one the admin keeps to themselves says null.
  if (estimate.cost) parts.push(formatCost(estimate.cost, i18n.language, t, true));
  if (estimate.tokensLeftToday !== null) {
    parts.push(
      t("assist.estimate.tokensLeft", {
        count: estimate.tokensLeftToday,
        left: number.format(estimate.tokensLeftToday),
      }),
    );
  } else if (estimate.requestsLeftToday !== null) {
    parts.push(
      t("assist.estimate.requestsLeft", {
        count: estimate.requestsLeftToday,
        left: number.format(estimate.requestsLeftToday),
      }),
    );
  }
  return parts.join(" · ");
}

type Place = { left: number; top?: number; bottom?: number };

function placeFor(target: Element): Place {
  const rect = target.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280));
  // Below the button, or above it where the screen ends (the composer's toolbar, a phone).
  return rect.bottom + 48 > window.innerHeight
    ? { left, bottom: window.innerHeight - rect.top + 6 }
    : { left, top: rect.bottom + 6 };
}

function focusVisible(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return false;
  }
}

interface EstimateTipProps {
  /** What the button would ask; null for none (then only `hint` shows). */
  request: AssistEstimateRequest | null;
  /** A line that shows above the estimate, e.g. what the button does. */
  hint?: string;
  /** The button; it keeps its own handlers. */
  children: ReactElement;
}

/**
 * A tooltip on an AI button with about what it costs: shown on hover, keyboard focus or a long
 * press, the estimate asked for only then. A long press never also presses the button.
 */
export function EstimateTip({ request, hint, children }: EstimateTipProps) {
  const id = useId();
  const [place, setPlace] = useState<Place | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimate = useAssistEstimate(request, place !== null);
  const text = useEstimateText(estimate);
  const lines = [hint, text].filter((line): line is string => Boolean(line));

  useEffect(
    () => () => {
      if (press.current.timer) clearTimeout(press.current.timer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // The wrapper has no box of its own: the tooltip goes by the button inside it.
  const show = (wrapper: Element) => setPlace(placeFor(wrapper.firstElementChild ?? wrapper));
  const hide = () => setPlace(null);
  const endPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  const visible = place !== null && lines.length > 0;

  return (
    <>
      {/* The button's own events pass through this on their way up, a long press's click stops here. */}
      <span
        role="presentation"
        className="contents"
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") show(event.currentTarget);
        }}
        onPointerLeave={(event) => {
          endPress();
          if (event.pointerType !== "touch") hide();
        }}
        onPointerDown={(event) => {
          press.current.fired = false;
          if (event.pointerType !== "touch") return;
          const target = event.currentTarget;
          endPress();
          press.current.timer = setTimeout(() => {
            press.current.fired = true;
            show(target);
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(hide, TOUCH_TIP_MS);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onClickCapture={(event) => {
          // The finger rested to read the tooltip, not to press.
          if (!press.current.fired) return;
          press.current.fired = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          if (press.current.timer || press.current.fired) event.preventDefault();
        }}
        onFocus={(event) => {
          if (focusVisible(event.target)) show(event.currentTarget);
        }}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === "Escape") hide();
        }}
      >
        {visible
          ? cloneElement(children as ReactElement<HTMLAttributes<HTMLElement>>, { "aria-describedby": id })
          : children}
      </span>
      {visible &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={place}
            className="pointer-events-none fixed z-50 flex w-max max-w-[min(280px,calc(100vw-16px))] animate-fade flex-col gap-0.5 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-canvas shadow-float"
          >
            {lines.map((line, index) => (
              <span key={index} className={index < lines.length - 1 ? "opacity-80" : undefined}>
                {line}
              </span>
            ))}
          </span>,
          document.body,
        )}
    </>
  );
}
