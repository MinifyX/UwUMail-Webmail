import { Button, Dialog, Toggle } from "@uwusuite/design";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { NyuScene } from "@/components/nyu/scenes";
import { useT } from "@/i18n";
import { setShipmentsEnabled, useShipmentsSupport } from "./useShipments";

/**
 * The account's switch for parcels, only where the server offers them. Off deletes the parcels
 * the server found, so it asks first.
 */
export function ShipmentsSetting() {
  const { t } = useT();
  const client = useQueryClient();
  const { data: support } = useShipmentsSupport();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  if (!support?.offered) return null;

  const change = async (on: boolean) => {
    setAsking(false);
    setBusy(true);
    await setShipmentsEnabled(client, on);
    setBusy(false);
  };

  return (
    <div className="border-b border-hairline py-4 last:border-0">
      <Toggle
        checked={support.enabled}
        disabled={busy}
        onChange={(on) => (on ? void change(true) : setAsking(true))}
        label={t("settings.shipments")}
        description={t("settings.shipmentsDesc")}
      />
      <Dialog open={asking} onClose={() => setAsking(false)} width="sm" labelledBy={titleId}>
        {asking && (
          <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
            <NyuScene name="goodbye" className="w-36" />
            <h2 id={titleId} className="text-section font-extrabold text-balance">
              {t("settings.shipmentsOffTitle")}
            </h2>
            <p className="text-meta text-muted">{t("settings.shipmentsOffBody")}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button variant="primary" autoFocus onClick={() => setAsking(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={() => void change(false)}>
                {t("settings.shipmentsOff")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
