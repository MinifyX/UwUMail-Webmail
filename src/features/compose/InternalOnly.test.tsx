import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, OutgoingMessage, SendPolicy } from "@/backend/types";
import { i18n } from "@/i18n";
import { useUi } from "@/state/ui";
import { Composer } from "./Composer";

const ACCOUNT: Account = {
  id: "acc",
  name: "Work",
  email: "mini@uwumail.example",
  displayName: "Mini",
  color: "pink",
  auth: "password",
  status: { state: "idle" },
  protocol: "jmap",
  protocols: ["jmap"],
};

const INTERNAL: SendPolicy = { internalOnly: true, internalDomains: ["uwumail.example"] };
const OPEN: SendPolicy = { internalOnly: false, internalDomains: [] };

const known = {
  listAccounts: vi.fn(async () => [ACCOUNT]),
  listIdentities: vi.fn(async () => []),
  listSignatures: vi.fn(async () => []),
  maxSendDelay: vi.fn(async () => 0),
  sendPolicy: vi.fn(async (): Promise<SendPolicy> => INTERNAL),
  searchContacts: vi.fn(async () => [
    { id: "c1", name: "Leni Wanders", email: "leni@wanders.example" },
    { id: "c2", name: "Leni Team", email: "leni@uwumail.example" },
  ]),
  saveDraft: vi.fn(async () => ({ draftKey: "k", emailId: "e", savedAt: new Date().toISOString() })),
  send: vi.fn(async (_message: OutgoingMessage) => ({
    submissionId: null,
    sendAt: new Date().toISOString(),
    pending: false,
  })),
};
// Everything else the composer asks for has nothing to say here.
const fake = new Proxy(known as Record<string, unknown>, {
  get: (target, name: string) => target[name] ?? (async () => null),
});

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function openComposer(to: { name?: string; email: string }[], cc: { email: string }[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useUi.getState().openCompose({ mode: "new", to, cc, subject: "Hi" });
  return render(
    <QueryClientProvider client={client}>
      <Composer />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.clearAllMocks();
  known.sendPolicy.mockImplementation(async () => INTERNAL);
});
afterEach(() => {
  cleanup();
  useUi.getState().closeCompose();
});

describe("an account limited to its own server", () => {
  it("says so next to the recipients and marks the outside ones", async () => {
    openComposer(
      [{ email: "leni+news@UwUMail.example" }, { name: "Noah Zockt", email: "noah@zockt.example" }],
      [{ email: "mia@mood.example" }],
    );
    const note = await screen.findByTestId("internal-only-note");
    expect(note.textContent).toContain("This account can only send to addresses on this server.");
    // The note describes the recipient fields for screen readers.
    expect(screen.getByLabelText("To").getAttribute("aria-describedby")).toBe(note.id);

    const marked = document.querySelectorAll("[data-undeliverable]");
    expect([...marked].map((chip) => chip.textContent)).toEqual([
      expect.stringContaining("Noah Zockt"),
      expect.stringContaining("mia@mood.example"),
    ]);
    expect(marked[0]!.textContent).toContain("noah@zockt.example is not on this server");
    expect(marked[0]!.getAttribute("title")).toContain("is not on this server");
  });

  it("does not send while outside recipients are there, and names them", async () => {
    openComposer([{ email: "leni@uwumail.example" }, { name: "Noah", email: "noah@zockt.example" }]);
    await screen.findByTestId("internal-only-note");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("noah@zockt.example");
    expect(alert.textContent).not.toContain("leni@uwumail.example");
    expect(known.send).not.toHaveBeenCalled();

    // Cmd/Ctrl+Enter takes the same way.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });
    expect(known.send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove noah@zockt.example" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(known.send).toHaveBeenCalledTimes(1));
    expect(known.send.mock.calls[0]![0]).toMatchObject({ to: [{ email: "leni@uwumail.example" }] });
  });

  it("suggests addresses on the server first and marks the others", async () => {
    openComposer([]);
    await screen.findByTestId("internal-only-note");
    const input = screen.getByLabelText("To");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "leni" } });
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("leni@uwumail.example"),
      expect.stringContaining("Not on this server"),
    ]);
    expect(options[0]!.textContent).not.toContain("Not on this server");
  });

  it("explains it when the server refuses the mail for that reason", async () => {
    const { BackendError } = await import("@/backend/backend");
    known.send.mockRejectedValueOnce(new BackendError("internal_only", "only addresses on this server"));
    openComposer([{ email: "leni@uwumail.example" }]);
    await screen.findByTestId("internal-only-note");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The server didn't take the mail");
  });

  it("reads the policy again after any refused send", async () => {
    const { BackendError } = await import("@/backend/backend");
    known.send.mockRejectedValueOnce(new BackendError("internal", "this account is disabled"));
    openComposer([{ email: "leni@uwumail.example" }]);
    await screen.findByTestId("internal-only-note");
    const before = known.sendPolicy.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(known.sendPolicy.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("an account without the limit", () => {
  it("shows no note, marks nobody and sends anywhere", async () => {
    known.sendPolicy.mockImplementation(async () => OPEN);
    openComposer([{ email: "noah@zockt.example" }]);
    await waitFor(() => expect(known.sendPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId("internal-only-note")).toBeNull();
    expect(document.querySelector("[data-undeliverable]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(known.send).toHaveBeenCalledTimes(1));
  });
});
