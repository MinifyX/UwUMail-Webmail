import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistError } from "../backend";
import {
  ASSIST,
  assistOptionsFrom,
  assistSettingsUpdate,
  createEventStreamParser,
  providerCreate,
  providerUpdate,
  readAssistStream,
  MAX_STREAM_BYTES,
  streamAssist,
  toAssistProvider,
  toAssistSettings,
  toEvents,
  toChatgptLogin,
  MAX_ASSIST_EVENTS,
  toSpamCheck,
  toEstimate,
  type EventStreamEvent,
} from "./assist";
import { JmapMethodError } from "./client";

function collect(chunks: string[]): EventStreamEvent[] {
  const events: EventStreamEvent[] = [];
  const parser = createEventStreamParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return events;
}

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("the event stream parser", () => {
  it("hands out named events with their data", () => {
    expect(collect(['event: delta\ndata: {"text":"Hal"}\n\n', 'event: delta\ndata: {"text":"lo"}\n\n'])).toEqual([
      { event: "delta", data: '{"text":"Hal"}' },
      { event: "delta", data: '{"text":"lo"}' },
    ]);
  });

  it("puts events together across chunk boundaries, CRLF split included", () => {
    expect(collect(["event: sub", "ject\r", '\ndata: {"subject":', '"Freitag"}\r\n', "\r\n"])).toEqual([
      { event: "subject", data: '{"subject":"Freitag"}' },
    ]);
  });

  it("skips comments, joins data lines and keeps what follows the first space", () => {
    expect(collect([": ping\n\n", "data:a\ndata:  b\n\n", "event: done\ndata: {}"])).toEqual([
      { event: "message", data: "a\n b" },
      { event: "done", data: "{}" },
    ]);
  });

  it("ignores a blank line without data and lines with bare CR", () => {
    expect(collect(["\n\nevent: x\rdata: 1\r\r"])).toEqual([{ event: "x", data: "1" }]);
  });
});

describe("reading an answer stream", () => {
  it("passes the subject and the pieces on and resolves with the whole answer", async () => {
    const pieces: string[] = [];
    let subject = "";
    const answer = await readAssistStream(
      body([
        'event: subject\ndata: {"subject":"Absage für Freitag"}\n\n',
        ": ping\n\n",
        'event: delta\ndata: {"text":"Hallo Mia,"}\n\n',
        'event: delta\ndata: {"text":" leider klappt"}\n\n',
        'event: done\ndata: {"text":"Hallo Mia, leider klappt","subject":"Absage für Freitag","providerId":"q1"}\n\n',
      ]),
      { onDelta: (text) => pieces.push(text), onSubject: (value) => (subject = value) },
    );
    expect(subject).toBe("Absage für Freitag");
    expect(pieces.join("")).toBe("Hallo Mia, leider klappt");
    expect(answer).toMatchObject({ providerId: "q1", text: "Hallo Mia, leider klappt" });
  });

  it("turns an error event into an AssistError with retryAfter", async () => {
    const reading = readAssistStream(
      body([
        'event: delta\ndata: {"text":"Hal"}\n\n',
        'event: error\ndata: {"type":"providerFailed","description":"Too busy (429)","retryAfter":20}\n\n',
      ]),
    );
    await expect(reading).rejects.toBeInstanceOf(AssistError);
    await expect(reading).rejects.toMatchObject({ type: "providerFailed", retryAfter: 20, code: "connection_failed" });
  });

  it("breaks off a stream that never ends", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode(`event: delta\ndata: {"text":"${"x".repeat(64 * 1024)}"}\n\n`);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    let seen = 0;
    await expect(readAssistStream(endless, { onDelta: (text) => (seen += text.length) })).rejects.toMatchObject({
      code: "internal",
    });
    expect(seen).toBeLessThanOrEqual(MAX_STREAM_BYTES);
    expect(cancelled).toBe(true);
  });

  it("fails when the stream ends without an answer", async () => {
    await expect(readAssistStream(body(['event: delta\ndata: {"text":"Hal"}\n\n']))).rejects.toMatchObject({
      code: "connection_failed",
    });
  });
});

