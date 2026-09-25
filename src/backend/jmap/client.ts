/**
 * The JMAP transport (RFC 8620): session resource, method calls, blobs and push.
 *
 * Authentication is the portal's session cookie, not Basic auth — the server
 * accepts it for JMAP when the CSRF token comes with it, the same rule its own
 * JSON API follows. Nothing here ever holds a password.
 */

import { BackendError, type BackendErrorCode } from "../backend";
import { currentSession } from "../server";

export const CORE = "urn:ietf:params:jmap:core";
export const MAIL = "urn:ietf:params:jmap:mail";
export const SUBMISSION = "urn:ietf:params:jmap:submission";
export const SENDERS = "urn:uwumail:jmap:senders";
/** Mail rules as Sieve scripts (RFC 9661). */
export const SIEVE = "urn:ietf:params:jmap:sieve";
/** Calendars and events (draft-ietf-jmap-calendars). */
export const CALENDARS = "urn:ietf:params:jmap:calendars";
/** Address books and contacts (RFC 9610). */
export const CONTACTS = "urn:ietf:params:jmap:contacts";
/** Our own: cleaned message HTML and delayed sending, see the server's docs. */
export const WEBMAIL = "urn:uwumail:jmap:webmail";
/** Our own: a mail's remote pictures, fetched by the server so their senders never see the reader. */
export const REMOTE = "urn:uwumail:jmap:remote";

/** An account of the session: the person's own, or one somebody shares folders from. */
export interface JmapAccount {
  name: string;
  isPersonal: boolean;
  isReadOnly: boolean;
  accountCapabilities: Record<string, unknown>;
}

export interface JmapSession {
  accountId: string;
  /** Every account of the session by id, the own one included. */
  accounts: Record<string, JmapAccount>;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  capabilities: Record<string, unknown>;
  state: string;
}

export type Invocation = [string, Record<string, unknown>, string];

interface RawSession {
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, Partial<JmapAccount>>;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  capabilities: Record<string, unknown>;
  state: string;
}

/**
 * Keeps the path of a URL the server announced, on our own origin.
 *
 * A self-hosted server often announces the name it has on the internet, which
 * a browser inside the LAN — or a dev server proxying to it — can't reach. The
 * page itself was served by the right host, so its origin is the one that works.
 */
function onOwnOrigin(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

let session: JmapSession | null = null;

/** Called when an API answer names another session state than the one before, e.g. a new share. */
let onSessionStale: (() => void) | null = null;
let lastSessionState: string | null = null;

export function whenSessionChanges(listener: (() => void) | null): void {
  onSessionStale = listener;
}

/** Loads the session anew, e.g. after somebody started or stopped sharing folders with the account. */
export async function reloadJmapSession(): Promise<JmapSession> {
  session = null;
  return loadJmapSession();
}

export async function loadJmapSession(): Promise<JmapSession> {
  if (session) return session;
  let response: Response;
  try {
    response = await fetch("/jmap/session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new BackendError("connection_failed", "The mail server can't be reached.");
  }
  if (response.status === 401) throw new BackendError("signed_out", "The session ended.");
  if (response.status === 403) throw new BackendError("webmail_disabled", "The webmail is switched off here.");
  if (!response.ok) throw new BackendError("internal", `The mail server answered ${response.status}.`);
  const raw = (await response.json()) as RawSession;
  const accountId = raw.primaryAccounts?.[MAIL] ?? Object.keys(raw.accounts ?? {})[0];
  if (!accountId) throw new BackendError("not_supported", "This login has no mailbox on the server.");
  const accounts = Object.fromEntries(
    Object.entries(raw.accounts ?? {}).map(([id, account]) => [
      id,
      {
        name: typeof account.name === "string" ? account.name : id,
        isPersonal: account.isPersonal !== false,
        isReadOnly: account.isReadOnly === true,
        accountCapabilities: account.accountCapabilities ?? {},
      },
    ]),
  );
  session = {
    accountId,
    accounts,
    apiUrl: onOwnOrigin(raw.apiUrl),
    downloadUrl: raw.downloadUrl,
    uploadUrl: onOwnOrigin(raw.uploadUrl),
    eventSourceUrl: onOwnOrigin(raw.eventSourceUrl),
    capabilities: raw.capabilities ?? {},
    state: raw.state,
  };
  return session;
}

export function jmapSession(): JmapSession {
  if (!session) throw new BackendError("internal", "The JMAP session has not been loaded yet.");
  return session;
}

export function supports(capability: string): boolean {
  return capability in jmapSession().capabilities;
}

/** What the own account says about a capability, e.g. the submission limits; null without it. */
export function accountCapability<T = Record<string, unknown>>(capability: string): T | null {
  const current = jmapSession();
  const value = current.accounts[current.accountId]?.accountCapabilities[capability];
  return value && typeof value === "object" ? (value as T) : null;
}

export interface MethodResponse {
  methodResponses: Invocation[];
  sessionState: string;
  createdIds?: Record<string, string>;
}

/** A method the server answered with an error, e.g. `stateMismatch`. */
export class JmapMethodError extends BackendError {
  readonly type: string;

  constructor(code: BackendErrorCode, message: string, type: string) {
    super(code, message);
    this.type = type;
  }
}

function methodError(name: string, args: Record<string, unknown>): JmapMethodError {
  const type = typeof args.type === "string" ? args.type : "unknown";
  const description = typeof args.description === "string" ? args.description : name;
  if (type === "accountNotFound" || type === "forbidden")
    return new JmapMethodError("webmail_disabled", description, type);
  if (type === "invalidArguments" || type === "invalidPatch")
    return new JmapMethodError("invalid_input", description, type);
  if (type === "unknownMethod" || type === "unknownCapability")
    return new JmapMethodError("not_supported", description, type);
  return new JmapMethodError("internal", `${type}: ${description}`, type);
}

/** One JMAP request with as many method calls as fit; throws on a method-level error. */
export async function call(methods: Invocation[], using: string[] = [CORE, MAIL]): Promise<MethodResponse> {
  const { apiUrl } = jmapSession();
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": currentSession().csrfToken,
      },
      body: JSON.stringify({ using, methodCalls: methods }),
    });
  } catch {
    throw new BackendError("connection_failed", "The mail server can't be reached.");
  }
  if (response.status === 401) throw new BackendError("signed_out", "The session ended.");
  if (response.status === 403) throw new BackendError("webmail_disabled", "The webmail is switched off here.");
  if (!response.ok) throw new BackendError("internal", `The mail server answered ${response.status}.`);
  const body = (await response.json()) as MethodResponse;
  if (body.sessionState) {
    // Compared with the previous answer, not the session document: once per change.
    const changed = lastSessionState !== null && body.sessionState !== lastSessionState;
    lastSessionState = body.sessionState;
    if (changed) onSessionStale?.();
  }
  for (const [name, args] of body.methodResponses) {
    if (name === "error") throw methodError(name, args);
  }
  return body;
}

