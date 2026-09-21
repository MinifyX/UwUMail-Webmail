import { SlidersHorizontal } from "lucide-react";
import { PORTAL_URL } from "@/backend/server";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { useIdentities } from "@/lib/queries";
import { UNDO_SEND_CHOICES, useSettings, type UndoSendSeconds } from "@/state/settings";
import { Row } from "./Row";

/**
 * Writing settings.
 *
 * Sender addresses belong to the server, so they are shown but not edited
 * here: new addresses and aliases are made in the portal. Signatures land on
 * the server with its settings extension and will show up here then.
 */
export function Writing() {
  const { t } = useT();
  const undoSendSeconds = useSettings((s) => s.undoSendSeconds);
  const update = useSettings((s) => s.update);
  return (
    <>
      <Row label={t("settings.undoSend")} description={t("settings.undoSendDesc")}>
        <Segmented
          label={t("settings.undoSend")}
          value={String(undoSendSeconds)}
          onChange={(value) => update({ undoSendSeconds: Number(value) as UndoSendSeconds })}
          options={UNDO_SEND_CHOICES.map((seconds) => ({
            value: String(seconds),
            label: seconds === 0 ? t("settings.undoSendOff") : t("settings.seconds", { count: seconds }),
          }))}
        />
      </Row>
      <Senders />
    </>
  );
}

function Senders() {
  const { t } = useT();
  const { data: identities = [] } = useIdentities();
  return (
    <Row label={t("settings.senders")} description={t("settings.sendersFromServer")}>
      <ul className="flex flex-col gap-1 rounded-2xl border border-hairline p-2">
        {identities.map((identity) => (
          <li key={identity.id} className="flex flex-wrap items-baseline gap-x-2 rounded-xl px-2 py-1.5">
            <span className="selectable min-w-0 flex-1 truncate text-[13.5px] font-semibold">{identity.email}</span>
            <span className="text-[12px] text-muted">
              {identity.primary ? t("settings.senderOwn") : t("settings.senderFromServer")}
            </span>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        icon={SlidersHorizontal}
        className="self-start"
        onClick={() => window.location.assign(`${PORTAL_URL}account/addresses`)}
      >
        {t("settings.manageAddresses")}
      </Button>
    </Row>
  );
}
