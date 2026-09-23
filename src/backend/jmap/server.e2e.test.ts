// @vitest-environment node
/**
 * End-to-end test of the real backend code against a running UwUMail server.
 *
 * Skipped unless UWUMAIL_TEST_SERVER is set, so `pnpm test` and CI never touch a server:
 *
 *   UWUMAIL_TEST_SERVER=http://127.0.0.1:18080 UWUMAIL_TEST_LOGIN=mini@a.test \
 *   UWUMAIL_TEST_PASSWORD=… pnpm vitest run src/backend/jmap/server.e2e.test.ts
 *
 * Optional: UWUMAIL_TEST_FORWARD_LOGIN / UWUMAIL_TEST_FORWARD_PASSWORD (a second account that
 * receives a forwarded mail, default ami@a.test with the same password), UWUMAIL_TEST_SMTP_PORT
 * (the server's port-25 listener on the same host, default 2525).
 *
 * The only shims are a fetch that resolves relative URLs against the server and carries the
 * portal's session cookie (a browser does both on its own), and an EventSource built on that
 * fetch, since Node has none. Everything else is the webmail's own code. The test cleans up after
 * itself: what it creates is deleted (also what an earlier run that died halfway left, recognised
 * by its `uwu-e2e-…` tag) and the previous rules script is put back.
 *
 * Use test accounts only: the rules test replaces the rules script for a while, and the folder
 * test empties the whole trash and junk folder.
 */

import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseRulesScript, rulesToSieve, RULE_FIELDS, RULE_OPS, type MailRule, type RuleSet } from "@/lib/sieveRules";
import { BackendError } from "../backend";
import { loadSession, webmailAccess, currentSession } from "../server";
import type { CalendarOccurrence, EventInput, Folder, Message } from "../types";
import { CALENDARS, CORE, MAIL, SIEVE, call, one, responseOf } from "./client";
import { JmapBackend } from "./JmapBackend";

const SERVER = process.env.UWUMAIL_TEST_SERVER ?? "";
const LOGIN = process.env.UWUMAIL_TEST_LOGIN ?? "mini@a.test";
const PASSWORD = process.env.UWUMAIL_TEST_PASSWORD ?? "";
const FORWARD_LOGIN = process.env.UWUMAIL_TEST_FORWARD_LOGIN ?? "ami@a.test";
const FORWARD_PASSWORD = process.env.UWUMAIL_TEST_FORWARD_PASSWORD ?? PASSWORD;
const SMTP_PORT = Number(process.env.UWUMAIL_TEST_SMTP_PORT ?? "2525");
/** A reserved domain without DNS: example.org itself publishes a DMARC reject policy. */
const SENDER = "sender@shop.example";
const ZONE = "Europe/Berlin";

/** Unique per run, so a run that died halfway never confuses the next one. */
const RUN = `uwu-e2e-${Date.now().toString(36)}`;
/** Names and subjects of this run or an earlier one, for the cleanup. */
const TAGGED = /\buwu-e2e-[0-9a-z]{8,}\b/;

// ---------------------------------------------------------------------------------------------
// Shims: what the browser would do
// ---------------------------------------------------------------------------------------------

const nodeFetch = globalThis.fetch;
let cookie = "";

function resolve(input: RequestInfo | URL): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, SERVER);
}

/** A browser resolves relative URLs against the page and sends the session cookie itself. */
function browserFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  // Node's fetch keeps no cookies, so `credentials` changes nothing here.
  return nodeFetch(resolve(input), { ...init, headers });
}

/** The part of EventSource the push code uses, over fetch. */
class FetchEventSource {
  static opened: FetchEventSource[] = [];
  private readonly abort = new AbortController();
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  readonly connected: Promise<void>;
  private markConnected: () => void = () => {};

  constructor(url: string, _init?: EventSourceInit) {
    this.connected = new Promise((done) => (this.markConnected = done));
    FetchEventSource.opened.push(this);
    void this.run(url);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.abort.abort();
  }

