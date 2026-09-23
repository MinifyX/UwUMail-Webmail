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

export interface JmapSession {
  accountId: string;
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
  accounts?: Record<string, unknown>;
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
  session = {
    accountId,
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

function downloadPath(blobId: string, name: string): string {
  const { downloadUrl, accountId } = jmapSession();
  const filled = downloadUrl
    .replaceAll("{accountId}", encodeURIComponent(accountId))
    .replaceAll("{blobId}", encodeURIComponent(blobId))
    .replaceAll("{name}", encodeURIComponent(name))
    .replaceAll("{type}", "application/octet-stream");
  return onOwnOrigin(filled);
}

/** Downloads a blob into memory. Blobs are fetched, never linked, so the session header fits. */
export async function downloadBlob(blobId: string, name: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(downloadPath(blobId, name), { credentials: "same-origin" });
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

/**
 * Push over EventSource. The browser reconnects on its own; `onState` is called
 * with the changed types, e.g. `{ Email: "s12" }`.
 */
export function watchPush(onState: (changed: Record<string, string>) => void): () => void {
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
      const changed = data.changed?.[jmapSession().accountId];
      if (changed) onState(changed);
    } catch {
      // A push we can't read is no reason to break the connection.
    }
  });
  return () => source?.close();
}
