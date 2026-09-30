import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistError } from "@/backend/backend";
import type {
  AssistComposeRequest,
  AssistLabel,
  AssistLabelInput,
  AssistLabelLogEntry,
  AssistOptions,
  AssistProviderInput,
  AssistSpamCheck,
  AssistStreamHandlers,
  Message,
} from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import { ComposeAssistPanel, type ComposeAssistContext, type ComposeAssistStart } from "./ComposeAssist";
import { LABEL_DEFAULTS } from "./labels";
import { MessageLabels } from "./LabelChips";
import { SuggestBody } from "../labels/LabelSuggest";
import { useAssistReader } from "./readerState";
import { LabelSettings } from "../labels/LabelSettings";
import { ProviderSettings } from "./settings/ProviderSettings";
import { SpamCheckCard } from "./SpamCheckCard";

const OPTIONS: AssistOptions = {
  features: { compose: true, summarize: true, spamCheck: true, extractEvents: true, autoLabels: true },
  mayAddProviders: true,
  mayUsePrivateAddresses: true,
  maxProviders: 5,
  maxLabels: 30,
  maxInstructionChars: 2000,
  maxTextChars: 20000,
};

const ANSWER = { providerId: "q1", providerName: "Mistral (Server)", model: "mistral-small-latest", usage: null };

let labels: AssistLabel[] = [];
let log: AssistLabelLogEntry[] = [];
/** How the next compose answer comes: streamed pieces, then the result, or a failure. */
let compose: (request: AssistComposeRequest, handlers: AssistStreamHandlers) => Promise<unknown>;