describe("posting to the stream endpoint", () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the method with the session's login and the CSRF header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(body(['event: done\ndata: {"summary":"Kurz."}\n\n']), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const controller = new AbortController();
    const answer = await streamAssist(
      "/jmap/assist/stream",
      "csrf-1",
      "Assist/summarize",
      { accountId: "a1", emailId: "e1" },
      { signal: controller.signal },
    );
    expect(answer).toEqual({ summary: "Kurz." });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/jmap/assist/stream");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toMatchObject({ "x-csrf-token": "csrf-1", accept: "text/event-stream" });
    expect(JSON.parse(init.body as string)).toEqual({
      using: ["urn:ietf:params:jmap:core", ASSIST],
      method: "Assist/summarize",
      arguments: { accountId: "a1", emailId: "e1" },
    });
  });

  it("maps 401 and 400 to their errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(streamAssist("/s", "c", "Assist/compose", {})).rejects.toMatchObject({ code: "signed_out" });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 400 }));
    await expect(streamAssist("/s", "c", "Assist/compose", {})).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("lets an abort through as it is", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(streamAssist("/s", "c", "Assist/compose", {}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("the capability", () => {
  it("is missing without the extension", () => {
    expect(assistOptionsFrom(undefined)).toBeNull();
    expect(assistOptionsFrom({ "urn:ietf:params:jmap:mail": {} })).toBeNull();
  });

  it("reads the features and falls back to the server's limits", () => {
    expect(
      assistOptionsFrom({ [ASSIST]: { features: { compose: true, spamCheck: true }, mayAddProviders: true } }),
    ).toEqual({
      features: { compose: true, summarize: false, spamCheck: true, extractEvents: false, autoLabels: false },
      mayAddProviders: true,
      mayUsePrivateAddresses: false,
      maxProviders: 10,
      maxLabels: 30,
      maxInstructionChars: 2000,
      maxTextChars: 20000,
    });
  });
});

describe("objects of the extension", () => {
  it("fills in a provider and never trusts an unknown kind", () => {
    const provider = toAssistProvider({ id: "q3", name: "Meins", kind: "llamafarm", scope: "personal" });
    expect(provider).toMatchObject({ id: "q3", kind: "openaiCompatible", scope: "personal", hasKey: false });
    expect(toAssistProvider({ id: "q4", kind: "chatgpt" }).experimental).toBe(true);
  });

  it("sends a key only when one was typed, and never a kind in an update", () => {
    expect(
      providerCreate({ name: " Ollama ", kind: "ollama", baseUrl: "http://192.0.2.10:11434", apiKey: "" }),
    ).toEqual({ name: "Ollama", kind: "ollama", baseUrl: "http://192.0.2.10:11434" });
    expect(providerUpdate({ kind: "openai", apiKey: "", model: " " })).toEqual({ apiKey: "", model: null });
  });

  it("changes one feature's choice without touching the others", () => {
    expect(
      assistSettingsUpdate({ features: { summarize: { providerId: "q1", model: null } }, autoLabels: true }),
    ).toEqual({ "features/summarize": { providerId: "q1", model: null }, autoLabels: true });
    expect(assistSettingsUpdate({ default: null })).toEqual({ default: null });
  });

  it("reads the settings with what each feature really uses", () => {
    const settings = toAssistSettings({
      id: "singleton",
      default: { providerId: "q1", model: null },
      features: { compose: { providerId: "q3", model: "gpt-5" } },
      autoLabels: true,
      effective: { compose: { providerId: "q3", providerName: "Meins", model: "gpt-5", scope: "personal" } },
    });
    expect(settings.default).toEqual({ providerId: "q1", model: null });
    expect(settings.features.compose).toEqual({ providerId: "q3", model: "gpt-5" });
    expect(settings.features.summarize).toBeNull();
    expect(settings.effective.compose?.scope).toBe("personal");
    expect(settings.effective.summarize).toBeNull();
  });

  it("takes events as the contract gives them and drops the unreadable ones", () => {
    const events = toEvents({
      events: [
        {
          title: "Zahnarzt",
          start: "2026-10-06T09:30:00",
          end: "2026-10-06T10:00:00",
          allDay: false,
          timeZone: "Europe/Berlin",
          location: "Praxis",
          description: null,
          url: "http://insecure.example.com",
          participants: [{ name: "Leni", email: "leni@example.org" }, { name: "Nobody" }],
          confidence: 0.85,
          quote: "am Dienstag um 9:30",
        },
        { title: "Kein Datum", start: "nächste Woche" },
        { title: "Ganztags", start: "2026-10-08T00:00:00", allDay: true },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      title: "Zahnarzt",
      start: "2026-10-06T09:30:00",
      end: "2026-10-06T10:00:00",
      allDay: false,
      timeZone: "Europe/Berlin",
      location: "Praxis",
      description: null,
      url: null,
      participants: [{ name: "Leni", email: "leni@example.org" }],
      confidence: 0.85,
      quote: "am Dienstag um 9:30",
    });
    expect(events[1]).toMatchObject({ end: "2026-10-09T00:00:00", timeZone: null, participants: [] });
  });

  it("takes only a web page as the sign-in address", () => {
    expect(
      toChatgptLogin({ userCode: "AB-12", verificationUri: "https://auth.example.com/codex/device" }),
    ).toMatchObject({ userCode: "AB-12", interval: 5 });
    for (const verificationUri of ["javascript:void 0", "http://auth.example.com/", "https:\\\\x.example", "/local"]) {
      expect(() => toChatgptLogin({ userCode: "AB-12", verificationUri })).toThrow();
    }
  });

  it("bounds how many events and how much text a model's answer brings", () => {
    const one = { start: "2026-10-06T09:30:00", title: "🎉".repeat(500), description: "d".repeat(5000) };
    const events = toEvents({ events: Array.from({ length: 100 }, () => one) });
    expect(events).toHaveLength(MAX_ASSIST_EVENTS);
    expect(Array.from(events[0]!.title)).toHaveLength(200);
    expect(events[0]!.title.endsWith("🎉")).toBe(true);
    expect(events[0]!.description).toHaveLength(2000);
  });

  it("keeps the verdict to the four words and the server's signals as they are", () => {
    const check = toSpamCheck(
      {
        verdict: "scam",
        confidence: 3,
        reasons: ["a", "b"],
        signals: {
          authentication: { spf: "fail", dkim: null, dmarc: "fail", fromDomain: "bank.example" },
          spamScore: 4.2,
          spamThreshold: 5,
          tests: ["DMARC_FAIL"],
          inJunk: false,
          sender: { address: "service@bank.example", earlierMessages: 0, inContacts: false, firstSeen: null },
        },
        providerId: "q1",
        providerName: "Mistral",
        model: "mistral-small-latest",
        usage: { inputTokens: 1830, outputTokens: 96 },
      },
      "e42",
    );
    expect(check).toMatchObject({ emailId: "e42", verdict: "suspicious", confidence: 1, providerName: "Mistral" });
    expect(check.signals.authentication).toEqual({
      spf: "fail",
      dkim: null,
      dmarc: "fail",
      fromDomain: "bank.example",
    });
    expect(check.signals.sender).toMatchObject({ earlierInJunk: 0, writtenTo: 0 });
  });
});

// --- The backend's requests -------------------------------------------------------------------

const jmap = vi.hoisted(() => ({
  capability: {
    features: { compose: true, summarize: true, spamCheck: true, extractEvents: true, autoLabels: true },
    mayAddProviders: true,
  } as unknown,
  streamUrl: null as string | null,
  one: vi.fn(),
}));

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const session = () => ({
    accountId: "a1",
    accounts: {
      a1: {
        name: "mini@uwumail.example",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: jmap.capability === undefined ? {} : { [ASSIST]: jmap.capability },
      },
    },
    apiUrl: "/jmap/api",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    capabilities: jmap.streamUrl ? { [ASSIST]: { streamUrl: jmap.streamUrl } } : {},
    state: "s1",
  });
  return {
    ...actual,
    loadJmapSession: async () => session(),
    jmapSession: session,
    whenSessionChanges: () => {},
    watchPush: () => () => {},
    csrfToken: () => "csrf-1",
    call: async () => ({
      methodResponses: [["Mailbox/get", { list: [], notFound: [], state: "1" }, "m0"]],
      sessionState: "s1",
    }),
    one: jmap.one,
  };
});

describe("an estimate", () => {
  it("adds up what the server leaves out and takes a missing limit as none", () => {
    expect(
      toEstimate(
        { inputTokens: 1000.4, outputTokens: 200, tokensLeftToday: -5, requestsLeftToday: "x" },
        "Assist/summarize",
      ),
    ).toEqual({
      method: "Assist/summarize",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      providerId: "",
      providerName: "",
      model: null,
      tokensLeftToday: 0,
      requestsLeftToday: null,
    });
  });
});

describe("JmapBackend's assistant", () => {
  const load = async () => new (await import("./JmapBackend")).JmapBackend();
  const using = ["urn:ietf:params:jmap:core", ASSIST];

  afterEach(() => {
    jmap.one.mockReset();
    jmap.streamUrl = null;
    jmap.capability = {
      features: { compose: true, summarize: true, spamCheck: true, extractEvents: true, autoLabels: true },
      mayAddProviders: true,
    };
    vi.unstubAllGlobals();
  });

  it("is only there where the account's capability says so", async () => {
    const backend = await load();
    expect((await backend.assistFeatures())?.compose).toBe(true);
    jmap.capability = undefined;
    expect(await backend.assistOptions()).toBeNull();
    await expect(backend.assistProviders()).rejects.toMatchObject({ type: "assistUnavailable" });
    expect(jmap.one).not.toHaveBeenCalled();
  });

  it("asks for events the way the contract says", async () => {
    jmap.one.mockResolvedValueOnce({
      accountId: "a1",
      emailId: "e42",
      events: [{ title: "Termin", start: "2026-10-06T09:30:00", end: "2026-10-06T10:00:00", quote: "9:30" }],
      providerId: "q1",
      providerName: "Mistral",
      model: "mistral-small-latest",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const result = await (await load()).extractEvents("e42", true);
    expect(jmap.one).toHaveBeenCalledWith("Assist/extractEvents", { emailId: "e42", includeImages: true }, using);
    expect(result.events[0]).toMatchObject({ title: "Termin", location: null, participants: [] });
    expect(result.answer?.providerName).toBe("Mistral");
  });

  it("refuses mail of a shared account before asking", async () => {
    await expect((await load()).extractEvents("a7~e1", false)).rejects.toMatchObject({ type: "forbidden" });
    expect(jmap.one).not.toHaveBeenCalled();
  });

  it("writes without a stream in one answer and hands it to the handlers", async () => {
    jmap.one.mockResolvedValueOnce({ text: "Hallo Mia", subject: "Absage", providerId: "q1", providerName: "M" });
    const pieces: string[] = [];
    const result = await (
      await load()
    ).assistCompose(
      { mode: "write", instruction: "Sag Mia ab", wantSubject: true, replyToEmailId: "e9", language: "de" },
      { onDelta: (text) => pieces.push(text) },
    );
    expect(jmap.one).toHaveBeenCalledWith(
      "Assist/compose",
      {
        mode: "write",
        instruction: "Sag Mia ab",
        preset: null,
        targetLanguage: null,
        text: null,
        subject: null,
        replyToEmailId: "e9",
        wantSubject: true,
        language: "de",
      },
      using,
    );
    expect(pieces).toEqual(["Hallo Mia"]);
    expect(result).toMatchObject({ text: "Hallo Mia", subject: "Absage", providerName: "M" });
  });

  it("streams where the server offers it", async () => {
    jmap.streamUrl = "https://mail.example.org/jmap/assist/stream";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          body([
            'event: delta\ndata: {"text":"Kurz."}\n\n',
            'event: done\ndata: {"summary":"Kurz.","providerName":"M","threadId":"t1"}\n\n',
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pieces: string[] = [];
    const summary = await (
      await load()
    ).assistSummarize({ threadId: "t1", language: "de" }, { onDelta: (text) => pieces.push(text) });
    expect(summary).toMatchObject({ summary: "Kurz.", threadId: "t1", emailId: null });
    expect(pieces).toEqual(["Kurz."]);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    // On the page's own origin, like the API.
    expect(url).toBe("/jmap/assist/stream");
    expect(JSON.parse(init.body as string).arguments).toEqual({
      accountId: "a1",
      emailId: null,
      threadId: "t1",
      language: "de",
    });
    expect(jmap.one).not.toHaveBeenCalled();
  });

  it("changes one feature's choice with a patch path", async () => {
    jmap.one.mockResolvedValueOnce({ updated: { singleton: null } });
    const backend = await load();
    const events: string[] = [];
    backend.subscribe((event) => events.push(event.type));
    await backend.updateAssistSettings({ features: { compose: { providerId: "q3", model: "gpt-5" } } });
    expect(jmap.one).toHaveBeenCalledWith(
      "AssistSettings/set",
      { update: { singleton: { "features/compose": { providerId: "q3", model: "gpt-5" } } } },
      using,
    );
    expect(events).toContain("assist:changed");
  });

  it("passes a refused provider on with the field it names", async () => {
    jmap.one.mockResolvedValueOnce({
      notCreated: {
        new: { type: "invalidProperties", properties: ["baseUrl"], description: "Not in the local network." },
      },
    });
    const refused = (await load()).createAssistProvider({
      name: "Ollama",
      kind: "ollama",
      baseUrl: "http://192.0.2.10:11434",
    });
    await expect(refused).rejects.toBeInstanceOf(AssistError);
    await expect(refused).rejects.toMatchObject({ type: "invalidProperties", properties: ["baseUrl"] });
  });

  it("undoes labels by log entry and says the mail changed", async () => {
    jmap.one.mockResolvedValueOnce({ undone: ["l1"], notFound: [] });
    const backend = await load();
    const events: string[] = [];
    backend.subscribe((event) => events.push(event.type));
    await backend.undoAssistLabels(["l1"]);
    expect(jmap.one).toHaveBeenCalledWith("AssistLabel/undo", { ids: ["l1"] }, using);
    expect(events).toEqual(expect.arrayContaining(["assist:changed", "mail:changed"]));
  });

  it("asks what a call would cost with exactly that call's arguments", async () => {
    jmap.one.mockResolvedValueOnce({
      accountId: "a1",
      method: "Assist/compose",
      inputTokens: 900,
      outputTokens: 300,
      totalTokens: 1200,
      providerId: "q1",
      providerName: "Mistral (Server)",
      model: "mistral-medium-latest",
      tokensLeftToday: 48000,
      requestsLeftToday: null,
    });
    const backend = await load();
    const estimate = await backend.assistEstimate({
      method: "Assist/compose",
      request: { mode: "rewrite", preset: "shorter", text: "Hallo", replyToEmailId: "a7~e9" },
    });
    expect(jmap.one).toHaveBeenCalledWith(
      "Assist/estimate",
      {
        method: "Assist/compose",
        arguments: {
          mode: "rewrite",
          instruction: null,
          preset: "shorter",
          targetLanguage: null,
          text: "Hallo",
          subject: null,
          // Mail of a shared account is no context, as in the real call.
          replyToEmailId: null,
          wantSubject: false,
          language: null,
        },
      },
      using,
    );
    expect(estimate).toMatchObject({ totalTokens: 1200, tokensLeftToday: 48000, requestsLeftToday: null });

    jmap.one.mockResolvedValueOnce({ inputTokens: 10, outputTokens: 5 });
    await backend.assistEstimate({ method: "Assist/extractEvents", emailId: "e4", includeImages: true });
    expect(jmap.one).toHaveBeenLastCalledWith(
      "Assist/estimate",
      { method: "Assist/extractEvents", arguments: { emailId: "e4", includeImages: true } },
      using,
    );
    await expect(backend.assistEstimate({ method: "Assist/spamCheck", emailId: "a7~e1" })).rejects.toMatchObject({
      type: "forbidden",
    });
  });

  it("has no estimate from a server that doesn't know the method", async () => {
    jmap.one.mockRejectedValueOnce(new JmapMethodError("not_supported", "unknown", "unknownMethod"));
    const backend = await load();
    expect(await backend.assistEstimate({ method: "Assist/summarize", request: { threadId: "t1" } })).toBeNull();
    jmap.one.mockRejectedValueOnce(new JmapMethodError("forbidden", "quota", "overQuota"));
    await expect(backend.assistEstimate({ method: "Assist/spamCheck", emailId: "e1" })).rejects.toMatchObject({
      type: "overQuota",
    });
  });

  it("asks for the log of the own mail only", async () => {
    jmap.one.mockResolvedValueOnce({ list: [{ id: "l1", emailId: "e1", labelId: "g1", keyword: "Rechnungen" }] });
    const log = await (await load()).assistLabelLog(["e1", "a7~e2"]);
    expect(jmap.one).toHaveBeenCalledWith("AssistLabel/log", { emailIds: ["e1"], limit: 100 }, using);
    expect(log[0]).toMatchObject({ keyword: "rechnungen", undone: false });
  });
});
