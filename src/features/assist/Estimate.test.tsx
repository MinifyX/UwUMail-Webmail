import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistEstimate, AssistEstimateRequest, Message } from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { ComposeAssistButton, presetRequest, type ComposeAssistContext } from "./ComposeAssist";
import { EstimateTip, ESTIMATE_SETTLE_MS, LONG_PRESS_MS, roughly } from "./Estimate";
import { useAssistReader } from "./readerState";
import { ThreadAssistButton } from "./ReaderAssist";

const ESTIMATE: AssistEstimate = {
  method: "Assist/summarize",
  inputTokens: 1150,
  outputTokens: 84,
  reasoningTokens: 0,
  totalTokens: 1234,
  imageCount: 0,
  calls: [],
  calibrated: false,
  providerId: "q1",
  providerName: "Mistral (Server)",
  model: "mistral-small-latest",
  tokensLeftToday: 48000,
  requestsLeftToday: 190,
  cost: null,
};

let estimate: AssistEstimate | null = ESTIMATE;

const fake = {
  assistOptions: vi.fn(async () => ({
    features: { compose: true, summarize: true, spamCheck: true, extractEvents: true, autoLabels: false },
    mayAddProviders: false,
    mayUsePrivateAddresses: false,
    maxProviders: 5,
    maxLabels: 30,
    maxInstructionChars: 2000,
    maxTextChars: 20000,
    baseLabels: [],
  })),
  calendarsAvailable: vi.fn(async () => true),
  assistEstimate: vi.fn(async (_request: AssistEstimateRequest) => estimate),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (child: ReactNode) => <QueryClientProvider client={client}>{child}</QueryClientProvider>;
  const view = render(wrap(node));
  return { ...view, rerender: (next: ReactNode) => view.rerender(wrap(next)) };
}

const SUMMARY: AssistEstimateRequest = { method: "Assist/summarize", request: { emailId: "e1", language: "en" } };

