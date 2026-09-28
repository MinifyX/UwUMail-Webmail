import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, UnsubscribeOutcome } from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import { UnsubscribeButton } from "./Unsubscribe";

const fake = {
  unsubscribe: vi.fn(async (_id: string, _options?: { oneClick?: boolean }): Promise<UnsubscribeOutcome> => ({
    kind: "done",
    via: "oneClick",
  })),
  inboxMessagesFrom: vi.fn(async () => []),
  archive: vi.fn(async () => []),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

const newsletter = (unsubscribe: Message["unsubscribe"]): Message => ({
  id: "m1",
  threadId: "t1",
  accountId: "acc",
  folderId: "inbox",
  from: { name: "Pixel Parts", email: "news@pixelparts.example" },
  to: [{ email: "mini@uwumail.example" }],
  cc: [],
  replyTo: [],
  subject: "Autumn newsletter",
  date: "2026-09-21T10:00:00Z",
  flags: { seen: true, flagged: false, answered: false, draft: false },
  snippet: "",
  bodyHtml: null,
  bodyText: "",
  hasRemoteContent: false,
  attachments: [],
  unsubscribe,
});

function renderButton(message: Message) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UnsubscribeButton message={message} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
}

const toasts = () => useToasts.getState().toasts.map((toast) => toast.message);

describe("unsubscribing", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    act(() => useToasts.setState({ toasts: [] }));
  });

  it("does it in one click through the server, and names the mail that would go otherwise", async () => {
    renderButton(
      newsletter({ oneClick: true, url: "https://pixelparts.example/u", mailto: "mailto:leave@pixelparts.example" }),
    );
    expect(await screen.findByText(/asks the sender's server to take you off the list/)).toBeTruthy();
    expect(
      screen.getByText("If it can't be done that way, a mail goes from you to leave@pixelparts.example."),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Unsubscribe" }).at(-1)!);
    await waitFor(() => expect(fake.unsubscribe).toHaveBeenCalledWith("m1", {}));
    await waitFor(() => expect(toasts()).toContain("Unsubscribed from Pixel Parts"));
  });

  it("says when the sender's side refused, and sends the mail only when asked", async () => {
    fake.unsubscribe.mockResolvedValueOnce({
      kind: "oneClickFailed",
      reason: "pixelparts.example answered 503.",
      fallback: "mail",
    });
    renderButton(
      newsletter({ oneClick: true, url: "https://pixelparts.example/u", mailto: "mailto:leave@pixelparts.example" }),
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Unsubscribe" })).at(-1)!);
    expect(
      await screen.findByText("The sender's server didn't take it: pixelparts.example answered 503."),
    ).toBeTruthy();
    expect(
      screen.getByText("You can unsubscribe by mail instead. That sends a mail from you to leave@pixelparts.example."),
    ).toBeTruthy();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Send the mail" }));
    await waitFor(() => expect(fake.unsubscribe).toHaveBeenLastCalledWith("m1", { oneClick: false }));
    await waitFor(() => expect(toasts()).toContain("Unsubscribed from Pixel Parts"));
  });

  it("offers nothing more when the mail has no other way", async () => {
    fake.unsubscribe.mockResolvedValueOnce({ kind: "oneClickFailed", reason: "", fallback: null });
    renderButton(newsletter({ oneClick: true }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Unsubscribe" })).at(-1)!);
    expect(await screen.findByText("This mail offers no other way. Try again later.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open the page" })).toBeNull();
  });
});
