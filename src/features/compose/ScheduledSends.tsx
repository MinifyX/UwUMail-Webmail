import { useQueryClient } from "@tanstack/react-query";
import { Clock, PenLine, Undo2 } from "lucide-react";
import { useState } from "react";
import { backend, BackendError } from "@/backend/backend";
import type { ScheduledSend } from "@/backend/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Pill";
import { useT } from "@/i18n";
import { displayName } from "@/lib/format";
import { queryKeys, useScheduledSends } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { undoSend, undoWindowSends } from "./undoSend";

/** Mail sent later on purpose: what the server holds back, less this page's own undo windows. */
export function useLaterSends(): ScheduledSend[] {
  const { data = [] } = useScheduledSends();
  return data.filter((entry) => !undoWindowSends.has(entry.id));
}

/** "Scheduled" in the folder list, while the server holds mail back for later. */
export function ScheduledNavItem() {
  const { t } = useT();
  const later = useLaterSends();
  const [open, setOpen] = useState(false);
  if (later.length === 0 && !open) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px] text-ink/85 transition-colors hover:bg-pink-tint/50"
      >
        <Clock className="size-[17px] shrink-0 text-muted" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("nav.scheduled")}</span>
        <Badge count={later.length} />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("scheduled.title")} width="md">
        <ScheduledList sends={later} onEdit={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ScheduledList({ sends, onEdit }: { sends: ScheduledSend[]; onEdit: () => void }) {
  const { t, i18n } = useT();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  if (sends.length === 0) {
    return <p className="px-6 pt-2 pb-6 text-[13.5px] text-muted">{t("scheduled.empty")}</p>;
  }

  /** Stops it without opening it: it stays in Drafts. */
  const stop = async (entry: ScheduledSend) => {
    setBusy(entry.id);
    try {
      await backend().cancelSend(entry.id);
      toast(t("scheduled.stopped"), "success");
    } catch (reason) {
      const late = reason instanceof BackendError && reason.code === "too_late";
      toast(late ? t("toast.undoTooLate") : reason instanceof Error ? reason.message : String(reason), "error");
    } finally {
      setBusy(null);
      await client.invalidateQueries({ queryKey: queryKeys.scheduled });
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 pt-1 pb-6">
      <p className="text-[13px] text-muted">{t("scheduled.desc")}</p>
      <ul className="flex flex-col gap-2">
        {sends.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-2 rounded-2xl border border-hairline p-3">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold">{entry.subject || t("reader.noSubject")}</p>
              <p className="truncate text-[12.5px] text-muted">
                {t("scheduled.to", { names: entry.to.map(displayName).join(", ") })}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-pink-ink">
                <Clock className="size-3.5" aria-hidden />
                {new Date(entry.sendAt).toLocaleString(i18n.language, { dateStyle: "full", timeStyle: "short" })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={PenLine}
                disabled={busy !== null}
                onClick={() => {
                  onEdit();
                  void undoSend(entry.id);
                }}
              >
                {t("scheduled.edit")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Undo2}
                busy={busy === entry.id}
                disabled={busy !== null}
                onClick={() => void stop(entry)}
              >
                {t("scheduled.stop")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