function tip(request: AssistEstimateRequest | null = SUMMARY, onClick = vi.fn()) {
  return (
    <EstimateTip request={request}>
      <button type="button" onClick={onClick}>
        Summarize
      </button>
    </EstimateTip>
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
  useSettings.getState().update({ tone: "neutral" });
});
beforeEach(() => {
  vi.clearAllMocks();
  estimate = ESTIMATE;
  useAssistReader.setState({ eventSearches: {} });
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

describe("roughly", () => {
  it("rounds an estimate the way a person would say it", () => {
    expect(roughly(7)).toBe(7);
    expect(roughly(1234)).toBe(1200);
    expect(roughly(487)).toBe(490);
    expect(roughly(48_051)).toBe(48_100);
  });
});

describe("EstimateTip", () => {
  it("asks only on hover, says it in the person's numbers and asks once per request", async () => {
    renderWith(tip());
    const button = screen.getByRole("button", { name: "Summarize" });
    expect(fake.assistEstimate).not.toHaveBeenCalled();
    fireEvent.pointerOver(button, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("≈ 1,200 tokens · 48,000 left today");
    expect(fake.assistEstimate).toHaveBeenCalledWith(SUMMARY, "EUR");
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.pointerOut(button, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerOver(button, { pointerType: "mouse" });
    await screen.findByRole("tooltip");
    expect(fake.assistEstimate).toHaveBeenCalledOnce();
  });

  it("writes German numbers in German and falls back to the requests left", async () => {
    await i18n.changeLanguage("de");
    estimate = { ...ESTIMATE, tokensLeftToday: null, requestsLeftToday: 12 };
    renderWith(tip());
    fireEvent.pointerOver(screen.getByRole("button"), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("≈ 1.200 Tokens · heute noch 12 Anfragen übrig");
  });

  it("shows nothing where the server can't tell (an older one)", async () => {
    estimate = null;
    renderWith(tip());
    fireEvent.pointerOver(screen.getByRole("button"), { pointerType: "mouse" });
    await waitFor(() => expect(fake.assistEstimate).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows on a long press without pressing the button", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    renderWith(tip(SUMMARY, onClick));
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button, { pointerType: "touch" });
    await act(async () => vi.advanceTimersByTimeAsync(LONG_PRESS_MS));
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("tooltip").textContent).toContain("1,200");
    // A short tap is a tap.
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("waits for a changing text to settle before asking again", async () => {
    vi.useFakeTimers();
    const compose = (text: string): AssistEstimateRequest => ({
      method: "Assist/compose",
      request: { mode: "rewrite", preset: "shorter", text },
    });
    const view = renderWith(tip(compose("Hallo")));
    fireEvent.pointerOver(screen.getByRole("button"), { pointerType: "mouse" });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fake.assistEstimate).toHaveBeenCalledTimes(1);
    view.rerender(tip(compose("Hallo W")));
    view.rerender(tip(compose("Hallo Welt")));
    await act(async () => vi.advanceTimersByTimeAsync(ESTIMATE_SETTLE_MS - 50));
    expect(fake.assistEstimate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(fake.assistEstimate).toHaveBeenCalledTimes(2);
    expect(fake.assistEstimate).toHaveBeenLastCalledWith(compose("Hallo Welt"), "EUR");
  });
});

const mail = (id: string, patch: Partial<Message> = {}): Message => ({
  id,
  threadId: "t1",
  accountId: "a1",
  folderId: "inbox",
  from: { name: "Mia", email: "mia@mood.example" },
  to: [],
  cc: [],
  replyTo: [],
  subject: "Lesung",
  date: "2026-09-29T10:00:00Z",
  flags: { seen: true, flagged: false, answered: false, draft: false },
  snippet: "",
  bodyHtml: null,
  bodyText: "Lesung am Freitag",
  hasRemoteContent: false,
  attachments: [],
  ...patch,
});

describe("the reader's AI menu", () => {
  it("offers “Find appointment” for the newest mail, with its cost on hover", async () => {
    renderWith(
      <ThreadAssistButton threadId="t1" messages={[mail("e1"), mail("e2")]} own mine={new Set(["me@example.com"])} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "AI assistant" }));
    const find = await screen.findByRole("menuitem", { name: "Find appointment" });
    fireEvent.pointerOver(find, { pointerType: "mouse" });
    await screen.findByRole("tooltip");
    expect(fake.assistEstimate).toHaveBeenCalledWith(
      {
        method: "Assist/extractEvents",
        emailId: "e2",
        includeImages: false,
      },
      "EUR",
    );
    fireEvent.click(find);
    expect(useAssistReader.getState().eventSearches).toEqual({ e2: true });
  });

  it("asks what the thread summary would cost with the thread's id", async () => {
    renderWith(<ThreadAssistButton threadId="t1" messages={[mail("e1"), mail("e2")]} own mine={new Set()} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI assistant" }));
    fireEvent.pointerOver(await screen.findByRole("menuitem", { name: "Summarize conversation" }), {
      pointerType: "mouse",
    });
    await screen.findByRole("tooltip");
    expect(fake.assistEstimate).toHaveBeenCalledWith(
      {
        method: "Assist/summarize",
        request: { threadId: "t1", language: "en" },
      },
      "EUR",
    );
  });

  it("has no “Find appointment” without a calendar", async () => {
    fake.calendarsAvailable.mockResolvedValueOnce(false);
    renderWith(<ThreadAssistButton threadId="t1" messages={[mail("e1")]} own mine={new Set()} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI assistant" }));
    await screen.findByRole("menuitem", { name: "Summarize" });
    await act(async () => {});
    expect(screen.queryByRole("menuitem", { name: "Find appointment" })).toBeNull();
  });
});

describe("the composer's AI menu", () => {
  const context: ComposeAssistContext = {
    source: { scope: "own", text: "hey leni, friday works" },
    subject: "Lunch",
    replyToEmailId: "e1",
    language: "en",
  };

  it("asks what a preset would cost with the draft as it is when the menu opens", async () => {
    renderWith(<ComposeAssistButton onPick={vi.fn()} context={() => context} />);
    fireEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    fireEvent.pointerOver(screen.getByRole("menuitem", { name: "Translate…" }), { pointerType: "mouse" });
    await screen.findByRole("tooltip");
    expect(fake.assistEstimate).toHaveBeenCalledWith(
      {
        method: "Assist/compose",
        request: {
          mode: "rewrite",
          instruction: null,
          preset: "translate",
          targetLanguage: "de",
          text: "hey leni, friday works",
          subject: "Lunch",
          replyToEmailId: "e1",
          wantSubject: false,
          language: "en",
        },
      },
      "EUR",
    );
    // Writing needs an instruction first: its cost shows on the panel's button.
    fireEvent.pointerOver(screen.getByRole("menuitem", { name: "Write it for me" }), { pointerType: "mouse" });
    expect(fake.assistEstimate).toHaveBeenCalledOnce();
  });

  it("asks nothing for an empty draft", async () => {
    const empty = { ...context, source: { scope: "own" as const, text: "  " } };
    expect(presetRequest("shorter", empty)).toBeNull();
    expect(presetRequest("shorter", context)).toMatchObject({ preset: "shorter", targetLanguage: null });
  });
});
