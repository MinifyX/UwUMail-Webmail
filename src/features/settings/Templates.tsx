import { Bold, Italic, Link, List, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { insertDroppedHtml } from "@/features/compose/droppedHtml";
import { useT } from "@/i18n";
import { foreignHtml, htmlToPlainText, isSafeLinkTarget } from "@/lib/safeHtml";
import { MAX_VALUE_BYTES, valueBytes } from "@/lib/settingsSync";
import { cleanSignatureHtml } from "@/lib/signatures";
import {
  cleanTemplateName,
  cleanTemplateSubject,
  newTemplateId,
  sortedTemplates,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_SUBJECT_MAX,
} from "@/lib/templates";
import { useSettings, type MailTemplate } from "@/state/settings";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { Row } from "./Row";

const EMPTY: MailTemplate = { name: "", subject: "", html: "" };

/**
 * Template markup as it is shown, edited and kept: cleaned like a signature (no scripts, styles,
 * forms or remote content, none of the app's own markers), since other devices write it too.
 */
export function cleanTemplateHtml(html: string): string {
  return cleanSignatureHtml(foreignHtml(html));
}

/** Settings → Templates: the templates the composer offers (button and "/"), new, edited, removed. */
export function Templates() {
  const { t } = useT();
  const templates = useSettings((s) => s.templates);
  const deleteTemplate = useSettings((s) => s.deleteTemplate);
  /** The template open in the editor: its id, or "new". */
  const [editing, setEditing] = useState<string | null>(null);
  const setSettingsFormDirty = useUi((s) => s.setSettingsFormDirty);
  useEffect(() => {
    setSettingsFormDirty(editing !== null);
    return () => setSettingsFormDirty(false);
  }, [editing, setSettingsFormDirty]);

  const save = (id: string, template: MailTemplate) => {
    if (valueBytes(template) > MAX_VALUE_BYTES) {
      toast(t("templates.tooBig"), "error");
      return;
    }
    useSettings.getState().saveTemplate(id, template);
    setEditing(null);
  };

  return (
    <Row label={t("templates.title")} description={t("templates.desc")}>
      <div className="flex flex-col gap-2">
        {sortedTemplates(templates).map(([id, template]) =>
          editing === id ? (
            <TemplateEditor
              key={id}
              template={template}
              onSave={(next) => save(id, next)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{template.name}</span>
                <span className="block truncate text-[12px] text-muted">
                  {template.subject || htmlToPlainText(cleanTemplateHtml(template.html)).slice(0, 120)}
                </span>
              </span>
              <IconButton
                icon={Pencil}
                size="sm"
                label={t("templates.edit", { name: template.name })}
                onClick={() => setEditing(id)}
              />
              <IconButton
                icon={Trash2}
                size="sm"
                label={t("templates.delete", { name: template.name })}
                onClick={() => {
                  deleteTemplate(id);
                  toast(t("templates.deleted", { name: template.name }));
                }}
              />
            </div>
          ),
        )}
        {editing === "new" ? (
          <TemplateEditor
            template={EMPTY}
            onSave={(next) => save(newTemplateId(), next)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={() => setEditing("new")}>
            {t("templates.add")}
          </Button>
        )}
      </div>
    </Row>
  );
}

/** Name, subject and a rich text with the placeholders, cleaned like a signature. */
function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: MailTemplate;
  onSave: (template: MailTemplate) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const editor = useRef<HTMLDivElement | null>(null);
  /** A drag that started in the editor itself: moving text, not markup from elsewhere. */
  const draggingInside = useRef(false);

  const format = (command: "bold" | "italic" | "insertUnorderedList" | "createLink") => {
    editor.current?.focus();
    if (command === "createLink") {
      const url = window.prompt(t("compose.linkPrompt"), "https://");
      if (url && isSafeLinkTarget(url)) document.execCommand("createLink", false, url.trim());
      return;
    }
    document.execCommand(command);
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name: cleanTemplateName(name) || t("templates.untitled"),
          subject: cleanTemplateSubject(subject),
          html: cleanTemplateHtml(editor.current?.innerHTML ?? ""),
        });
      }}
    >
      <TextInput
        autoFocus
        aria-label={t("templates.name")}
        placeholder={t("templates.namePlaceholder")}
        value={name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        className="h-10"
      />
      <TextInput
        aria-label={t("templates.subject")}
        placeholder={t("templates.subjectPlaceholder")}
        value={subject}
        maxLength={TEMPLATE_SUBJECT_MAX}
        onChange={(event) => setSubject(event.target.value)}
        className="h-10"
      />
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex flex-wrap items-center gap-1 border-b border-hairline bg-canvas px-1.5 py-1">
          <IconButton
            icon={Bold}
            size="sm"
            label={t("compose.bold")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => format("bold")}
          />
          <IconButton
            icon={Italic}
            size="sm"
            label={t("compose.italic")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => format("italic")}
          />
          <IconButton
            icon={List}
            size="sm"
            label={t("compose.list")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => format("insertUnorderedList")}
          />
          <IconButton
            icon={Link}
            size="sm"
            label={t("compose.link")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => format("createLink")}
          />
          {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
            <button
              key={placeholder}
              type="button"
              title={t(`templates.placeholder.${placeholder}`)}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[12px] text-muted hover:border-pink"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.current?.focus();
                document.execCommand("insertText", false, `{${placeholder}}`);
              }}
            >
              {`{${placeholder}}`}
            </button>
          ))}
        </div>
        <div
          ref={(node) => {
            editor.current = node;
            if (node && node.innerHTML === "" && template.html) node.innerHTML = cleanTemplateHtml(template.html);
          }}
          contentEditable
          role="textbox"
          aria-multiline
          aria-label={t("templates.text")}
          data-placeholder={t("templates.textPlaceholder")}
          onPaste={(event) => {
            // Cleaned before it lands in the page, as in the composer.
            const html = event.clipboardData.getData("text/html");
            const text = event.clipboardData.getData("text/plain");
            if (!html && !text) return;
            event.preventDefault();
            const cleaned = html
              ? cleanTemplateHtml(html)
              : text
                  .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
                  .replace(/\r?\n/g, "<br>");
            document.execCommand("insertHTML", false, cleaned);
          }}
          onDragStart={() => {
            draggingInside.current = true;
          }}
          onDragEnd={() => {
            draggingInside.current = false;
          }}
          onDrop={(event) => {
            if (!draggingInside.current) insertDroppedHtml(event, cleanTemplateHtml);
          }}
          className="min-h-28 px-3 py-2 text-[14px] leading-relaxed outline-none empty:before:pointer-events-none empty:before:text-faint empty:before:content-[attr(data-placeholder)] [&_a]:text-pink-ink [&_a]:underline [&_img]:inline-block [&_img]:max-w-full [&_p]:min-h-[1.4em] [&_ul]:list-disc [&_ul]:pl-6"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
