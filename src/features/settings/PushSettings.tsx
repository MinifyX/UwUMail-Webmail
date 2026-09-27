import { useState } from "react";
import { Toggle } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { PushError, pushAvailable, serverOffersPush, setPushShowContent, switchPushOff, switchPushOn } from "@/push";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";

/**
 * "Notify me about new mail when the webmail is closed": Web Push for this browser. Off until
 * someone switches it on, which is when the browser asks for permission.
 */
export function PushSettings() {
  const { t } = useT();
  const enabled = useSettings((s) => s.pushNotifications);
  const showContent = useSettings((s) => s.pushShowContent);
  const update = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A server without Web Push has nothing to offer here.
  if (!serverOffersPush()) return null;
  const possible = pushAvailable();

  const toggle = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      if (on) {
        await switchPushOn();
        update({ pushNotifications: true });
        toast(t("push.enabled"), "success");
      } else {
        update({ pushNotifications: false });
        await switchPushOff();
      }
    } catch (error) {
      update({ pushNotifications: false });
      // Nothing half-done stays behind.
      await switchPushOff().catch(() => undefined);
      const reason = error instanceof PushError ? error.reason : "failed";
      setProblem(t(`push.problem.${reason}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-hairline py-4 last:border-0">
      <Toggle
        checked={enabled}
        disabled={busy || !possible}
        onChange={(on) => void toggle(on)}
        label={t("push.label")}
        description={t("push.description")}
      />
      {!possible && <p className="text-[12.5px] text-warning">{t("push.problem.unsupported")}</p>}
      {problem && (
        <p role="alert" className="text-[12.5px] text-danger">
          {problem}
        </p>
      )}
      {enabled && possible && (
        <Toggle
          checked={showContent}
          onChange={(on) => {
            update({ pushShowContent: on });
            void setPushShowContent(on);
          }}
          label={t("push.showContent")}
          description={t("push.showContentDesc")}
        />
      )}
    </div>
  );
}