  private async run(url: string): Promise<void> {
    try {
      const response = await browserFetch(url, {
        headers: { accept: "text/event-stream" },
        signal: this.abort.signal,
      });
      if (!response.ok || !response.body) return;
      this.markConnected();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value.replace(/\r\n?/g, "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          this.dispatch(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {
      // Closed.
    }
  }

  private dispatch(block: string): void {
    let type = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) return;
    const event = new MessageEvent<string>(type, { data: data.join("\n") });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

interface PortalLogin {
  cookie: string;
  csrfToken: string;
}

async function portalLogin(login: string, password: string): Promise<PortalLogin> {
  const response = await nodeFetch(new URL("/api/auth/login", SERVER), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (response.status !== 200) throw new Error(`portal login of ${login}: ${response.status}`);
  const setCookie = response.headers.getSetCookie().find((line) => line.startsWith("uwumail="));
  if (!setCookie) throw new Error("portal login without a session cookie");
  const body = (await response.json()) as { csrfToken: string };
  return { cookie: setCookie.split(";")[0]!, csrfToken: body.csrfToken };
}

async function portalLogout(session: PortalLogin): Promise<void> {
  await nodeFetch(new URL("/api/auth/logout", SERVER), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie, "x-csrf-token": session.csrfToken },
    body: "{}",
  }).catch(() => undefined);
}

/** JMAP as another account, for looking into the mailbox a rule forwarded to. */
async function jmapAs(
  session: PortalLogin,
  methodCalls: [string, Record<string, unknown>, string][],
): Promise<Map<string, Record<string, unknown>>> {
  const headers = { cookie: session.cookie, "x-csrf-token": session.csrfToken };
  const jmap = await nodeFetch(new URL("/jmap/session", SERVER), { headers });
  const accountId = ((await jmap.json()) as { primaryAccounts: Record<string, string> }).primaryAccounts[MAIL];
  const response = await nodeFetch(new URL("/jmap/api", SERVER), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      using: [CORE, MAIL],
      methodCalls: methodCalls.map(([name, args, id]) => [name, { accountId, ...args }, id]),
    }),
  });
  if (!response.ok) throw new Error(`JMAP as another account: ${response.status}`);
  const body = (await response.json()) as { methodResponses: [string, Record<string, unknown>, string][] };
  const answers = new Map<string, Record<string, unknown>>();
  for (const [name, args, id] of body.methodResponses) {
    if (name === "error") throw new Error(`JMAP as another account: ${JSON.stringify(args)}`);
    answers.set(id, args);
  }
  return answers;
}

/** The newest mail of an account, for finding what this run sent by its subject. */
const RECENT_MAIL: [string, Record<string, unknown>, string][] = [
  ["Email/query", { sort: [{ property: "receivedAt", isAscending: false }], limit: 200 }, "q"],
  [
    "Email/get",
    {
      "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
      properties: ["id", "from", "subject", "keywords"],
    },
    "g",
  ],
];

interface RecentMail {
  id: string;
  from: { email: string }[] | null;
  subject: string | null;
  keywords: Record<string, boolean>;
}

/** Only what this test sent, of this run or an earlier one. */
function sentByTest(list: RecentMail[]): string[] {
  return list
    .filter((email) => email.from?.[0]?.email === SENDER && TAGGED.test(email.subject ?? ""))
    .map((email) => email.id);
}

async function eventually<T>(what: string, probe: () => Promise<T | null | undefined>, timeout = 20_000): Promise<T> {
  const until = Date.now() + timeout;
  let last: unknown = null;
  while (Date.now() < until) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

/** A tiny SMTP client: one message, no TLS, for the server's port-25 role on the loopback. */
function smtpSend(from: string, to: string, message: string): Promise<void> {
  const host = new URL(SERVER).hostname;
  return new Promise((done, fail) => {
    const socket = net.connect(SMTP_PORT, host);
    socket.setEncoding("utf8");
    socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));
    const body = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const steps: [string | null, number][] = [
      [null, 220],
      ["EHLO client.example.org", 250],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ["DATA", 354],
      [`${body}\r\n.`, 250],
      ["QUIT", 221],
    ];
    let buffer = "";
    let step = 0;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // A reply is complete at a line "NNN " (the last line of a multi-line reply).
      const lines = buffer.split("\r\n");
      const last = lines.findIndex((line) => /^\d{3} /.test(line));
      if (last < 0) return;
      const reply = lines.slice(0, last + 1).join("\n");
      buffer = lines.slice(last + 1).join("\r\n");
      const code = Number(reply.split("\n").at(-1)!.slice(0, 3));
      const expected = steps[step]![1];
      if (code !== expected) {
        socket.destroy();
        fail(new Error(`SMTP step ${step} (${steps[step]![0] ?? "greeting"}) answered: ${reply}`));
        return;
      }
      step += 1;
      if (step === steps.length) {
        socket.end();
        done();
        return;
      }
      socket.write(`${steps[step]![0]}\r\n`);
    });
    socket.on("error", fail);
  });
}

