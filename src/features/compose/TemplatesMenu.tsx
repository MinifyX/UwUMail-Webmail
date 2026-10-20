import { FileText, Pencil, Save, SquarePlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextInput } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { foreignHtml } from "@/lib/safeHtml";
import { MAX_VALUE_BYTES, valueBytes } from "@/lib/settingsSync";
import { cleanSignatureHtml, withoutSignatureMarker } from "@/lib/signatures";
import {
  cleanTemplateName,
  cleanTemplateSubject,
  newTemplateId,
  sortedTemplates,
  templateHtml,
  TEMPLATE_NAME_MAX,
  type TemplateValues,
} from "@/lib/templates";
import { useSettings, type MailTemplate } from "@/state/settings";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { splitDraft } from "../assist/draftText";

/**
 * A template's text as it goes into the draft: placeholders filled in and cleaned like foreign
 * markup (lib/templates), then like a signature (only embedded pictures). Templates come from the
 * account's shared settings, which other clients write too.
 */
export function insertableTemplateHtml(html: string, values: TemplateValues): string {
  return cleanSignatureHtml(templateHtml(html, values));
}

/** What "Save as template" keeps of a draft: the own text, without signature and quote, cleaned. */
export function draftTemplateHtml(html: string): string {
  return withoutSignatureMarker(cleanSignatureHtml(foreignHtml(splitDraft(html).own)));
}

/** Templates whose name has every word of `query` in it. */
export function matchingTemplates(templates: Record<string, MailTemplate>, query: string): [string, MailTemplate][] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sortedTemplates(templates).filter(([, template]) => {
    const name = template.name.toLocaleLowerCase();
    return words.every((word) => name.includes(word));
  });
}

/**
 * The composer's template button: put one in, keep the draft as one, or manage them. Opened from
 * the toolbar or by typing "/" in the text; the list can be narrowed by typing.
 */
export function TemplatesMenu({
  open,
  onOpenChange,
  onPick,
  onSaveDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: MailTemplate) => void;
  onSaveDraft: () => void;
}) {
  const { t } = useT();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const templates = useSettings((s) => s.templates);
  const [query, setQuery] = useState("");
  const hasTemplates = Object.keys(templates).length > 0;
  const matches = matchingTemplates(templates, query);
  /** Closes the menu; it opens again with an empty filter. */
  const close = () => {
    setQuery("");
    onOpenChange(false);
  };
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });

  useEffect(() => {
    if (!open) return;
    if (filter.current) filter.current.focus();
    else list.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) latestClose.current();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const select = (action: () => void) => {
    close();
    action();
  };

  const moveFocus = (step: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("input, [role=menuitem]") ?? [])] as HTMLElement[];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + step + items.length) % items.length]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      // Only the menu closes, not the composer behind it.
      event.preventDefault();
      event.stopPropagation();
      close();
      root.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
    }
  };

  const item =
    "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium break-words hover:bg-pink-tint/60 focus:bg-pink-tint/60 focus:outline-none";

  return (
    <div ref={root} className="relative inline-flex">
      <IconButton
        icon={SquarePlus}
        size="sm"
        label={t("templates.insert")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : onOpenChange(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
      />
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={t("templates.title")}
          onKeyDown={onKeyDown}
          className="absolute bottom-[calc(100%+6px)] left-0 z-40 flex max-h-[min(60vh,420px)] w-max max-w-[min(340px,calc(100vw-48px))] min-w-[240px] animate-pop flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-float"
        >
          {hasTemplates ? (
            <>
              <p
                role="presentation"
                className="px-3 pt-2 pb-1 text-[11px] font-bold tracking-wide text-muted uppercase"
              >
                {t("templates.title")}
              </p>
              <input
                ref={filter}
                type="search"
                value={query}
                aria-label={t("templates.filter")}
                placeholder={t("templates.filter")}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const first = matches[0];
                  if (first) select(() => onPick(first[1]));
                }}
                className="mx-1 mb-1 h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px] placeholder:text-faint focus:border-pink focus:outline-none"
              />
              {matches.map(([key, template]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  onClick={() => select(() => onPick(template))}
                  className={item}
                >
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">{template.name}</span>
                </button>
              ))}
              {matches.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">{t("templates.noMatch")}</p>}
            </>
          ) : (
            <p role="presentation" className="px-3 pt-2 pb-1 text-[13px] text-muted">
              {t("templates.none")}
            </p>
          )}
          <span className="mx-2 my-1 h-px bg-hairline" aria-hidden />
          <button type="button" role="menuitem" onClick={() => select(onSaveDraft)} className={item}>
            <Save className="size-4 shrink-0 text-muted" aria-hidden />
            {t("templates.saveDraft")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => select(() => useUi.getState().openSettings("templates"))}
            className={item}
          >
            <Pencil className="size-4 shrink-0 text-muted" aria-hidden />
            {t("templates.manage")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Keeps what the person wrote (no signature, no quote) and the subject as a new template. */
export function SaveTemplateDialog({
  open,
  subject,
  html,
  onClose,
}: {
  open: boolean;
  subject: string;
  /** The draft's body as it is when saving. */
  html: () => string;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("templates.saveDraft")} width="sm">
      {open && <SaveTemplateForm subject={subject} html={html} onClose={onClose} />}
    </Dialog>
  );
}

function SaveTemplateForm({ subject, html, onClose }: { subject: string; html: () => string; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(() => cleanTemplateName(subject));
  const save = () => {
    const template: MailTemplate = {
      name: cleanTemplateName(name) || t("templates.untitled"),
      subject: cleanTemplateSubject(subject),
      html: draftTemplateHtml(html()),
    };
    if (valueBytes(template) > MAX_VALUE_BYTES) {
      toast(t("templates.tooBig"), "error");
      return;
    }
    useSettings.getState().saveTemplate(newTemplateId(), template);
    toast(t("templates.saved", { name: template.name }), "success");
    onClose();
  };
  return (
    <form
      className="flex flex-col gap-4 px-6 pt-2 pb-6"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className="text-[13px] text-muted">{t("templates.saveDraftHint")}</p>
      <Field label={t("templates.name")}>
        {(fieldId) => (
          <TextInput
            id={fieldId}
            autoFocus
            placeholder={t("templates.namePlaceholder")}
            value={name}
            maxLength={TEMPLATE_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" type="submit">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
