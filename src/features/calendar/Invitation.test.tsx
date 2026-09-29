import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailInvitation, MailReply, MailScheduling, Message } from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { MailInvitationCard } from "./Invitation";

let found: MailScheduling | null = null;

const fake = {
  calendarsAvailable: vi.fn(async () => true),
  mailInvitation: vi.fn(async () => found),
  respondToInvitation: vi.fn(async () => {}),
  getSenderPicture: vi.fn(async () => null),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

const invitation = (patch: Partial<MailInvitation> = {}): MailInvitation => ({
  kind: "invitation",
  eventId: "ev1",
  participantKey: "mini",
  status: "needs-action",
  organizer: "Emma Vogt",
  organizerEmail: "emma@brightlabs.example",
  title: "Logo review",
  start: "2026-10-01T08:00:00Z",
  allDay: false,
  method: "request",
  verified: true,
  cancelled: false,
  ...patch,
});

const mail = (from: string): Message => ({
  id: "m1",
  threadId: "t1",
  accountId: "acc",
  folderId: "inbox",
  from: { email: from },
  to: [{ email: "mini@uwumail.example" }],
  cc: [],
  replyTo: [],
  subject: "Logo review",
  date: "2026-09-21T10:00:00Z",
  flags: { seen: true, flagged: false, answered: false, draft: false },
  snippet: "",
  bodyHtml: null,
  bodyText: "",
  hasRemoteContent: false,
  attachments: [{ id: "a1", filename: "invite.ics", mimeType: "text/calendar", size: 400, inline: false }],
});

function renderCard(from: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MailInvitationCard message={mail(from)} />
    </QueryClientProvider>,
  );
}

describe("an invitation in a mail (WEBMAIL-2)", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("offers the answers for the organizer's own invitation", async () => {
    found = invitation();
    renderCard("emma@brightlabs.example");
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(fake.respondToInvitation).toHaveBeenCalledWith("ev1", "mini", "accepted"));
  });

  it("doesn't believe a cancellation from someone else, and offers nothing", async () => {
    found = invitation({ method: "cancel", verified: false });
    renderCard("emma@brightlabs-events.example");
    expect(
      await screen.findByText(
        "This mail says the event is cancelled, but nothing confirms it comes from the event's organizer. Your calendar keeps the event as it is.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Sent by emma@brightlabs-events.example; the organizer is emma@brightlabs.example."),
    ).toBeTruthy();
    expect(screen.queryByText("The organizer cancelled this event.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Your answer" })).toBeNull();
  });

  it("doesn't let someone else's invitation be answered from the mail", async () => {
    found = invitation({ verified: false });
    renderCard("mallory@example.net");
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("shows who sent an unverified mail as it is written, invisible characters too (W-34)", async () => {
    found = invitation({ verified: false });
    // A right-to-left override would turn the rest of the line around.
    renderCard("mallory\u202e@example.net");
    expect(
      await screen.findByText("Sent by mallory<U+202E>@example.net; the organizer is emma@brightlabs.example."),
    ).toBeTruthy();
  });

  it("shows the organizer's cancellation as such", async () => {
    found = invitation({ method: "cancel", cancelled: true });
    renderCard("emma@brightlabs.example");
    expect(await screen.findByText("The organizer cancelled this event.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("says nothing of a cancellation of single dates, and offers no answer on its account", async () => {
    found = invitation({ method: "cancel", cancelled: false, status: "accepted" });
    renderCard("emma@brightlabs.example");
    expect(await screen.findByText("You accepted.")).toBeTruthy();
    expect(screen.queryByText("The organizer cancelled this event.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("shows an attendee's answer as the calendar has it, and a stranger's as not counting", async () => {
    const reply: MailReply = {
      kind: "reply",
      title: "Game night",
      start: null,
      allDay: false,
      method: "reply",
      verified: true,
      attendee: "Noah Zockt",
      attendeeEmail: "noah@zockt.example",
      status: "accepted",
    };
    found = reply;
    const first = renderCard("noah@zockt.example");
    expect(await screen.findByText("Noah Zockt accepted.")).toBeTruthy();
    first.unmount();

    found = { ...reply, verified: false, attendee: "mallory@example.net", attendeeEmail: "mallory@example.net" };
    renderCard("mallory@example.net");
    expect(
      await screen.findByText("This answer doesn't come from anyone invited to the event, so it doesn't count."),
    ).toBeTruthy();
    expect(screen.queryByText(/accepted\./)).toBeNull();
  });
});
