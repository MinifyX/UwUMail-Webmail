import { Icon, ICONS } from "@uwusuite/design";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { requestOpenLink } from "@/state/links";
import { toast } from "@/state/toasts";
import {
  copyCode,
  formatCode,
  isActive,
  openableUrl,
  remaining,
  secondsLeft,
  useNow,
  type VerificationCode,
} from "./codes";

/** Copies the code, then shows a check mark for a moment and a toast. */
export function useCopyCode(): [string | null, (code: VerificationCode) => void] {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (code: VerificationCode) => {
    if (!code.code) return;
    void copyCode(code.code).then((ok) => {
      if (ok) {
        setCopied(code.id);
        toast(t("codes.copied", { code: formatCode(code.code!) }), "success");
      } else {
        toast(t("codes.copyFailed"), "error");
      }
    });
  };
  return [copied, copy];
}

/** Opens a signed sign-in link through the same checks and warning as links in a mail. */
export function openCodeLink(code: VerificationCode) {
  const url = openableUrl(code);
  if (url) requestOpenLink(url, url);
}

function NoAutofillTag() {
  const { t } = useTranslation();
  return (
    <Tooltip content={t("codes.noAutofillHint")}>
      <span className="inline-flex h-[22px] items-center rounded-full bg-warning-tint px-2 text-caption font-semibold whitespace-nowrap text-warning-ink">
        {t("codes.noAutofill")}
      </span>
    </Tooltip>
  );
}

interface ChipProps {
  code: VerificationCode;
  now: number;
  copied: boolean;
  onCopy: () => void;
}

function CodeChip({ code, now, copied, onCopy }: ChipProps) {
  const { t } = useTranslation();
  const heuristic = code.source === "heuristic";
  const low = secondsLeft(code.expiresAt, now) < 60;
  const Shield = heuristic ? ICONS.warning : ICONS.securityCheck;
  return (
    <li
      className={clsx(
        "flex flex-none items-center gap-2.5 rounded-full border bg-surface py-1.5 pr-1.5 pl-3",
        heuristic ? "border-dashed border-warning/60" : "border-line",
      )}
      aria-label={t(`codes.purpose.${code.purpose}`) + " · " + code.sender}
    >
      <Shield className={clsx("size-4 shrink-0", heuristic ? "text-warning" : "text-pink-ink")} aria-hidden />
      {code.kind === "otp" && code.code ? (
        <span className="font-mono text-reading font-bold tracking-[0.04em] tabular-nums">{formatCode(code.code)}</span>
      ) : (
        <span className="flex items-center gap-1.5 text-body font-semibold">
          <Icon icon={ICONS.link} className="text-pink-ink" />
          {t("codes.link")}
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-[180px] truncate text-meta">{code.origin}</span>
        <span className={clsx("text-caption font-semibold tabular-nums", low ? "text-warning-ink" : "text-muted")}>
          {t("codes.remaining", { time: remaining(code.expiresAt, now) })}
        </span>
      </span>
      {code.kind === "otp" && !code.autofill && <NoAutofillTag />}
      {openableUrl(code) ? (
        <Button size="sm" icon={ICONS.openExternal} onClick={() => openCodeLink(code)}>
          {t("codes.open")}
        </Button>
      ) : (
        code.code && (
          <IconButton
            size="sm"
            icon={copied ? ICONS.done : ICONS.copy}
            label={t("codes.copy")}
            active={copied}
            onClick={onCopy}
          />
        )
      )}
    </li>
  );
}

/**
 * The quiet row of chips above the list: one per code that is still valid. Renders nothing
 * without one; expired codes drop out by themselves.
 */
export function VerificationCodeBar({ codes }: { codes: VerificationCode[] }) {
  const { t } = useTranslation();
  const now = useNow(codes.length > 0);
  const [copied, copy] = useCopyCode();
  const active = codes.filter((code) => isActive(code, now));
  if (active.length === 0) return null;
  return (
    <section aria-label={t("codes.bar")} className="px-3">
      <ul className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-0.5 pt-0.5 pb-2.5">
        {active.map((code) => (
          <CodeChip key={code.id} code={code} now={now} copied={copied === code.id} onCopy={() => copy(code)} />
        ))}
      </ul>
    </section>
  );
}

/** The small mono chip before the subject of a row with a valid code. */
export function RowCodeChip({ code, selected }: { code: VerificationCode; selected?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-md px-1.5 font-mono text-caption font-bold tabular-nums",
        selected ? "bg-surface text-pink-ink" : "bg-pink-tint text-pink-ink",
      )}
    >
      {code.kind === "otp" && code.code ? formatCode(code.code) : t("codes.link")}
    </span>
  );
}

/** The banner above the mail text: where the code comes from and whether it may be filled in. */
export function CodeHint({ code }: { code: VerificationCode }) {
  const { t } = useTranslation();
  const now = useNow();
  const [copied, copy] = useCopyCode();
  const expired = !isActive(code, now);
  const heuristic = code.source === "heuristic";
  const tone = expired ? "info" : heuristic ? "warning" : "success";
  const time = remaining(code.expiresAt, now);
  const Glyph = expired ? ICONS.securityCheck : heuristic ? ICONS.warning : ICONS.securityCheck;
  const title =
    code.kind === "link"
      ? t("codes.hint.linkTitle", { origin: code.origin, time })
      : t("codes.hint.title", { code: formatCode(code.code ?? ""), origin: code.origin, time });
  const body = expired
    ? t("codes.hint.expired")
    : heuristic
      ? t("codes.hint.heuristic")
      : code.kind === "link"
        ? t("codes.hint.link")
        : code.autofill
          ? t("codes.hint.signed", { origin: code.origin })
          : t("codes.hint.signedNoAutofill");
  return (
    <div
      role="note"
      className={clsx(
        "flex items-center gap-2.5 rounded-control border px-3.5 py-2.5 text-meta",
        tone === "success" && "border-success/40 bg-success-tint text-success-ink",
        tone === "warning" && "border-warning/40 bg-warning-tint text-warning-ink",
        tone === "info" && "border-hairline bg-elevated text-muted",
      )}
    >
      <Icon icon={Glyph} size="md" className="shrink-0" />
      <div className="min-w-0 flex-1">
        {!expired && <p className="font-semibold">{title}</p>}
        <p>{body}</p>
      </div>
      {!expired &&
        (openableUrl(code) ? (
          <Button size="sm" icon={ICONS.openExternal} onClick={() => openCodeLink(code)}>
            {t("codes.open")}
          </Button>
        ) : (
          code.code && (
            <IconButton
              size="sm"
              icon={copied === code.id ? ICONS.done : ICONS.copy}
              label={t("codes.copy")}
              onClick={() => copy(code)}
            />
          )
        ))}
    </div>
  );
}