/** The arguments of the first response with this call id. */
export function responseOf<T>(body: MethodResponse, callId: string): T {
  const found = body.methodResponses.find(([, , id]) => id === callId);
  if (!found) throw new BackendError("internal", `The server left out the answer to ${callId}.`);
  return found[1] as T;
}

/** A single call, for the many places that only need one. */
export async function one<T>(name: string, args: Record<string, unknown>, using: string[] = [CORE, MAIL]): Promise<T> {
  const body = await call([[name, { accountId: jmapSession().accountId, ...args }, "0"]], using);
  return responseOf<T>(body, "0");
}

function downloadPath(blobId: string, name: string, account?: string): string {
  const { downloadUrl, accountId: own } = jmapSession();
  const accountId = account ?? own;
  const filled = downloadUrl
    .replaceAll("{accountId}", encodeURIComponent(accountId))
    .replaceAll("{blobId}", encodeURIComponent(blobId))
    .replaceAll("{name}", encodeURIComponent(name))
    .replaceAll("{type}", "application/octet-stream");
  return onOwnOrigin(filled);
}

/**
 * Where the server fetches a mail's remote picture for us, on our own origin; null when the
 * server can't (the session is not there yet, or it is an older server).
 */
export function remoteImagePath(url: string): string | null {
  if (!session) return null;
  const remote = session.capabilities[REMOTE] as { imageUrl?: unknown } | undefined;
  if (typeof remote?.imageUrl !== "string") return null;
  const filled = remote.imageUrl
    .replaceAll("{accountId}", encodeURIComponent(session.accountId))
    .replaceAll("{url}", encodeURIComponent(url));
  return onOwnOrigin(filled);
}

/** Where the server hands out the logo or website icon of a company sender; null when it can't. */
export function senderPicturePath(email: string): string | null {
  if (!session) return null;
  const remote = session.capabilities[REMOTE] as { pictureUrl?: unknown } | undefined;
  if (typeof remote?.pictureUrl !== "string") return null;
  const filled = remote.pictureUrl
    .replaceAll("{accountId}", encodeURIComponent(session.accountId))
    .replaceAll("{email}", encodeURIComponent(email));
  return onOwnOrigin(filled);
}

/**
 * Downloads a blob into memory. Blobs are fetched, never linked, so the session header fits.
 * `accountId` is the account the blob belongs to, a shared one for mail somebody shares.
 */
export async function downloadBlob(blobId: string, name: string, accountId?: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(downloadPath(blobId, name, accountId), { credentials: "same-origin" });
  } catch {
    throw new BackendError("connection_failed", "The attachment can't be fetched.");
  }
  if (response.status === 401) throw new BackendError("signed_out", "The session ended.");
  if (response.status === 404) throw new BackendError("not_found", "The attachment is gone.");
  if (!response.ok) throw new BackendError("internal", `The mail server answered ${response.status}.`);
  return response.blob();
}

