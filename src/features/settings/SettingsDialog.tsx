import clsx from "clsx";
import { ExternalLink, ImageIcon, Info, Keyboard, Mail, Palette, PenLine, SlidersHorizontal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import pkg from "../../../package.json";
import { backend } from "@/backend/backend";
import { PORTAL_URL } from "@/backend/server";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDiscardDialog } from "@/components/ui/ConfirmDiscardDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Segmented, Select, Toggle } from "@/components/ui/Field";
import { LogoSymbol } from "@/components/ui/Logo";
import { i18n, useT } from "@/i18n";
import { useIsPhone } from "@/lib/device";
import { openLinkNow } from "@/state/links";
import { isDomainEntry, sortEntries } from "@/lib/trustedSenders";
import { useSettings, type LanguageSetting, type SwipeAction } from "@/state/settings";
import { toast } from "@/state/toasts";
import { BlockedSenders } from "./BlockedSenders";
import { Row } from "./Row";
import { Writing } from "./Writing";
import { useUi, type SettingsSection } from "@/state/ui";

/**
 * Only what belongs to reading and writing mail.
 *
 * Everything about the account itself — password, two-factor, forwarding, away
 * messages, aliases, spam rules — already has a place in the portal, so it is
 * a link from here instead of a second interface that could drift apart.
 */
const SECTIONS: { id: SettingsSection; icon: LucideIcon }[] = [
  { id: "appearance", icon: Palette },
  { id: "mail", icon: Mail },
  { id: "compose", icon: PenLine },
  { id: "about", icon: Info },
];

function Appearance() {
  const { t } = useT();
  const settings = useSettings();
  return (
    <>
      <Row label={t("settings.listDensity")} description={t("settings.listDensityDesc")}>
        <Segmented
          label={t("settings.listDensity")}
          value={settings.listDensity}
          onChange={(listDensity) => settings.update({ listDensity })}
          options={[
            { value: "relaxed", label: t("density.relaxed") },
            { value: "compact", label: t("density.compact") },
          ]}
        />
      </Row>
      <Row label={t("settings.theme")}>
        <Segmented
          label={t("settings.theme")}
          value={settings.theme}
          onChange={(theme) => settings.update({ theme })}
          options={[
            { value: "system", label: t("theme.system") },
            { value: "light", label: t("theme.light") },
            { value: "dark", label: t("theme.dark") },
          ]}
        />
      </Row>
      <Row label={t("settings.motion")} description={t("settings.motionDesc")}>
        <Segmented
          label={t("settings.motion")}
          value={settings.motion}
          onChange={(motion) => settings.update({ motion })}
          options={[
            { value: "system", label: t("motion.system") },
            { value: "on", label: t("motion.on") },
            { value: "off", label: t("motion.off") },
          ]}
        />
      </Row>
      <Row
        label={t("settings.tone")}
        description={t("tone.sample", { text: i18n.getFixedT(null, settings.tone)("toast.sent") })}
      >
        <Segmented
          label={t("settings.tone")}
          value={settings.tone}
          onChange={(tone) => settings.update({ tone })}
          options={[
            { value: "playful", label: t("tone.playful.name") },
            { value: "neutral", label: t("tone.neutral.name") },
          ]}
        />
      </Row>
      <Row label={t("settings.language")} description={t("settings.sharedWithPortal")}>
        <Select
          aria-label={t("settings.language")}
          value={settings.language}
          onChange={(event) => settings.update({ language: event.target.value as LanguageSetting })}
          className="max-w-[240px]"
        >
          <option value="system">{t("language.system")}</option>
          <option value="de">{t("language.de")}</option>
          <option value="en">{t("language.en")}</option>
        </Select>
      </Row>
    </>
  );
}

