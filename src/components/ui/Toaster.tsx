import { Icon, ICONS, type Toast as PackageToast, Toaster as PackageToaster, type ToastStore } from "@uwusuite/design";
import { useEffect, useState } from "react";
import { LogoSymbol } from "@/components/ui/Logo";
import { useT } from "@/i18n";
import { useBrand } from "@/state/brand";
import { type Toast, useToasts } from "@/state/toasts";

// Most of UwUMail's notes are about a mail (archived, sent, moved), so "info" shows the envelope.
const TONE_ICONS = { info: ICONS.mail, success: ICONS.success, error: ICONS.error } as const;

function toastIcon(item: Toast) {
  return (
    <>
      <Icon
        icon={TONE_ICONS[item.tone]}
        size="md"
        className={item.tone === "error" ? "text-toast-danger" : "text-toast-accent"}
      />
      {item.effect === "sent" && useBrand.getState().mascot && (
        <LogoSymbol mood="happy" className="nyu-flyer pointer-events-none absolute -top-2 -left-2 h-8 w-auto" />
      )}
    </>
  );
}

/**
 * The webmail keeps its own toast state (a duration per toast: the undo toast of a held-back mail
 * lives exactly as long as the delay) and hands it to the package's toast stack through this view.
 * Envelope icon, Nyu flying off with a sent mail and the countdown ride along as `icon`/`detail`.
 */
function createStoreView(): ToastStore {
  let source: Toast[] | null = null;
  let mapped: PackageToast[] = [];
  const get = () => {
    const toasts = useToasts.getState().toasts;
    if (toasts !== source) {
      source = toasts;
      mapped = toasts.map((item) => ({
        id: item.id,
        message: item.message,
        tone: item.tone,
        action: item.action,
        icon: toastIcon(item),
        detail: item.countdownTo ? <Countdown to={item.countdownTo} /> : undefined,
      }));
    }
    return mapped;
  };
  return {
    show: (message, options = {}) =>
      useToasts.getState().show(String(message), options.tone, undefined, { action: options.action }),
    dismiss: (id) => useToasts.getState().dismiss(id),
    subscribe(listener) {
      const unsubscribe = useToasts.subscribe(listener);
      return () => {
        unsubscribe();
        return true;
      };
    },
    get,
  };
}

const toastStore = createStoreView();

/** The package's toast stack: bottom centre, at the top on phones. */
export function Toaster() {
  return <PackageToaster store={toastStore} />;
}

/** Whole seconds left until `to`, e.g. until a held-back mail goes out. */
function Countdown({ to }: { to: string }) {
  const { i18n } = useT();
  const left = () => Math.max(0, Math.ceil((Date.parse(to) - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(left()), 250);
    return () => window.clearInterval(timer);
    // `left` only reads `to`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  const text = new Intl.NumberFormat(i18n.language, { style: "unit", unit: "second", unitDisplay: "narrow" }).format(
    seconds,
  );
  return <span className="tabular-nums">{text}</span>;
}
