import { useQuery } from "@tanstack/react-query";
import { cloneElement, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { backend } from "@/backend/backend";
import type { AssistCost, AssistEstimate, AssistEstimateRequest } from "@/backend/types";
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
  if (estimate.cost) {
    const about = formatCost(estimate.cost, i18n.language, t, true);
    const max = estimate.cost.max;
    const most = max && max.amount > estimate.cost.amount ? formatCost(max, i18n.language, t) : null;
    // A worst case that reads the same as the estimate says nothing more.
    parts.push(most && !about.endsWith(most) ? t("assist.cost.withMax", { amount: about, max: most }) : about);
  }
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

export interface BreakdownLine {
  key: "input" | "pictures" | "answer" | "thinking" | "extraCalls" | "fees";
  label: string;
  value: string;
}

/** Purposes of extra calls the texts know; others read as "other". */
const PURPOSES = ["pictures", "chunk", "retry", "refine"];

/**
 * What an estimate is made of, one line per part that isn't zero: input, pictures, answer,
 * thinking, the extra calls and fees. Empty from an older server, which doesn't say.
 */
export function useEstimateBreakdown(estimate: AssistEstimate | null): BreakdownLine[] {
  const { t, i18n } = useT();
  if (!estimate) return [];
  const parts = estimate.cost?.parts ?? null;
  if (estimate.calls.length === 0 && !parts) return [];
  const number = new Intl.NumberFormat(i18n.language);
  const currency = estimate.cost?.currency ?? "";
  const money = (amount: number | undefined) =>
    amount && amount > 0
      ? formatCost({ amount, currency } satisfies Pick<AssistCost, "amount" | "currency">, i18n.language, t, true)
      : null;
  const tokens = (count: number) => {
    const rough = roughly(count);
    return t("assist.estimate.tokens", { count: rough, tokens: number.format(rough) });
  };
  const join = (...values: (string | null)[]) => values.filter(Boolean).join(" · ");
  const label = (key: BreakdownLine["key"]) => t(`assist.estimate.breakdown.${key}`);
  const lines: BreakdownLine[] = [];
  if (estimate.inputTokens > 0 || money(parts?.input)) {
    lines.push({ key: "input", label: label("input"), value: join(tokens(estimate.inputTokens), money(parts?.input)) });
  }
  if (estimate.imageCount > 0 || money(parts?.images)) {
    lines.push({
      key: "pictures",
      label: label("pictures"),
      value: join(
        estimate.imageCount > 0
          ? t("assist.estimate.pictures", { count: estimate.imageCount, formatted: number.format(estimate.imageCount) })
          : null,
        money(parts?.images),
      ),
    });
  }
  if (estimate.outputTokens > 0 || money(parts?.output)) {
    lines.push({
      key: "answer",
      label: label("answer"),
      value: join(tokens(estimate.outputTokens), money(parts?.output)),
    });
  }
  if (estimate.reasoningTokens > 0 || money(parts?.reasoning)) {
    lines.push({
      key: "thinking",
      label: label("thinking"),
      value: join(estimate.reasoningTokens > 0 ? tokens(estimate.reasoningTokens) : null, money(parts?.reasoning)),
    });
  }
  // Extra calls by purpose, in the order they come: "4 × reading pictures, retry (sometimes)".
  const extra = new Map<string, { count: number; sometimes: boolean }>();
  for (const call of estimate.calls) {
    if (call.purpose === "main" || call.weight <= 0) continue;
    const purpose = PURPOSES.includes(call.purpose) ? call.purpose : "other";
    const entry = extra.get(purpose) ?? { count: 0, sometimes: true };
    entry.count += 1;
    entry.sometimes &&= call.weight < 1;
    extra.set(purpose, entry);
  }
  if (extra.size > 0) {
    const what = [...extra].map(([purpose, { count, sometimes }]) => {
      const name = t(`assist.estimate.purpose.${purpose}`);
      const counted = count > 1 ? t("assist.estimate.times", { count, what: name }) : name;
      return sometimes ? t("assist.estimate.sometimes", { what: counted }) : counted;
    });
    lines.push({ key: "extraCalls", label: label("extraCalls"), value: what.join(", ") });
  }
  const fees = money((parts?.requests ?? 0) + (parts?.other ?? 0));
  if (fees) lines.push({ key: "fees", label: label("fees"), value: fees });
  return lines;
}

type Place = { left: number; top?: number; bottom?: number };

function placeFor(target: Element, beside: boolean): Place {
  const rect = target.getBoundingClientRect();
  // Menu items: next to the item, so the tooltip never covers the one below.
  if (beside) {
    if (rect.right + 288 <= window.innerWidth) return { left: rect.right + 8, top: rect.top };
    if (rect.left >= 288) return { left: rect.left - 288, top: rect.top };
  }
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
  /** Show the tooltip beside the button instead of below it (menu items), where there is room. */
  beside?: boolean;
}

/**
 * A tooltip on an AI button with about what it costs: shown on hover, keyboard focus or a long
 * press, the estimate asked for only then. A long press never also presses the button.
 */
export function EstimateTip({ request, hint, children, beside = false }: EstimateTipProps) {
  const id = useId();
  const [place, setPlace] = useState<Place | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimate = useAssistEstimate(request, place !== null);
  const text = useEstimateText(estimate);
  const breakdown = useEstimateBreakdown(estimate);
  const { t } = useT();
  const lines = [hint, text].filter((line): line is string => Boolean(line));

  useEffect(
    () => () => {
      if (press.current.timer) clearTimeout(press.current.timer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // The wrapper has no box of its own: the tooltip goes by the button inside it.
  const show = (wrapper: Element) => setPlace(placeFor(wrapper.firstElementChild ?? wrapper, beside));
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
            {breakdown.length > 0 && (
              <span className="mt-1 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-px border-t border-canvas/20 pt-1 text-[11.5px]">
                {breakdown.map((line) => (
                  <span key={line.key} className="contents">
                    <span className="opacity-70">{line.label}</span>
                    <span>{line.value}</span>
                  </span>
                ))}
              </span>
            )}
            {estimate?.calibrated && <span className="text-[11px] opacity-70">{t("assist.estimate.calibrated")}</span>}
          </span>,
          document.body,
        )}
    </>
  );
}
