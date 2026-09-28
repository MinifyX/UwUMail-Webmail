import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { Message, UnsubscribeFallback } from "@/backend/types";
import { NyuScene } from "@/components/nyu/scenes";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Toggle } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { displayName } from "@/lib/format";
import { unsubscribeMail } from "@/lib/unsubscribe";
import { requestOpenLink } from "@/state/links";
import { toast } from "@/state/toasts";
import { announceMove } from "@/state/undo";
import { useUi } from "@/state/ui";

/** "Unsubscribe" next to the sender of a newsletter, with a question first. */
export function UnsubscribeButton({ message }: { message: Message }) {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  if (!message.unsubscribe) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)} className="h-7 px-2.5 text-[12.5px]">
        {t("reader.unsubscribe")}
      </Button>
      <Dialog open={asking} onClose={() => setAsking(false)} width="sm">
        {asking && <UnsubscribeQuestion message={message} onDone={() => setAsking(false)} />}
      </Dialog>
    </>
  );
}

function UnsubscribeQuestion({ message, onDone }: { message: Message; onDone: () => void }) {
  const { t } = useT();
  const client = useQueryClient();
  const [archive, setArchive] = useState(true);
  const [busy, setBusy] = useState(false);
  // The server's one click was tried and the sender's side didn't take it.
  const [failed, setFailed] = useState<{ reason: string; fallback: UnsubscribeFallback } | null>(null);
  const name = displayName(message.from);
  const options = message.unsubscribe;
  const oneClick = options?.oneClick === true;
  // Unsubscribing sends a mail whenever the header carries a mailto address and the one click
  // isn't taken (the backend prefers the mail over a page, regardless of the One-Click flag), so
  // the dialog always names that address first — also when the mail is only the way back if the
  // one click can't be done (security-audit W-5). Only a page-only header opens a page instead.
  const byMail = options?.mailto ? unsubscribeMail(options.mailto) : null;
  const pageOnly = !byMail;

  const unsubscribe = async (tryOneClick: boolean) => {
    setBusy(true);
    try {
      const outcome = await backend().unsubscribe(message.id, tryOneClick ? {} : { oneClick: false });
      if (outcome.kind === "oneClickFailed") {
        setFailed({ reason: outcome.reason, fallback: outcome.fallback });
        setBusy(false);
        return;
      }
      if (outcome.kind === "openPage") {
        // The page comes from the mail like any link in it, so it goes through the same question.
        if (requestOpenLink(outcome.url, "") === "opened") toast(t("toast.unsubscribePage", { name }));
      } else {
        toast(t("toast.unsubscribed", { name }), "success");
      }
      if (archive) {
        const ids = await backend().inboxMessagesFrom(message.from.email);
        if (ids.length > 0) {
          useUi.getState().selectThread(null);
          announceMove(await backend().archive(ids), t("toast.unsubscribeArchived", { count: ids.length }), () =>
            client.invalidateQueries(),
          );
        }
      }
      onDone();
    } catch (reason) {
      toast(
        t("toast.unsubscribeFailed", { reason: reason instanceof Error ? reason.message : String(reason) }),
        "error",
      );
      setBusy(false);
    } finally {
      await client.invalidateQueries();
    }
  };

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
        <NyuScene name="loadError" className="w-40" />
        <h2 className="text-[18px] font-extrabold text-balance">{t("unsubscribe.failedTitle")}</h2>
        <p className="text-[13px] text-muted">
          {failed.reason ? t("unsubscribe.failed", { reason: failed.reason }) : t("unsubscribe.failedNoReason")}
        </p>
        <p className="text-[13px] text-muted">
          {failed.fallback === "mail" && byMail
            ? t("unsubscribe.tryMail", { address: byMail.address })
            : failed.fallback === "page"
              ? t("unsubscribe.tryPage")
              : t("unsubscribe.noOtherWay")}
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          {failed.fallback && (
            <Button variant="primary" busy={busy} autoFocus onClick={() => void unsubscribe(false)}>
              {failed.fallback === "mail" ? t("unsubscribe.sendMail") : t("unsubscribe.openPage")}
            </Button>
          )}
          <Button variant="ghost" autoFocus={!failed.fallback} onClick={onDone}>
            {failed.fallback ? t("common.cancel") : t("common.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
      <NyuScene name="pick" className="w-40" />
      <h2 className="text-[18px] font-extrabold text-balance">{t("unsubscribe.title", { name })}</h2>
      <p className="text-[13px] text-muted">
        {oneClick ? t("unsubscribe.bodyOneClick") : pageOnly ? t("unsubscribe.bodyPage") : t("unsubscribe.body")}
      </p>
      {byMail && (
        // The address comes out of the newsletter's own header, and the mail goes out under the
        // reader's name. Whoever is about to send it gets to see where it lands.
        <p className="text-[13px] text-muted">
          {oneClick
            ? t("unsubscribe.orMail", { address: byMail.address })
            : t("unsubscribe.mailTo", { address: byMail.address })}
        </p>
      )}
      {oneClick && !byMail && options?.url && <p className="text-[13px] text-muted">{t("unsubscribe.orPage")}</p>}
      <div className="w-full rounded-2xl bg-canvas px-4 py-1 text-left">
        <Toggle checked={archive} onChange={setArchive} label={t("unsubscribe.archive")} />
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button variant="primary" busy={busy} autoFocus onClick={() => void unsubscribe(true)}>
          {t("reader.unsubscribe")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