function TrustedSenders() {
  const { t } = useT();
  const trusted = useSettings((s) => s.trustedSenders);
  const remoteImages = useSettings((s) => s.remoteImages);
  const untrustSenders = useSettings((s) => s.untrustSenders);
  const entries = sortEntries(trusted);

  return (
    <Row label={t("settings.trustedSenders")} description={t("settings.trustedSendersDesc")}>
      {remoteImages === "always" && entries.length > 0 && (
        <p className="text-[12.5px] text-warning">{t("settings.trustedSendersInactive")}</p>
      )}
      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          {t("settings.trustedSendersEmpty")}
        </p>
      ) : (
        <ul
          className={clsx(
            "flex max-h-56 flex-col overflow-y-auto rounded-2xl border border-hairline p-1",
            remoteImages === "always" && "opacity-60",
          )}
        >
          {entries.map((entry) => (
            <li key={entry} className="flex items-center gap-3 rounded-xl py-1 pr-1 pl-3 hover:bg-elevated">
              <ImageIcon className="size-4 shrink-0 text-faint" aria-hidden />
              <span className="selectable min-w-0 flex-1 truncate text-[13.5px]">
                {isDomainEntry(entry) ? (
                  <>
                    <span className="text-muted">@</span>
                    <span className="font-semibold">{entry.slice(1)}</span>
                  </>
                ) : (
                  entry
                )}
              </span>
              <IconButton
                icon={X}
                size="sm"
                label={t("settings.untrustSender", { sender: entry })}
                onClick={() => untrustSenders([entry])}
              />
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

const SWIPE_ACTIONS: SwipeAction[] = ["read", "archive", "trash", "flag", "none"];

function SwipeSelect({ value, onChange }: { value: SwipeAction; onChange: (value: SwipeAction) => void }) {
  const { t } = useT();
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value as SwipeAction)} className="max-w-[240px]">
      {SWIPE_ACTIONS.map((action) => (
        <option key={action} value={action}>
          {t(`mobile.swipe.${action}`)}
        </option>
      ))}
    </Select>
  );
}

function Reading() {
  const { t } = useT();
  const settings = useSettings();
  const phone = useIsPhone();
  return (
    <>
      <div className="border-b border-hairline py-4">
        <Toggle
          checked={settings.conversations}
          onChange={(conversations) => settings.update({ conversations })}
          label={t("settings.conversations")}
          description={t("settings.conversationsDesc")}
        />
      </div>
      <Row label={t("settings.remoteImages")} description={t("settings.remoteImagesDesc")}>
        <Segmented
          label={t("settings.remoteImages")}
          value={settings.remoteImages}
          onChange={(remoteImages) => settings.update({ remoteImages })}
          options={[
            { value: "ask", label: t("settings.remoteAsk") },
            { value: "always", label: t("settings.remoteAlways") },
          ]}
        />
      </Row>
      <TrustedSenders />
      <BlockedSenders />
      <Row label={t("settings.mailAppearance")} description={t("settings.mailAppearanceDesc")}>
        <Segmented
          label={t("settings.mailAppearance")}
          value={settings.mailAppearance}
          onChange={(mailAppearance) => settings.update({ mailAppearance })}
          options={[
            { value: "auto", label: t("settings.mailAppearanceAuto") },
            { value: "light", label: t("settings.mailAppearanceLight") },
            { value: "dark", label: t("settings.mailAppearanceDark") },
          ]}
        />
        {Object.keys(settings.senderAppearance).length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              settings.forgetAppearances();
              toast(t("settings.appearancesForgotten"), "success");
            }}
          >
            {t("settings.forgetAppearances", { count: Object.keys(settings.senderAppearance).length })}
          </Button>
        )}
      </Row>
      {phone && (
        <Row label={t("settings.swipeRight")} description={t("settings.swipeDesc")}>
          <SwipeSelect value={settings.swipeRight} onChange={(swipeRight) => settings.update({ swipeRight })} />
          <p className="pt-1 text-sm font-semibold">{t("settings.swipeLeft")}</p>
          <SwipeSelect value={settings.swipeLeft} onChange={(swipeLeft) => settings.update({ swipeLeft })} />
        </Row>
      )}
    </>
  );
}

function About() {
  const { t } = useT();
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <LogoSymbol className="h-20 w-auto" title="UwUMail" />
      <div>
        <p className="text-[20px] font-extrabold">
          <span className="text-pink">UwU</span>Mail
        </p>
        <p className="text-[13px] text-muted">{t("settings.version", { version: pkg.version })}</p>
      </div>
      <p className="max-w-[360px] text-[13px] text-muted">{t("settings.license")}</p>
      {backend().kind === "demo" && (
        <p className="rounded-full bg-pink-tint px-3 py-1 text-[12.5px] font-semibold text-pink-ink">
          {t("status.demo")}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button icon={SlidersHorizontal} onClick={() => window.location.assign(PORTAL_URL)}>
          {t("nav.portal")}
        </Button>
        <Button icon={ExternalLink} onClick={() => void openLinkNow("https://github.com/MinifyX/UwUMail-Webmail")}>
          {t("settings.source")}
        </Button>
        <Button icon={Keyboard} onClick={() => setShortcutsOpen(true)}>
          {t("settings.shortcuts")}
        </Button>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const { t } = useT();
  const section = useUi((s) => s.settingsOpen);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const formDirty = useUi((s) => s.settingsFormDirty);
  // What the question is standing in front of: closing the window, or the section to switch to.
  const [pending, setPending] = useState<"close" | SettingsSection | null>(null);

  const requestClose = () => {
    if (formDirty) setPending("close");
    else closeSettings();
  };
  // Switching section unmounts whatever is being edited, so it asks like closing does.
  const requestSection = (id: SettingsSection) => {
    if (formDirty && id !== section) setPending(id);
    else openSettings(id);
  };
  const discard = () => {
    const target = pending;
    setPending(null);
    if (target === "close") closeSettings();
    else if (target) openSettings(target);
  };

  return (
    <>
      <Dialog
        open={section !== null}
        onClose={requestClose}
        closeOnOutsideClick={!formDirty}
        title={t("settings.title")}
        width="lg"
      >
        <div className="flex min-h-[460px] flex-col gap-2 px-4 pb-5 sm:flex-row sm:gap-6 sm:px-6">
          <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-48 sm:flex-col" aria-label={t("settings.title")}>
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => requestSection(id)}
                aria-current={section === id ? "page" : undefined}
                className={clsx(
                  "flex h-10 shrink-0 items-center gap-3 rounded-xl px-3 text-left text-[13.5px] font-semibold transition-colors",
                  section === id ? "bg-pink-tint text-pink-ink" : "text-muted hover:bg-pink-tint/50 hover:text-ink",
                )}
              >
                <Icon className="size-[17px]" aria-hidden />
                {t(`settings.${id}`)}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {section === "appearance" && <Appearance />}
            {section === "mail" && <Reading />}
            {section === "compose" && <Writing />}
            {section === "about" && <About />}
          </div>
        </div>
      </Dialog>
      <ConfirmDiscardDialog open={pending !== null} onKeepEditing={() => setPending(null)} onDiscard={discard} />
    </>
  );
}
