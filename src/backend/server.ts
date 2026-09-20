/**
 * The webmail's line to the server it is served from.
 *
 * There is no login here: the portal's session cookie is the login, and this
 * module only reads who that is. Everything that changes something carries the
 * session's CSRF token, exactly like the portal's own requests.
 */

import { BackendError } from "./backend";

export type Role = "admin" | "member";

export interface ServerAccount {
  id: number;
  login: string;
  name: string;
  role: Role;
}

/** Settings the server keeps for this account; the portal writes the same ones. */
export interface Preferences {
  language?: string;
  tone?: string;
  theme?: string;
  motion?: string;
  mailConversations?: string;
  mailDensity?: string;
  mailRemoteImages?: string;
  mailAppearance?: string;
  mailUndoSend?: string;
  mailSwipeRight?: string;
  mailSwipeLeft?: string;
  mailSenderPictures?: string;
}

export interface ServerSession {
  account: ServerAccount;
  csrfToken: string;
  preferences: Preferences;
  server: { hostname: string; version: string };
}

let session: ServerSession | null = null;

export function currentSession(): ServerSession {
  if (!session) throw new BackendError("signed_out", "Not signed in.");
  return session;
}

/** Where the portal lives, for links and for sending someone to the login page. */
export const PORTAL_URL = "/";

function problem(status: number, body: unknown): BackendError {
  const detail =
    typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string"
      ? body.detail
      : `The server answered ${status}.`;
  if (status === 401) return new BackendError("signed_out", detail);
  if (status === 403) return new BackendError("webmail_disabled", detail);
  if (status === 404) return new BackendError("not_found", detail);
  if (status === 400 || status === 422) return new BackendError("invalid_input", detail);
  return new BackendError("internal", detail);
}

/** A call to the server's own JSON API (not JMAP). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-csrf-token", currentSession().csrfToken);
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new BackendError("connection_failed", "The server can't be reached.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw problem(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Reads who is signed in. Null means: send them to the portal's login page. */
export async function loadSession(): Promise<ServerSession | null> {
  let response: Response;
  try {
    response = await fetch("/api/session", { credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    throw new BackendError("connection_failed", "The server can't be reached.");
  }
  if (!response.ok) throw problem(response.status, await response.json().catch(() => null));
  const body = (await response.json()) as ServerSession | null;
  session = body;
  return body;
}

export async function savePreferences(patch: Preferences): Promise<void> {
  const updated = await api<Preferences>("/api/account/preferences", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (session) session.preferences = updated;
}

/** Whether the webmail is switched on for this server and this account. */
export interface WebmailAccess {
  allowed: boolean;
  /** Why not, when it isn't: the whole server, or just this account. */
  reason?: "server" | "account";
}

export async function webmailAccess(): Promise<WebmailAccess> {
  return api<WebmailAccess>("/api/account/webmail");
}
