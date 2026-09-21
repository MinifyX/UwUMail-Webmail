import { useEffect, useState } from "react";
import { NyuScene } from "@/components/nyu/scenes";
import { Button } from "@/components/ui/Button";
import { Toaster } from "@/components/ui/Toaster";
import { DangerousFileQuestion } from "@/features/attachments/DangerousFileQuestion";
import { DeleteForeverQuestion } from "@/features/mail/DeleteForeverQuestion";
import { LinkSheet, LinkStatus } from "@/features/mail/LinkPreview";
import { LinkWarning } from "@/features/mail/LinkWarning";
import { MailShell } from "@/features/shell/MailShell";
import { i18n, resolveLanguage, useT } from "@/i18n";
import { BackendError, isDemo, loadBackend } from "@/backend/backend";
import { PORTAL_URL, loadSession, webmailAccess } from "@/backend/server";
import { useApplyTheme } from "@/lib/theme";
import { startSettingsSync } from "@/state/accountSync";
import { applyServerPreferences, useSettings } from "@/state/settings";

type Boot =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "signedOut" }
  | { state: "off"; reason: "server" | "account" }
  | { state: "error"; message: string };

/** Sends someone to the portal's login and back here afterwards. */
function toLogin(): void {
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.replace(`${PORTAL_URL}?next=${next}`);
}

function Message({
  scene,
  title,
  children,
  action,
}: {
  scene: "noAccount" | "loadError" | "offline";
  title: string;
  children: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <NyuScene name={scene} className="w-[220px]" />
      <h1 className="text-[20px] font-bold text-ink">{title}</h1>
      <p className="text-ink-soft max-w-[420px] text-[14px]">{children}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

function BootScreen({ boot }: { boot: Exclude<Boot, { state: "ready" }> }) {
  const { t } = useT();
  if (boot.state === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <NyuScene name="offline" className="w-[160px] animate-pulse" />
        <span className="sr-only">{t("status.loading")}</span>
      </div>
    );
  }
  if (boot.state === "signedOut") {
    return (
      <Message
        scene="noAccount"
        title={t("boot.signedOut.title")}
        action={{ label: t("boot.signedOut.action"), onClick: toLogin }}
      >
        {t("boot.signedOut.body")}
      </Message>
    );
  }
  if (boot.state === "off") {
    return (
      <Message
        scene="noAccount"
        title={t("boot.off.title")}
        action={{ label: t("boot.toPortal"), onClick: () => window.location.assign(PORTAL_URL) }}
      >
        {boot.reason === "server" ? t("boot.off.server") : t("boot.off.account")}
      </Message>
    );
  }
  return (
    <Message
      scene="loadError"
      title={t("boot.error.title")}
      action={{ label: t("boot.error.action"), onClick: () => window.location.reload() }}
    >
      {boot.message}
    </Message>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const language = useSettings((s) => s.language);
  useApplyTheme();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Sample data means no server at all: asking it who is signed in would be the one call
        // that still needs one.
        if (isDemo()) {
          await loadBackend();
          void startSettingsSync();
          if (!cancelled) setBoot({ state: "ready" });
          return;
        }
        const session = await loadSession();
        if (cancelled) return;
        if (!session) {
          setBoot({ state: "signedOut" });
          return;
        }
        applyServerPreferences(session.preferences);
        const access = await webmailAccess();
        if (cancelled) return;
        if (!access.allowed) {
          setBoot({ state: "off", reason: access.reason ?? "server" });
          return;
        }
        await loadBackend();
        // The settings that follow the account come from the server's settings extension.
        void startSettingsSync();
        if (!cancelled) setBoot({ state: "ready" });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof BackendError && error.code === "signed_out") {
          setBoot({ state: "signedOut" });
          return;
        }
        if (error instanceof BackendError && error.code === "webmail_disabled") {
          setBoot({ state: "off", reason: "server" });
          return;
        }
        setBoot({ state: "error", message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const resolved = resolveLanguage(language);
    void i18n.changeLanguage(resolved);
    document.documentElement.lang = resolved;
  }, [language]);

  return (
    <>
      {boot.state === "ready" ? <MailShell /> : <BootScreen boot={boot} />}
      <LinkWarning />
      <LinkSheet />
      <LinkStatus />
      <DeleteForeverQuestion />
      <DangerousFileQuestion />
      <Toaster />
    </>
  );
}
