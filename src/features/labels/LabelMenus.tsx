import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Minus, Plus, Search, Tags } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { backend } from "@/backend/backend";
import type { AssistLabel, ThreadSummary } from "@/backend/types";
import { Dialog } from "@/components/ui/Dialog";
import { ContextMenu } from "@/components/ui/Menu";
import { useT } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { LABEL_COLORS, labelProblems } from "../assist/labels";
import { assistErrorText, useAssistLabels, useAssistOptions } from "../assist/useAssist";
import { useSelectionActions } from "../mail/selection";
import { filterLabels, labelPresence, type LabelPresence } from "./logic";
import { useLabelActions } from "./useLabels";

/** A label's colour as a small dot; a ring without one. */
export function LabelDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("size-2.5 shrink-0 rounded-full border", !color && "border-line", className)}
      style={color ? { backgroundColor: color, borderColor: color } : undefined}
    />
  );
}

function PresenceMark({ presence }: { presence: LabelPresence }) {
  if (presence === "all") return <Check className="size-3.5 shrink-0 text-pink" strokeWidth={3} aria-hidden />;
  if (presence === "some") return <Minus className="size-3.5 shrink-0 text-muted" strokeWidth={3} aria-hidden />;
  return <span className="size-3.5 shrink-0" aria-hidden />;
}

/**
 * The right-click menu of list rows: every label to put on or take off the conversations
 * (all ticked ones when the row is ticked), and the picker for more.
 */
export function ThreadLabelMenu({
  at,
  threadIds,
  threads,
  onClose,
}: {
  at: { x: number; y: number } | null;
  threadIds: string[];
  threads: ThreadSummary[];
  onClose: () => void;
}) {
  const { t } = useT();
  const { data: labels = [] } = useAssistLabels();
  const { set } = useLabelActions();
  const targets = threads.filter((thread) => threadIds.includes(thread.id));
  const items = [
    ...labels.map((label) => {
      const presence = labelPresence(targets, label.keyword);
      return {
        label: (
          <span
            className="flex items-center gap-2.5"
            aria-label={t(presence === "all" ? "labels.quick.removeName" : "labels.quick.addName", {
              name: label.name,
            })}
          >
            <PresenceMark presence={presence} />
            <LabelDot color={label.color} />
            <span className="min-w-0 truncate">{label.name}</span>
          </span>
        ),
        onSelect: () => void set(threadIds, label, presence !== "all"),
      };
    }),
    {
      label: (
        <span className="flex items-center gap-2.5">
          <Tags className="size-3.5 shrink-0 text-muted" aria-hidden />
          {t("labels.quick.more")}
        </span>
      ),
      onSelect: () => useUi.getState().openLabelPicker(threadIds),
    },
  ];
  return <ContextMenu at={at} items={items} onClose={onClose} label={t("labels.quick.title")} />;
}

/**
 * The quick label picker (L, or "Labels…"): type to find a label, Enter or a click puts it on the
 * chosen conversations or takes it off. A name that is no label yet can be made right here.
 */
export function LabelPicker() {
  const { t } = useT();
  const picker = useUi((s) => s.labelPicker);
  const close = useUi((s) => s.closeLabelPicker);
  return (
    <Dialog open={picker !== null} onClose={close} title={t("labels.quick.title")} width="sm">
      {picker && <PickerBody threadIds={picker.threadIds} />}
    </Dialog>
  );
}

function PickerBody({ threadIds }: { threadIds: string[] }) {
  const { t } = useT();
  const { data: labels = [] } = useAssistLabels();
  const { data: options } = useAssistOptions();
  const selection = useSelectionActions();
  const client = useQueryClient();
  const { set } = useLabelActions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  // The dialog puts the focus on its first button; typing belongs in the search.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const { data: messages } = useQuery({
    queryKey: [...queryKeys.thread, "labels", ...threadIds],
    queryFn: () => selection.messagesOf(threadIds),
  });
  const shown = filterLabels(labels, query);
  const name = query.trim();
  const canCreate =
    name !== "" &&
    options !== null &&
    options !== undefined &&
    labels.length < options.maxLabels &&
    Object.keys(labelProblems({ name, description: "", color: null }, labels)).length === 0;
  const count = shown.length + (canCreate ? 1 : 0);
  const current = Math.min(active, Math.max(0, count - 1));

  const toggle = async (label: AssistLabel) => {
    const presence = labelPresence(messages ?? [], label.keyword);
    setBusy(true);
    await set(threadIds, label, presence !== "all");
    await client.invalidateQueries({ queryKey: [...queryKeys.thread, "labels"] });
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    try {
      const label = await backend().createAssistLabel({
        name,
        description: "",
        color: LABEL_COLORS[labels.length % LABEL_COLORS.length]!,
      });
      await set(threadIds, label, true);
      setQuery("");
      await client.invalidateQueries({ queryKey: [...queryKeys.thread, "labels"] });
    } catch (error) {
      toast(assistErrorText(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const choose = (index: number) => {
    if (busy) return;
    const label = shown[index];
    if (label) void toggle(label);
    else if (canCreate) void create();
  };

  return (
    <div className="flex flex-col gap-2 px-5 pt-1 pb-5">
      <p className="text-[12.5px] text-muted">{t("labels.quick.for", { count: threadIds.length })}</p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          ref={input}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={count > 0 ? `${listId}-${current}` : undefined}
          aria-label={t("labels.quick.search")}
          placeholder={t("labels.quick.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (count > 0) setActive((current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(current);
            }
          }}
          className="h-10 w-full rounded-full border border-line bg-canvas pr-3 pl-9 text-[13.5px] placeholder:text-muted focus:border-pink focus:bg-surface focus:shadow-focus focus:outline-none"
        />
      </div>
      <ul id={listId} role="listbox" aria-label={t("labels.quick.title")} className="flex flex-col gap-0.5">
        {shown.map((label, index) => {
          const presence = labelPresence(messages ?? [], label.keyword);
          return (
            <li
              key={label.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              aria-checked={presence === "all" ? true : presence === "some" ? "mixed" : false}
              onClick={() => choose(index)}
              onPointerMove={() => setActive(index)}
              className={clsx(
                "flex h-9 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13.5px]",
                index === current && "bg-pink-tint/60",
              )}
            >
              <PresenceMark presence={messages ? presence : "none"} />
              <LabelDot color={label.color} />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </li>
          );
        })}
        {canCreate && (
          <li
            id={`${listId}-${shown.length}`}
            role="option"
            aria-selected={current === shown.length}
            onClick={() => choose(shown.length)}
            onPointerMove={() => setActive(shown.length)}
            className={clsx(
              "flex h-9 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13.5px] font-semibold text-pink-ink",
              current === shown.length && "bg-pink-tint/60",
            )}
          >
            <Plus className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("labels.quick.create", { name })}</span>
          </li>
        )}
        {count === 0 && <li className="px-3 py-2 text-[13px] text-muted">{t("labels.quick.none")}</li>}
      </ul>
    </div>
  );
}