const fake = {
  kind: "jmap",
  assistOptions: vi.fn(async () => OPTIONS),
  assistSettings: vi.fn(async () => ({
    default: null,
    features: { compose: null, summarize: null, spamCheck: null, extractEvents: null, autoLabels: null },
    autoLabels: false,
    effective: { compose: ANSWER, summarize: ANSWER, spamCheck: ANSWER, extractEvents: ANSWER, autoLabels: ANSWER },
  })),
  assistProviders: vi.fn(async () => [
    {
      id: "q1",
      name: "Mistral (Server)",
      kind: "mistral",
      scope: "server",
      baseUrl: null,
      hasKey: true,
      keyHint: null,
      model: "mistral-medium-latest",
      fastModel: "mistral-small-latest",
      features: ["compose"],
      quota: { requestsPerDay: 200, tokensPerDay: null },
      experimental: false,
      connected: true,
    },
  ]),
  createAssistProvider: vi.fn(async (input: AssistProviderInput) => ({ id: "q9", ...input })),
  assistCompose: vi.fn((request: AssistComposeRequest, handlers: AssistStreamHandlers) => compose(request, handlers)),
  assistLabels: vi.fn(async () => labels.map((label) => ({ ...label }))),
  createAssistLabel: vi.fn(async (input: AssistLabelInput) => {
    const made = { ...LABEL_DEFAULTS, id: `g${labels.length + 1}`, keyword: input.name.toLowerCase(), ...input };
    labels = [...labels, made];
    return made;
  }),
  assistLabelLog: vi.fn(async () => log),
  undoAssistLabels: vi.fn(async () => {}),
  setFlags: vi.fn(async () => {}),
  assistSpamCheck: vi.fn(async (emailId: string): Promise<AssistSpamCheck> => ({
    ...ANSWER,
    emailId,
    verdict: "phishing",
    confidence: 0.9,
    reasons: ["Asks to confirm a password through a link"],
    signals: {
      authentication: { spf: "fail", dkim: null, dmarc: "fail", fromDomain: "bank.example" },
      spamScore: 4.2,
      spamThreshold: 5,
      tests: ["DMARC_FAIL"],
      inJunk: false,
      sender: {
        address: "service@bank.example",
        earlierMessages: 0,
        earlierInJunk: 0,
        writtenTo: 0,
        inContacts: false,
        firstSeen: null,
      },
    },
  })),
  markSpam: vi.fn(async () => []),
  suggestLabels: vi.fn(async (emailId: string) => ({
    ...ANSWER,
    emailId,
    verdicts: [
      { labelId: "g1", fits: true, reason: "It is an invoice.", isSet: false },
      { labelId: "g2", fits: false, reason: "No offers in it.", isSet: true },
      { labelId: "g3", fits: false, reason: "Not about a trip.", isSet: false },
    ],
    newLabels: [{ name: "Kids", description: "School and daycare", color: "#10b981", reason: "About school." }],
  })),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const CONTEXT: ComposeAssistContext = {
  source: { scope: "own", text: "hey leni, friday works" },
  subject: "Lunch",
  replyToEmailId: "e1",
  language: "en",
};

function panel(start: ComposeAssistStart, extra: Partial<Parameters<typeof ComposeAssistPanel>[0]> = {}) {
  const props = {
    start,
    context: CONTEXT,
    subjectEmpty: false,
    onInsert: vi.fn(),
    onReplace: vi.fn(),
    onSubject: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
  renderWith(<ComposeAssistPanel {...props} />);
  return props;
}

const message = (patch: Partial<Message> = {}): Message => ({
  id: "e1",
  threadId: "t1",
  accountId: "acc",
  folderId: "acc:inbox",
  from: { name: "Bank", email: "service@bank.example" },
  to: [{ name: "Mini", email: "mini@uwumail.example" }],
  cc: [],
  replyTo: [],
  subject: "Confirm your account",
  date: "2026-09-28T10:00:00Z",
  flags: { seen: true, flagged: false, answered: false, draft: false },
  snippet: "",
  bodyHtml: null,
  bodyText: "",
  hasRemoteContent: false,
  attachments: [],
  ...patch,
});

describe("the assistant's UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    labels = [];
    log = [];
    compose = async (_request, handlers) => {
      handlers.onDelta?.("Hi Leni, ");
      handlers.onDelta?.("Friday works for me.");
      return { ...ANSWER, text: "Hi Leni, Friday works for me.", subject: null };
    };
  });
  afterEach(() => {
    cleanup();
    act(() => {
      useToasts.setState({ toasts: [] });
      useAssistReader.setState({ summaries: {}, spamChecks: {}, done: {}, spamResults: {} });
    });
  });

  it("rewrites the own text with a preset at once, and changes the draft only on a click", async () => {
    const props = panel({ kind: "rewrite", preset: "formal" });
    expect(await screen.findByText("Hi Leni, Friday works for me.")).toBeTruthy();
    expect(fake.assistCompose.mock.calls[0]![0]).toEqual({
      mode: "rewrite",
      instruction: null,
      preset: "formal",
      targetLanguage: null,
      text: "hey leni, friday works",
      subject: "Lunch",
      replyToEmailId: "e1",
      wantSubject: false,
      language: "en",
    });
    expect(screen.getByText("Mistral (Server) · mistral-small-latest")).toBeTruthy();
    expect(props.onReplace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace my text" }));
    expect(props.onReplace).toHaveBeenCalledWith("Hi Leni, Friday works for me.");
  });

  it("writes from an instruction with a subject proposal", async () => {
    compose = async (_request, handlers) => {
      handlers.onSubject?.("Friday lunch");
      handlers.onDelta?.("Yes!");
      return { ...ANSWER, text: "Yes!", subject: "Friday lunch" };
    };
    const props = panel({ kind: "write" }, { subjectEmpty: true });
    expect(fake.assistCompose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Say yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    await screen.findByText("Yes!");
    expect(fake.assistCompose.mock.calls[0]![0]).toMatchObject({
      mode: "write",
      instruction: "Say yes",
      wantSubject: true,
      text: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Use as subject" }));
    expect(props.onSubject).toHaveBeenCalledWith("Friday lunch");
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(props.onInsert).toHaveBeenCalledWith("Yes!");
  });

  it("stops a streaming answer and keeps what came", async () => {
    let signal: AbortSignal | undefined;
    compose = (_request, handlers) => {
      signal = handlers.signal;
      handlers.onDelta?.("Half a sen");
      return new Promise((_resolve, reject) =>
        handlers.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
    };
    panel({ kind: "rewrite", preset: "shorter" });
    await screen.findByText("Half a sen");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Insert" })).toBeTruthy();
    expect(screen.getByText("Half a sen")).toBeTruthy();
  });

  it("says kindly when the day's limit is used up, and tries again", async () => {
    compose = async () => {
      throw new AssistError("overQuota", "requests: 200 of 200");
    };
    panel({ kind: "rewrite", preset: "clearer" });
    expect(
      await screen.findByText("Today's limit for the assistant is used up. It resets at midnight (UTC)."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fake.assistCompose).toHaveBeenCalledTimes(2));
  });

  it("tells when the model is busy and for how long", async () => {
    compose = async () => {
      throw new AssistError("providerFailed", "429", { retryAfter: 12.2 });
    };
    panel({ kind: "rewrite", preset: "proofread" });
    expect(await screen.findByText("The model is busy right now. Try again in 13 seconds.")).toBeTruthy();
  });

  it("shows why the assistant set a label and undoes it", async () => {
    labels = [
      { ...LABEL_DEFAULTS, id: "g1", name: "Invoices", keyword: "invoices", description: "Bills", color: "#f59e0b" },
    ];
    log = [
      {
        id: "l1",
        emailId: "e1",
        labelId: "g1",
        name: "Invoices",
        keyword: "invoices",
        source: "ai",
        reason: "It is an invoice for September.",
        code: "ai",
        params: {},
        createdAt: "2026-09-28T10:02:00Z",
        undone: false,
        providerName: "Mistral (Server)",
        model: "mistral-small-latest",
      },
    ];
    renderWith(<MessageLabels message={message({ keywords: ["invoices"] })} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: /Invoices/ }));
    await waitFor(() => expect(fake.assistLabelLog).toHaveBeenCalledWith(["e1"], 50));
    const card = await screen.findByRole("dialog", { name: "Invoices" });
    expect(await within(card).findByText("It is an invoice for September.")).toBeTruthy();
    expect(within(card).getByText(/Mistral \(Server\) · mistral-small-latest/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fake.undoAssistLabels).toHaveBeenCalledWith(["l1"]));
  });

  it("puts a label on by hand as a keyword", async () => {
    labels = [{ ...LABEL_DEFAULTS, id: "g1", name: "Travel", keyword: "travel", description: "", color: null }];
    renderWith(<MessageLabels message={message()} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a label" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Travel" }));
    await waitFor(() => expect(fake.setFlags).toHaveBeenCalledWith(["e1"], { keywords: { travel: true } }));
  });

  it("labels again: ticks what fits, takes off what no longer does, and makes a new label", async () => {
    labels = [
      { ...LABEL_DEFAULTS, id: "g1", name: "Invoices", keyword: "invoices", description: "", color: null },
      { ...LABEL_DEFAULTS, id: "g2", name: "Newsletters", keyword: "newsletters", description: "", color: null },
      { ...LABEL_DEFAULTS, id: "g3", name: "Travel", keyword: "travel", description: "", color: null },
    ];
    const onClose = vi.fn();
    renderWith(<SuggestBody emailId="e1" onClose={onClose} />);
    expect(await screen.findByText("It is an invoice.")).toBeTruthy();
    expect(fake.suggestLabels).toHaveBeenCalledWith("e1", "en");
    const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;
    expect(box("Invoices").checked).toBe(true);
    expect(box("Newsletters").checked).toBe(false);
    expect(screen.getByText("will be removed")).toBeTruthy();
    // The person keeps the travel label off and applies: one added, one taken off.
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));
    await waitFor(() =>
      expect(fake.setFlags).toHaveBeenCalledWith(["e1"], { keywords: { invoices: true, newsletters: false } }),
    );
    expect(onClose).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create “Kids” and put it on this mail" }));
    await waitFor(() =>
      expect(fake.createAssistLabel).toHaveBeenCalledWith({
        name: "Kids",
        description: "School and daycare",
        color: "#10b981",
      }),
    );
    await waitFor(() => expect(fake.setFlags).toHaveBeenCalledWith(["e1"], { keywords: { kids: true } }));
    expect(await screen.findByText("Created and applied")).toBeTruthy();
  });

  it("adds the suggested starter labels in one click", async () => {
    renderWith(<LabelSettings options={OPTIONS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add 6 labels" }));
    await waitFor(() => expect(fake.createAssistLabel).toHaveBeenCalledTimes(6));
    expect(fake.createAssistLabel.mock.calls.map(([input]) => input.name)).toEqual([
      "Invoices",
      "Newsletters",
      "Orders & shipping",
      "Travel",
      "Appointments",
      "Personal",
    ]);
  });

  it("checks a new label before saving it", async () => {
    labels = [{ ...LABEL_DEFAULTS, id: "g1", name: "Travel", keyword: "travel", description: "", color: null }];
    renderWith(<LabelSettings options={OPTIONS} />);
    // The list is there (its keyword shows), not only the suggestions.
    await screen.findByText("travel");
    fireEvent.click(screen.getByRole("button", { name: "New label" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create label" }));
    expect(await screen.findByText("You already have a label with that name.")).toBeTruthy();
    expect(fake.createAssistLabel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kids" } });
    fireEvent.change(screen.getByLabelText("What belongs here"), { target: { value: "School and daycare" } });
    fireEvent.click(screen.getByRole("button", { name: "Create label" }));
    await waitFor(() =>
      expect(fake.createAssistLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Kids", description: "School and daycare" }),
      ),
    );
  });

  it("adds an own provider only with a key, which it never shows again", async () => {
    renderWith(<ProviderSettings options={OPTIONS} />);
    expect(await screen.findByText("Mistral (Server)")).toBeTruthy();
    expect(screen.getByText("200 requests per day")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("This provider needs an API key.")).toBeTruthy();
    const key = screen.getByLabelText("API key");
    expect(key.getAttribute("type")).toBe("password");
    fireEvent.change(key, { target: { value: "sk-test-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(fake.createAssistProvider).toHaveBeenCalledWith({
        name: "OpenAI",
        kind: "openai",
        apiKey: "sk-test-1234",
      }),
    );
  });

  it("takes prices set by hand, in either decimal mark, and only sensible ones", async () => {
    renderWith(<ProviderSettings options={OPTIONS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-1234" } }); // gitleaks:allow
    const input = screen.getByLabelText("Input price (USD per million tokens)");
    expect(input.getAttribute("placeholder")).toBe("unknown");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Output price (USD per million tokens)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("A price from 0 to 10,000, e.g. 0.40.")).toBeTruthy();
    expect(fake.createAssistProvider).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "0,40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(fake.createAssistProvider).toHaveBeenCalledWith(
        expect.objectContaining({ inputPricePerMillion: 0.4, outputPricePerMillion: 2 }),
      ),
    );
  });

  it("asks no price for what costs nothing per token", async () => {
    renderWith(<ProviderSettings options={OPTIONS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
    expect(screen.queryByLabelText("Input price (USD per million tokens)")).toBeNull();
  });

  it("warns that a Claude subscription can't be used", async () => {
    renderWith(<ProviderSettings options={OPTIONS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "anthropic" } });
    expect(screen.getByText(/A Claude subscription \(Pro or Max\) can't be used here/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "chatgpt" } });
    expect(screen.getByText("Experimental and unofficial")).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("shows the model's verdict next to the server's findings and reports spam", async () => {
    act(() => useAssistReader.getState().showSpamCheck("e1"));
    renderWith(<SpamCheckCard message={message()} inJunk={false} />);
    expect(await screen.findByText("Phishing")).toBeTruthy();
    expect(fake.assistSpamCheck).toHaveBeenCalledWith("e1", "en");
    expect(screen.getAllByText("90% sure").length).toBeGreaterThan(0);
    expect(screen.getByText("Asks to confirm a password through a link")).toBeTruthy();
    expect(screen.getByText("4.2 of 5.0 points")).toBeTruthy();
    expect(screen.getByText("First mail from this address")).toBeTruthy();
    expect(screen.getByText("Not in your address book")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(fake.markSpam).toHaveBeenCalledWith(["e1"], true));
    expect(useAssistReader.getState().spamChecks.e1).toBeUndefined();
  });
});
