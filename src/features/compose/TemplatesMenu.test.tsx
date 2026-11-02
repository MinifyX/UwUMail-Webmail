import "@/test/dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { SIGNATURE_ATTRIBUTE } from "@/lib/signatures";
import { useSettings, type MailTemplate } from "@/state/settings";
import { useUi } from "@/state/ui";
import { AttachmentReminderDialog } from "./AttachmentReminderDialog";
import {
  draftTemplateHtml,
  matchingTemplates,
  SaveTemplateDialog,
  insertableTemplateHtml,
  TemplatesMenu,
} from "./TemplatesMenu";

const VALUES = { firstName: "Ada", name: "Ada Lovelace", date: "1 May 2026", myName: "Me" };

const TEMPLATES: Record<string, MailTemplate> = {
  a: { name: "Thanks for your order", subject: "", html: "<p>Thanks!</p>" },
  b: { name: "Meeting notes", subject: "Notes", html: "<p>Notes</p>" },
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  useSettings.setState({ templates: TEMPLATES });
});
afterEach(cleanup);

describe("template html", () => {
  it("fills placeholders as text and cleans like a signature", () => {
    const html = insertableTemplateHtml(
      '<p>Hi {firstName}</p><script>alert(1)</script><img src="https://tracker.example.com/p.gif">',
      { ...VALUES, firstName: "<b>Ada</b>" },
    );
    expect(html).toContain("Hi &lt;b&gt;Ada&lt;/b&gt;");
    expect(html).not.toContain("script");
    expect(html).not.toContain("tracker.example.com");
  });

  it("saves only the own text: no signature, no quote", () => {
    const html = draftTemplateHtml(
      `<p>Hello there</p><div ${SIGNATURE_ATTRIBUTE}="x">Sig</div><p>On Monday, Bob wrote:</p><blockquote>old</blockquote>`,
    );
    expect(html).toBe("<p>Hello there</p>");
  });

  it("filters by every word of the query", () => {
    expect(matchingTemplates(TEMPLATES, "").map(([id]) => id)).toEqual(["b", "a"]);
    expect(matchingTemplates(TEMPLATES, "ORDER thanks").map(([id]) => id)).toEqual(["a"]);
    expect(matchingTemplates(TEMPLATES, "nothing")).toEqual([]);
  });
});

function Harness({ onPick }: { onPick: (template: MailTemplate) => void }) {
  const [open, setOpen] = useState(false);
  return <TemplatesMenu open={open} onOpenChange={setOpen} onPick={onPick} onSaveDraft={() => {}} />;
}

describe("TemplatesMenu", () => {
  it("narrows the list while typing and picks the first match with Enter", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert template" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    const filter = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "meet" } });
    expect(screen.queryByRole("menuitem", { name: "Thanks for your order" })).toBeNull();
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(TEMPLATES.b);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the template settings", () => {
    render(<Harness onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert template" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage templates…" }));
    expect(useUi.getState().settingsOpen).toBe("templates");
    useUi.getState().closeSettings();
  });
});

describe("SaveTemplateDialog", () => {
  it("keeps the subject and the cleaned own text", () => {
    useSettings.setState({ templates: {} });
    const onClose = vi.fn();
    render(
      <SaveTemplateDialog
        open
        subject="Order"
        html={() => `<p>Hi<img src="https://tracker.example.com/p.gif"></p><div ${SIGNATURE_ATTRIBUTE}="x">Sig</div>`}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(Object.values(useSettings.getState().templates)).toEqual([
      { name: "Order", subject: "Order", html: "<p>Hi</p>" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AttachmentReminderDialog", () => {
  it("offers sending anyway or attaching", () => {
    const onSend = vi.fn();
    const onAttach = vi.fn();
    render(<AttachmentReminderDialog open onClose={() => {}} onSend={onSend} onAttach={onAttach} />);
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onAttach).toHaveBeenCalledOnce();
  });
});
