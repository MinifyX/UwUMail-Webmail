import { Clock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextInput } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { fromLocalInput, sendLaterPresets, sendLaterProblem, toLocalInput } from "@/lib/sendLater";

interface SendLaterDialogProps {
  open: boolean;
  /** How far ahead the server holds mail, in seconds. */
  maxDelay: number;
  onClose: () => void;
  onPick: (sendAt: string) => void;
}

/** Picks when a mail goes: a quick choice, or any date and time the server still holds mail for. */
export function SendLaterDialog({ open, maxDelay, onClose, onPick }: SendLaterDialogProps) {
  const { t } = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("compose.later.title")} width="sm">
      {open && <SendLaterForm maxDelay={maxDelay} onClose={onClose} onPick={onPick} />}
    </Dialog>
  );
}

function SendLaterForm({ maxDelay, onClose, onPick }: Omit<SendLaterDialogProps, "open">) {
  const { t, i18n } = useT();
  const [now] = useState(() => new Date());
  const presets = sendLaterPresets(now);
  const [value, setValue] = useState(() => toLocalInput(presets[0]?.at ?? now));
  const [tried, setTried] = useState(false);
  const chosen = fromLocalInput(value);
  const problem = sendLaterProblem(chosen, maxDelay, new Date());
  const format = (date: Date) =>
    date.toLocaleString(i18n.language, { weekday: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <form
      className="flex flex-col gap-4 px-6 pt-2 pb-6"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (problem || !chosen) return;
        onPick(chosen.toISOString());
      }}
    >
      <ul className="flex flex-col gap-1">
        {presets.map(({ preset, at }) => (
          <li key={preset}>
            <button
              type="button"
              onClick={() => onPick(at.toISOString())}
              className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px] hover:bg-pink-tint/60"
            >
              <Clock className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">{t(`compose.later.${preset}`)}</span>
              <span className="shrink-0 text-[12.5px] text-muted">{format(at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Field
        label={t("compose.later.pick")}
        error={
          tried && problem ? t(`compose.later.problem.${problem}`, { days: Math.floor(maxDelay / 86400) }) : undefined
        }
      >
        {(id) => (
          <TextInput
            id={id}
            type="datetime-local"
            value={value}
            min={toLocalInput(now)}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary">
          {t("compose.later.schedule")}
        </Button>
      </div>
    </form>
  );
}