function mail(headers: Record<string, string>, text: string): string {
  const all = {
    From: `Sender <${SENDER}>`,
    To: LOGIN,
    Date: new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID": `<${RUN}.${Math.random().toString(36).slice(2)}@example.org>`,
    "MIME-Version": "1.0",
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  };
  return `${Object.entries(all)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n")}\r\n\r\n${text}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------------------------

describe.skipIf(!SERVER)("webmail backend against a real UwUMail server", { timeout: 90_000 }, () => {
  let own: PortalLogin;
  let backend: JmapBackend;
  let accountId = "";
  const events: string[] = [];

  // Cleanup bookkeeping, so a failed step still leaves the account as it was.
  const createdCalendars = new Set<string>();
  const createdFolders = new Set<string>();
  let previousRules: { script: string | null; active: boolean } | null = null;
  let previousDefaultCalendar = "";
  let forwardSession: PortalLogin | null = null;
  let portalSession: Awaited<ReturnType<typeof loadSession>> = null;

  beforeAll(async () => {
    process.env.TZ = ZONE;
    own = await portalLogin(LOGIN, PASSWORD);
    cookie = own.cookie;
    vi.stubGlobal("fetch", browserFetch);
    vi.stubGlobal("EventSource", FetchEventSource);
    // As the app does: who is signed in first, then the mail engine.
    portalSession = await loadSession();
    backend = new JmapBackend();
    backend.subscribe((event) => events.push(event.type));
    accountId = (await backend.listAccounts())[0]?.id ?? "";
  });

  afterAll(async () => {
    // Everything here is best effort: one failure mustn't keep the rest from being cleaned.
    const quietly = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        console.warn("cleanup:", error);
      }
    };
    if (previousRules) {
      const rules = previousRules;
      await quietly(async () => {
        if (rules.script !== null) {
          await backend.saveMailRules(rules.script);
          if (!rules.active) await one("SieveScript/set", { onSuccessDeactivateScript: true }, [CORE, SIEVE]);
        } else {
          const scripts = await one<{ list: { id: string; name: string }[] }>("SieveScript/get", { ids: null }, [
            CORE,
            SIEVE,
          ]);
          const ours = scripts.list.find((script) => script.name === "UwUMail");
          if (ours) {
            await one("SieveScript/set", { onSuccessDeactivateScript: true }, [CORE, SIEVE]);
            await one("SieveScript/set", { destroy: [ours.id] }, [CORE, SIEVE]);
          }
        }
      });
    }
    if (previousDefaultCalendar) await quietly(() => backend.setDefaultCalendar(previousDefaultCalendar));
    // What this run made, and whatever an earlier run that died halfway left behind.
    await quietly(async () => {
      for (const calendar of await backend.calendars()) {
        if (createdCalendars.has(calendar.id) || TAGGED.test(calendar.name)) await backend.deleteCalendar(calendar.id);
      }
    });
    await quietly(async () => {
      const body = await call(RECENT_MAIL.map(([name, args, id]) => [name, { accountId, ...args }, id]));
      const destroy = sentByTest(responseOf<{ list: RecentMail[] }>(body, "g").list);
      if (destroy.length > 0) await one("Email/set", { destroy });
    });
    await quietly(async () => {
      const boxes = (
        await one<{ list: { id: string; name: string; parentId: string | null }[] }>("Mailbox/get", {
          ids: null,
          properties: ["name", "parentId"],
        })
      ).list;
      const byId = new Map(boxes.map((box) => [box.id, box]));
      const depth = (id: string | null): number => (id && byId.has(id) ? 1 + depth(byId.get(id)!.parentId) : 0);
      const tagged = (id: string | null): boolean =>
        !!id &&
        (createdFolders.has(id) || TAGGED.test(byId.get(id)?.name ?? "") || tagged(byId.get(id)?.parentId ?? null));
      // Inner folders first.
      const doomed = boxes.filter((box) => tagged(box.id)).sort((a, b) => depth(b.id) - depth(a.id));
      for (const box of doomed) await one("Mailbox/set", { destroy: [box.id], onDestroyRemoveEmails: true });
    });
    await quietly(async () => {
      forwardSession ??= await portalLogin(FORWARD_LOGIN, FORWARD_PASSWORD);
      const list = ((await jmapAs(forwardSession, RECENT_MAIL)).get("g")?.list ?? []) as RecentMail[];
      const destroy = sentByTest(list);
      if (destroy.length > 0) await jmapAs(forwardSession, [["Email/set", { destroy }, "d"]]);
    });
    if (forwardSession) await portalLogout(forwardSession);
    for (const source of FetchEventSource.opened) source.close();
    if (own) await portalLogout(own);
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------------------------

  it("reads the portal session and the JMAP session", async () => {
    expect(portalSession?.account.login).toBe(LOGIN);
    expect(currentSession().csrfToken).toMatch(/\S{16,}/);
    expect(await webmailAccess()).toMatchObject({ allowed: true });

    const [account] = await backend.listAccounts();
    expect(account?.email).toBe(LOGIN);
    expect(account?.id).toBe(accountId);
    expect(await backend.calendarsAvailable()).toBe(true);
    expect(await backend.mailRulesAvailable()).toBe(true);
    const roles = (await backend.listFolders()).map((folder) => folder.role);
    for (const role of ["inbox", "drafts", "sent", "archive", "junk", "trash"]) expect(roles).toContain(role);
  });

  // -------------------------------------------------------------------------------------------
  // Calendars
  // -------------------------------------------------------------------------------------------

  describe("calendars", () => {
    let crudId = "";

    it("has a default calendar", async () => {
      const calendars = await backend.calendars();
      const defaults = calendars.filter((calendar) => calendar.isDefault);
      expect(defaults).toHaveLength(1);
      previousDefaultCalendar = defaults[0]!.id;
      expect(defaults[0]!.mayWrite).toBe(true);
    });

    it("creates a calendar", async () => {
      const created = await backend.createCalendar({ name: `Crud ${RUN}`, color: "#3366ff" });
      crudId = created.id;
      createdCalendars.add(crudId);
      expect(created).toMatchObject({
        name: `Crud ${RUN}`,
        color: "#3366ff",
        isDefault: false,
        isVisible: true,
        mayWrite: true,
        mayDelete: true,
      });
      expect((await backend.calendars()).map((calendar) => calendar.id)).toContain(crudId);
    });

    it("renames, recolours and hides it", async () => {
      await backend.updateCalendar(crudId, { name: `Crud renamed ${RUN}` });
      await backend.updateCalendar(crudId, { color: "#00aa55" });
      await backend.updateCalendar(crudId, { isVisible: false });
      const found = (await backend.calendars()).find((calendar) => calendar.id === crudId);
      expect(found).toMatchObject({ name: `Crud renamed ${RUN}`, color: "#00aa55", isVisible: false });

      await backend.updateCalendar(crudId, { color: null, isVisible: true });
      const cleared = (await backend.calendars()).find((calendar) => calendar.id === crudId);
      expect(cleared).toMatchObject({ color: null, isVisible: true });
    });

    it("makes it the default and back", async () => {
      await backend.setDefaultCalendar(crudId);
      let calendars = await backend.calendars();
      expect(calendars.filter((calendar) => calendar.isDefault).map((calendar) => calendar.id)).toEqual([crudId]);

      await backend.setDefaultCalendar(previousDefaultCalendar);
      calendars = await backend.calendars();
      expect(calendars.filter((calendar) => calendar.isDefault).map((calendar) => calendar.id)).toEqual([
        previousDefaultCalendar,
      ]);
    });

    it("deletes it with its events", async () => {
      await backend.createEvent(timed(crudId, "Doomed", "2026-10-02T10:00:00", "2026-10-02T11:00:00"));
      await backend.deleteCalendar(crudId);
      createdCalendars.delete(crudId);
      expect((await backend.calendars()).map((calendar) => calendar.id)).not.toContain(crudId);
      const left = await backend.calendarEvents("2026-10-01T00:00:00", "2026-11-01T00:00:00", ZONE);
      expect(left.filter((occurrence) => occurrence.calendarId === crudId)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  function timed(calendarId: string, title: string, start: string, end: string): EventInput {
    return {
      calendarId,
      title: `${title} ${RUN}`,
      description: "",
      location: "",
      allDay: false,
      start,
      end,
      timeZone: ZONE,
      recurrence: null,
    };
  }

  describe("events", () => {
    let calendarId = "";
    const october = async (zone = ZONE): Promise<CalendarOccurrence[]> =>
      (await backend.calendarEvents("2026-10-01T00:00:00", "2026-11-01T00:00:00", zone)).filter(
        (occurrence) => occurrence.calendarId === calendarId,
      );
    const titled = (list: CalendarOccurrence[], title: string) =>
      list.filter((occurrence) => occurrence.title.startsWith(title));
    let dstId = "";
    let allDayId = "";
    let weeklyId = "";

    beforeAll(async () => {
      const created = await backend.createCalendar({ name: `Events ${RUN}`, color: "#ff4d8d" });
      calendarId = created.id;
      createdCalendars.add(calendarId);
    });

    it("creates a timed event across the end of summer time", async () => {
      // 25 Oct 2026, 03:00 CEST → 02:00 CET: 23:30 to 03:30 on the clock is five hours.
      const input = {
        ...timed(calendarId, "Night shift", "2026-10-24T23:30:00", "2026-10-25T03:30:00"),
        location: "Hall 3",
        description: "Clocks go back",
      };
      dstId = await backend.createEvent(input);
      const stored = await one<{ list: { duration: string; timeZone: string; start: string }[] }>(
        "CalendarEvent/get",
        { ids: [dstId], properties: ["start", "duration", "timeZone"] },
        [CORE, CALENDARS],
      );
      expect(stored.list[0]).toMatchObject({ start: "2026-10-24T23:30:00", timeZone: ZONE });
      expect(["PT5H", "PT5H0M", "PT5H0M0S"]).toContain(stored.list[0]!.duration);
    });

    it("creates an all-day event over three days", async () => {
      allDayId = await backend.createEvent({
        calendarId,
        title: `Holiday ${RUN}`,
        description: "",
        location: "",
        allDay: true,
        start: "2026-10-12T00:00:00",
        end: "2026-10-15T00:00:00",
        timeZone: null,
        recurrence: null,
      });
      expect(allDayId).toBeTruthy();
    });

    it("creates a weekly series on Mondays and Wednesdays", async () => {
      weeklyId = await backend.createEvent({
        ...timed(calendarId, "Yoga", "2026-10-05T18:00:00", "2026-10-05T19:00:00"),
        recurrence: { frequency: "weekly", interval: 1, byDay: ["mo", "we"], until: "2026-10-28", count: null },
      });
      expect(weeklyId).toBeTruthy();
    });

    it("lists the month with wall times, all-day flags and the series expanded", async () => {
      const list = await october();

      const [night] = titled(list, "Night shift");
      expect(night).toMatchObject({
        id: dstId,
        eventId: dstId,
        allDay: false,
        start: "2026-10-24T23:30:00",
        timeZone: ZONE,
        location: "Hall 3",
        description: "Clocks go back",
        recurrence: null,
        readOnly: false,
      });

      const [holiday] = titled(list, "Holiday");
      expect(holiday).toMatchObject({
        eventId: allDayId,
        allDay: true,
        start: "2026-10-12T00:00:00",
        end: "2026-10-15T00:00:00",
        timeZone: null,
        recurrence: null,
      });

      const yoga = titled(list, "Yoga");
      expect(yoga.map((occurrence) => occurrence.start)).toEqual(
        ["05", "07", "12", "14", "19", "21", "26", "28"].map((day) => `2026-10-${day}T18:00:00`),
      );
      for (const occurrence of yoga) {
        expect(occurrence.end).toBe(`${occurrence.start.slice(0, 10)}T19:00:00`);
        expect(occurrence.eventId).toBe(weeklyId);
        expect(occurrence.recurrence).toEqual({
          frequency: "weekly",
          interval: 1,
          byDay: ["mo", "we"],
          until: "2026-10-28",
          count: null,
        });
        expect(occurrence.recurrenceEditable).toBe(true);
        expect(occurrence.allDay).toBe(false);
      }
      expect(new Set(yoga.map((occurrence) => occurrence.id)).size).toBe(yoga.length);
    });

    it("shows the start on a clock in another zone", async () => {
      const [night] = titled(await october("America/New_York"), "Night shift");
      // 21:30Z; New York is still on summer time (UTC−4) until 1 November.
      expect(night?.start).toBe("2026-10-24T17:30:00");
    });

    it("ends the timed event five real hours later, across the change", async () => {
      // PT5H is an exact duration (RFC 5545 3.3.6, RFC 8984 1.4.6): 21:30Z + 5 h = 02:30Z,
      // which is 03:30 on a Berlin clock after it went back, and 22:30 in New York.
      const [berlin] = titled(await october(), "Night shift");
      expect(berlin?.end).toBe("2026-10-25T03:30:00");
      const [newYork] = titled(await october("America/New_York"), "Night shift");
      expect(newYork?.end).toBe("2026-10-24T22:30:00");
    });

    it("moves the whole series by editing one occurrence", async () => {
      const yoga = titled(await october(), "Yoga");
      const wednesday = yoga.find((occurrence) => occurrence.start.startsWith("2026-10-14"))!;
      await backend.updateEvent(
        wednesday.eventId,
        {
          calendarId,
          title: `Yoga late ${RUN}`,
          description: "",
          location: "",
          allDay: false,
          start: "2026-10-14T19:30:00",
          end: "2026-10-14T20:30:00",
          timeZone: ZONE,
          recurrence: wednesday.recurrence,
        },
        wednesday.start,
      );
      const moved = titled(await october(), "Yoga late");
      expect(moved.map((occurrence) => occurrence.start)).toEqual(
        ["05", "07", "12", "14", "19", "21", "26", "28"].map((day) => `2026-10-${day}T19:30:00`),
      );
      for (const occurrence of moved) expect(occurrence.end).toBe(`${occurrence.start.slice(0, 10)}T20:30:00`);
    });

    it("changes a single event's length", async () => {
      await backend.updateEvent(allDayId, {
        calendarId,
        title: `Holiday longer ${RUN}`,
        description: "",
        location: "",
        allDay: true,
        start: "2026-10-12T00:00:00",
        end: "2026-10-17T00:00:00",
        timeZone: null,
        recurrence: null,
      });
      const [holiday] = titled(await october(), "Holiday");
      expect(holiday).toMatchObject({ title: `Holiday longer ${RUN}`, end: "2026-10-17T00:00:00", allDay: true });
    });

    it("deletes one occurrence, then the whole series", async () => {
      let yoga = titled(await october(), "Yoga");
      const twentyFirst = yoga.find((occurrence) => occurrence.start.startsWith("2026-10-21"))!;
      await backend.deleteEvent(twentyFirst.id, "occurrence");
      yoga = titled(await october(), "Yoga");
      expect(yoga.map((occurrence) => occurrence.start.slice(8, 10))).toEqual([
        "05",
        "07",
        "12",
        "14",
        "19",
        "26",
        "28",
      ]);

      const twelfth = yoga.find((occurrence) => occurrence.start.startsWith("2026-10-12"))!;
      await backend.deleteEvent(twelfth.id, "series");
      expect(titled(await october(), "Yoga")).toEqual([]);
    });

    it("deletes a single event", async () => {
      await backend.deleteEvent(dstId, "occurrence");
      expect(titled(await october(), "Night shift")).toEqual([]);
    });

    it("leaves a rule it can't edit alone", async () => {
      // The first Monday of every month: more than the editor's Recurrence can say. Written
      // past the backend, as another client would, so only push can tell the backend about it.
      await (FetchEventSource.opened[0]?.connected ?? Promise.resolve());
      events.length = 0;
      const created = await one<{ created?: Record<string, { id: string }> }>(
        "CalendarEvent/set",
        {
          create: {
            complex: {
              "@type": "Event",
              calendarIds: { [calendarId]: true },
              title: `Board meeting ${RUN}`,
              start: "2026-10-05T09:00:00",
              duration: "PT1H",
              timeZone: ZONE,
              recurrenceRule: {
                "@type": "RecurrenceRule",
                frequency: "monthly",
                byDay: [{ "@type": "NDay", day: "mo", nthOfPeriod: 1 }],
                count: 3,
              },
            },
          },
        },
        [CORE, CALENDARS],
      );
      const complexId = created.created?.complex?.id;
      expect(complexId).toBeTruthy();
      await eventually("a push about the new event", async () => events.includes("calendar:changed") || null);

      const [meeting] = titled(await october(), "Board meeting");
      expect(meeting).toMatchObject({ start: "2026-10-05T09:00:00", recurrenceEditable: false });
      expect(meeting!.recurrence?.frequency).toBe("monthly");

      // Saving from the editor keeps the stored rule, even with the rough picture handed back.
      await backend.updateEvent(
        meeting!.eventId,
        {
          calendarId,
          title: `Board meeting renamed ${RUN}`,
          description: "",
          location: "",
          allDay: false,
          start: meeting!.start,
          end: meeting!.end,
          timeZone: ZONE,
          recurrence: meeting!.recurrence,
        },
        meeting!.start,
      );
      const stored = await one<{ list: { title: string; recurrenceRule: Record<string, unknown> }[] }>(
        "CalendarEvent/get",
        { ids: [complexId], properties: ["title", "recurrenceRule"] },
        [CORE, CALENDARS],
      );
      expect(stored.list[0]!.title).toBe(`Board meeting renamed ${RUN}`);
      expect(stored.list[0]!.recurrenceRule).toMatchObject({
        frequency: "monthly",
        byDay: [{ day: "mo", nthOfPeriod: 1 }],
        count: 3,
      });
      const [november] = (await backend.calendarEvents("2026-11-01T00:00:00", "2026-12-01T00:00:00", ZONE)).filter(
        (occurrence) => occurrence.eventId === complexId,
      );
      expect(november).toMatchObject({ start: "2026-11-02T09:00:00", recurrenceEditable: false });
    });
  });

  // -------------------------------------------------------------------------------------------
  // Mail rules
  // -------------------------------------------------------------------------------------------

  async function folderById(id: string): Promise<Folder> {
    await backend.syncNow();
    const folder = (await backend.listFolders()).find((candidate) => candidate.id === id);
    if (!folder) throw new Error(`folder ${id} is gone`);
    return folder;
  }

  async function folderByRole(role: Folder["role"]): Promise<Folder> {
    await backend.syncNow();
    const folder = (await backend.listFolders()).find((candidate) => candidate.role === role);
    if (!folder) throw new Error(`no ${role} folder`);
    return folder;
  }

  /** The message with this subject in a folder, read through the list and the reader. */
  async function messageIn(folderId: string, subject: string): Promise<Message | null> {
    const page = await backend.listThreads({
      view: { kind: "folder", accountId, folderId },
      filter: "all",
      conversations: false,
      limit: 100,
    });
    const summary = page.threads.find((thread) => thread.subject === subject);
    if (!summary) return null;
    const detail = await backend.getThread(summary.id, false);
    const message = detail.messages[0] ?? null;
    return message;
  }

  async function mailboxesOf(messageId: string): Promise<string[]> {
    const found = await one<{ list: { mailboxIds: Record<string, boolean> }[] }>("Email/get", {
      ids: [messageId],
      properties: ["mailboxIds"],
    });
    return Object.keys(found.list[0]?.mailboxIds ?? {});
  }

  describe("mail rules", () => {
    let rulesFolder: Folder;
    let trash: Folder;
    let inbox: Folder;
    let set: RuleSet;
    const subjects = {
      newsletter: `Newsletter ${RUN}`,
      urgent: `Status ${RUN}`,
      trash: `Offer trash-${RUN}`,
      forward: `Hello ${RUN} (fwd-${RUN})`,
      plain: `Plain ${RUN}`,
    };

    beforeAll(async () => {
      previousRules = await backend.mailRules();
      const id = await backend.createFolder({ name: `Rules ${RUN}`, parentId: null });
      createdFolders.add(id);
      rulesFolder = await folderById(id);
      trash = await folderByRole("trash");
      inbox = await folderByRole("inbox");
    });

    it("stores every condition and action and reads the same rules back", async () => {
      const rule = (patch: Partial<MailRule> & Pick<MailRule, "id" | "name">): MailRule => ({
        enabled: true,
        match: "all",
        conditions: [],
        actions: [],
        stop: true,
        ...patch,
      });
      set = {
        v: 1,
        rules: [
          // Every field with every operation; "is" and "is not" of the same value never both hold.
          rule({
            id: "catalogue",
            name: "Every field and operation",
            conditions: RULE_FIELDS.flatMap((field) =>
              RULE_OPS.map((op) => ({ field, op, value: `nothing-${RUN}@example.org` })),
            ),
            actions: [{ type: "flag" }],
            stop: false,
          }),
          rule({
            id: "newsletter",
            name: "Newsletter into its folder",
            conditions: [
              { field: "listId", op: "contains", value: `news-${RUN}.example.org` },
              { field: "from", op: "endsWith", value: "@shop.example" },
            ],
            actions: [{ type: "move", mailboxId: rulesFolder.id, mailboxName: rulesFolder.path }, { type: "markRead" }],
          }),
          rule({
            id: "urgent",
            name: "Urgent gets a flag",
            match: "any",
            conditions: [
              { field: "subject", op: "startsWith", value: `[urgent-${RUN}]` },
              { field: "cc", op: "is", value: `urgent-${RUN}@example.org` },
            ],
            actions: [{ type: "flag" }],
          }),
          rule({
            id: "offers",
            name: "Offers into the trash",
            conditions: [
              { field: "subject", op: "contains", value: `trash-${RUN}` },
              { field: "to", op: "isNot", value: `nobody-${RUN}@example.org` },
              { field: "from", op: "notContains", value: "@a.test" },
            ],
            actions: [{ type: "trash", mailboxId: trash.id, mailboxName: trash.path }],
          }),
          rule({
            id: "forward",
            name: "Forward a copy",
            conditions: [
              { field: "toOrCc", op: "is", value: LOGIN },
              { field: "subject", op: "endsWith", value: `(fwd-${RUN})` },
              { field: "from", op: "startsWith", value: "sender@" },
            ],
            actions: [{ type: "forward", address: FORWARD_LOGIN, keepCopy: true }, { type: "markRead" }],
          }),
          // Switched off: would put everything into the trash if it were written out.
          rule({
            id: "off",
            name: "Switched off",
            enabled: false,
            actions: [{ type: "trash", mailboxId: trash.id, mailboxName: trash.path }],
          }),
        ],
      };
      const script = rulesToSieve(set);
      expect(await backend.validateMailRules(script)).toBeNull();
      await backend.saveMailRules(script);

      const stored = await backend.mailRules();
      expect(stored.active).toBe(true);
      expect(stored.script).toBe(script);
      expect(parseRulesScript(stored.script!)).toEqual({ kind: "rules", set });
    });

    it("hears about a broken script from the server", async () => {
      const complaint = await backend.validateMailRules('require ["fileinto"];\nif header :contains "subject" {\n');
      expect(complaint).toEqual(expect.any(String));
      expect(complaint).not.toBe("");
      await expect(backend.saveMailRules("if true { keep")).rejects.toBeInstanceOf(BackendError);
      // The good script is still the one that filters.
      expect(parseRulesScript((await backend.mailRules()).script!)).toEqual({ kind: "rules", set });
    });

    it("files delivered mail the way the rules say", async () => {
      await (FetchEventSource.opened[0]?.connected ?? Promise.resolve());
      events.length = 0;
      await smtpSend(
        SENDER,
        LOGIN,
        mail({ Subject: subjects.newsletter, "List-Id": `News <news-${RUN}.example.org>` }, "Issue 1"),
      );
      await smtpSend(SENDER, LOGIN, mail({ Subject: subjects.urgent, Cc: `urgent-${RUN}@example.org` }, "Soon."));
      await smtpSend(SENDER, LOGIN, mail({ Subject: subjects.trash }, "Buy now."));
      await smtpSend(SENDER, LOGIN, mail({ Subject: subjects.forward }, "Pass it on."));
      await smtpSend(SENDER, LOGIN, mail({ Subject: subjects.plain }, "Nothing special."));
      // Push tells the backend about the new mail without anybody asking (nothing below has run yet).
      await eventually("a push about new mail", async () => events.includes("mail:changed") || null);

      const newsletter = await eventually("the newsletter", () => messageIn(rulesFolder.id, subjects.newsletter));
      expect(newsletter.folderId).toBe(rulesFolder.id);
      expect(newsletter.flags).toMatchObject({ seen: true, flagged: false });
      expect(await mailboxesOf(newsletter.id)).toEqual([rulesFolder.id]);

      const urgent = await eventually("the urgent mail", () => messageIn(inbox.id, subjects.urgent));
      expect(urgent.flags).toMatchObject({ seen: false, flagged: true });

      const offer = await eventually("the offer", () => messageIn(trash.id, subjects.trash));
      expect(offer.folderId).toBe(trash.id);
      expect(await mailboxesOf(offer.id)).toEqual([trash.id]);

      const forwarded = await eventually("the kept copy", () => messageIn(inbox.id, subjects.forward));
      expect(forwarded.flags).toMatchObject({ seen: true, flagged: false });

      const plain = await eventually("the plain mail", () => messageIn(inbox.id, subjects.plain));
      expect(plain.flags).toMatchObject({ seen: false, flagged: false });
      expect(await mailboxesOf(plain.id)).toEqual([inbox.id]);
    });

    it("forwarded a copy to the other account", async () => {
      forwardSession = await portalLogin(FORWARD_LOGIN, FORWARD_PASSWORD);
      const session = forwardSession;
      const copy = await eventually("the forwarded copy", async () => {
        const list = ((await jmapAs(session, RECENT_MAIL)).get("g")?.list ?? []) as RecentMail[];
        return list.find((email) => email.subject === subjects.forward);
      });
      // The copy arrives as it was sent: the rule's "read" is for the kept copy only.
      expect(copy.keywords.$seen).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------------------------

  describe("folders", () => {
    let parentId = "";
    let childId = "";

    it("creates a folder and one inside it", async () => {
      parentId = await backend.createFolder({ name: `Parent ${RUN}`, parentId: null });
      createdFolders.add(parentId);
      childId = await backend.createFolder({ name: "Child", parentId });
      createdFolders.add(childId);
      const folders = await backend.listFolders();
      expect(folders.find((folder) => folder.id === parentId)).toMatchObject({
        name: `Parent ${RUN}`,
        path: `Parent ${RUN}`,
        parentId: null,
        role: null,
      });
      expect(folders.find((folder) => folder.id === childId)).toMatchObject({
        name: "Child",
        path: `Parent ${RUN}/Child`,
        parentId,
      });
    });

    it("renames the inner folder", async () => {
      await backend.renameFolder(childId, "Child renamed");
      const child = (await backend.listFolders()).find((folder) => folder.id === childId);
      expect(child).toMatchObject({ name: "Child renamed", path: `Parent ${RUN}/Child renamed` });
    });

    it("won't delete a folder that still holds one", async () => {
      await expect(backend.deleteFolder(parentId)).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("moves a folder's mail to the trash before deleting it", async () => {
      const inbox = await folderByRole("inbox");
      const trash = await folderByRole("trash");
      const plain = await messageIn(inbox.id, `Plain ${RUN}`);
      expect(plain).not.toBeNull();
      await backend.moveMessages([plain!.id], childId);
      expect(await mailboxesOf(plain!.id)).toEqual([childId]);

      await backend.deleteFolder(childId);
      createdFolders.delete(childId);
      expect(await mailboxesOf(plain!.id)).toEqual([trash.id]);
      expect((await backend.listFolders()).map((folder) => folder.id)).not.toContain(childId);

      await backend.deleteFolder(parentId);
      createdFolders.delete(parentId);
      expect((await backend.listFolders()).map((folder) => folder.id)).not.toContain(parentId);
    });

    it("refuses to empty anything but trash and junk", async () => {
      const inbox = await folderByRole("inbox");
      await expect(backend.emptyFolder(inbox.id)).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("empties junk and says how many went", async () => {
      const inbox = await folderByRole("inbox");
      const urgent = await messageIn(inbox.id, `Status ${RUN}`);
      expect(urgent).not.toBeNull();
      await backend.markSpam([urgent!.id], true);
      const junk = await folderByRole("junk");
      expect(junk.total).toBeGreaterThanOrEqual(1);
      expect(await backend.emptyFolder(junk.id)).toBe(junk.total);
      expect((await folderByRole("junk")).total).toBe(0);
    });

    it("empties the trash and says how many went", async () => {
      // What the rules test left: the newsletter's folder goes to the trash with its mail,
      // and the kept forward copy is thrown away by hand.
      const inbox = await folderByRole("inbox");
      const kept = await messageIn(inbox.id, `Hello ${RUN} (fwd-${RUN})`);
      if (kept) await backend.trash([kept.id]);
      // Inner folders first.
      for (const id of [...createdFolders].reverse()) {
        await backend.deleteFolder(id);
        createdFolders.delete(id);
      }
      const trash = await folderByRole("trash");
      expect(trash.total).toBeGreaterThanOrEqual(3);
      expect(await backend.emptyFolder(trash.id)).toBe(trash.total);
      expect((await folderByRole("trash")).total).toBe(0);
    });
  });
});