export interface UploadedBlob {
  blobId: string;
  type: string;
  size: number;
}

export async function uploadBlob(data: Blob, type: string): Promise<UploadedBlob> {
  const { uploadUrl, accountId } = jmapSession();
  const url = onOwnOrigin(uploadUrl.replaceAll("{accountId}", encodeURIComponent(accountId)));
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": type || "application/octet-stream", "x-csrf-token": currentSession().csrfToken },
      body: data,
    });
  } catch {
    throw new BackendError("connection_failed", "The mail server can't be reached.");
  }
  if (response.status === 413) throw new BackendError("invalid_input", "That attachment is too big for the server.");
  if (!response.ok) throw new BackendError("internal", `The upload answered ${response.status}.`);
  return (await response.json()) as UploadedBlob;
}

export type PushListener = (changed: Record<string, Record<string, string>>) => void;

/** RFC 8887: pushes over a WebSocket, where the server offers one. */
export const WEBSOCKET = "urn:ietf:params:jmap:websocket";

/**
 * Push: `onState` is called with the changed types per account, e.g. `{ a3: { Email: "s12" } }`,
 * the own account's and those of people who share folders with it.
 *
 * Over the server's WebSocket where it offers one (RFC 8887), otherwise, or when that doesn't
 * connect, over the EventSource.
 */
export function watchPush(onState: PushListener): () => void {
  const socketUrl = pushSocketUrl();
  if (!socketUrl) return watchEventSource(onState);
  let fallback: (() => void) | null = null;
  const stopSocket = watchWebSocket(socketUrl, onState, () => {
    fallback = watchEventSource(onState);
  });
  return () => {
    stopSocket();
    fallback?.();
  };
}

/**
 * The WebSocket address on the page's own origin, with the CSRF token: a browser can't set headers
 * on a WebSocket, so the server takes the portal cookie together with `?csrf=`. Null without one.
 */
export function pushSocketUrl(): string | null {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return null;
  const capability = jmapSession().capabilities[WEBSOCKET] as { url?: unknown; supportsPush?: unknown } | undefined;
  if (typeof capability?.url !== "string" || capability.supportsPush === false) return null;
  return socketUrlFor(capability.url, window.location, currentSession().csrfToken);
}

/** `url` moved onto the page's origin (`ws:` for `http:`, `wss:` for `https:`), with the token added. */
export function socketUrlFor(url: string, page: Pick<Location, "protocol" | "host">, csrfToken: string): string {
  const path = new URL(url, `${page.protocol}//${page.host}`);
  const scheme = page.protocol === "https:" ? "wss:" : "ws:";
  path.searchParams.set("csrf", csrfToken);
  return `${scheme}//${page.host}${path.pathname}${path.search}`;
}

/** Waits before reconnecting: 1 s, then doubling up to half a minute. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Push over one WebSocket. Reconnects after a lost connection and asks for what changed meanwhile
 * (`pushState`); `onUnavailable` runs when the very first connection fails, for the EventSource.
 */
function watchWebSocket(url: string, onState: PushListener, onUnavailable: () => void): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let everOpen = false;
  let attempt = 0;
  let pushState: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    try {
      socket = new WebSocket(url, "jmap");
    } catch {
      if (!everOpen) onUnavailable();
      return;
    }
    socket.addEventListener("open", () => {
      everOpen = true;
      attempt = 0;
      socket?.send(
        JSON.stringify({ "@type": "WebSocketPushEnable", dataTypes: null, ...(pushState ? { pushState } : {}) }),
      );
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          "@type"?: string;
          changed?: Record<string, Record<string, string>>;
          pushState?: string;
        };
        if (data["@type"] !== "StateChange") return;
        if (data.pushState) pushState = data.pushState;
        if (data.changed) onState(data.changed);
      } catch {
        // A push we can't read is no reason to break the connection.
      }
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (stopped) return;
      if (!everOpen) {
        stopped = true;
        onUnavailable();
        return;
      }
      timer = setTimeout(connect, reconnectDelay(attempt++));
    });
  };
  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}

/** Push over EventSource. The browser reconnects on its own. */
function watchEventSource(onState: PushListener): () => void {
  const { eventSourceUrl } = jmapSession();
  const url = eventSourceUrl.replaceAll("{types}", "*").replaceAll("{closeafter}", "no").replaceAll("{ping}", "300");
  let source: EventSource | null = null;
  try {
    source = new EventSource(url, { withCredentials: true });
  } catch {
    return () => {};
  }
  source.addEventListener("state", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        changed?: Record<string, Record<string, string>>;
      };
      if (data.changed) onState(data.changed);
    } catch {
      // A push we can't read is no reason to break the connection.
    }
  });
  return () => source?.close();
}
