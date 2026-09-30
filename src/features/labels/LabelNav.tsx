import clsx from "clsx";
import { ChevronDown, Settings2 } from "lucide-react";
import { useState } from "react";
import type { AssistLabel, MailboxView } from "@/backend/types";
import { IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Pill";
import { useT } from "@/i18n";
import { useUi } from "@/state/ui";
import { useAssistLabels } from "../assist/useAssist";
import { draggedThreadIds, THREAD_DRAG_TYPE } from "../mail/selection";
import { sameView } from "../mail/view";
import { LabelDot } from "./LabelMenus";
import { useLabelActions } from "./useLabels";

/**
 * The labels in the sidebar, like folders: each shows its unread mail and opens every mail with it
 * across the folders. Mail dragged onto one gets that label.
 */
export function LabelNavSection() {
  const { t } = useT();
  const { data: labels = [] } = useAssistLabels();
  const [open, setOpen] = useState(true);
  if (labels.length === 0) return null;
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-1 pl-3 text-[12px] font-bold tracking-wide text-muted uppercase hover:text-ink"
        >
          <span className="min-w-0 flex-1 truncate text-left">{t("labels.nav.title")}</span>
          <ChevronDown className={clsx("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
        </button>
        <IconButton
          icon={Settings2}
          size="sm"
          label={t("labels.nav.manage")}
          onClick={() => useUi.getState().openSettings("labels")}
          className="size-7"
        />
      </div>
      {open && (
        <ul aria-label={t("labels.nav.title")} className="flex flex-col gap-0.5">
          {labels.map((label) => (
            <LabelItem key={label.id} label={label} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LabelItem({ label }: { label: AssistLabel }) {
  const { t } = useT();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const { set } = useLabelActions();
  const [dropping, setDropping] = useState(false);
  const target: MailboxView = { kind: "label", keyword: label.keyword };
  const active = sameView(view, target);
  const accepts = (event: React.DragEvent) => event.dataTransfer.types.includes(THREAD_DRAG_TYPE);
  return (
    <li>
      <button
        type="button"
        onClick={() => setView(target)}
        aria-current={active ? "page" : undefined}
        title={label.description || label.name}
        aria-label={
          label.unreadEmails > 0 ? t("labels.nav.unread", { name: label.name, count: label.unreadEmails }) : label.name
        }
        onDragOver={(event) => {
          if (!accepts(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          setDropping(false);
          if (!accepts(event)) return;
          event.preventDefault();
          const threadIds = draggedThreadIds(event.dataTransfer.getData(THREAD_DRAG_TYPE));
          if (threadIds.length === 0) return;
          useUi.getState().setCheckedThreadIds([]);
          void set(threadIds, label, true);
        }}
        className={clsx(
          "group flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px] transition-colors",
          dropping
            ? "bg-pink-tint-strong text-pink-ink ring-2 ring-pink"
            : active
              ? "bg-pink-tint font-semibold text-pink-ink"
              : "text-ink/85 hover:bg-pink-tint/50",
        )}
      >
        <span className="grid size-[17px] shrink-0 place-items-center" aria-hidden>
          <LabelDot color={label.color} />
        </span>
        <span className="min-w-0 flex-1 truncate">{label.name}</span>
        <Badge count={label.unreadEmails} />
      </button>
    </li>
  );
}
