/**
 * The server's settings extension, `urn:uwumail:jmap:settings`.
 *
 * One `UserSettings` object per account (id `singleton`) with a flat map of keys to JSON values,
 * shared with the UwUMail app so both keep the same settings. Writes are patches of single keys
 * (`values/<key>`), so two devices changing different keys never overwrite each other; `null`
 * removes a key. Lists are one key per entry for the same reason, e.g. `signature:<id>`.
 *
 * Only the transport and the signature keys live here so far; the other keys of the contract
 * (theme, tone, trusted senders, …) use the same `loadUserSettings` / `patchUserSettings`.
 */

import { SIGNATURE_MAX_BYTES, signatureValue, valueSize } from "@/lib/signatures";
import type { Signature } from "../types";
import { BackendError } from "../backend";
import { CORE, one } from "./client";

export const SETTINGS = "urn:uwumail:jmap:settings";

export type SettingsValues = Record<string, unknown>;

export interface UserSettingsSnapshot {
  state: string;
  values: SettingsValues;
}

interface GetResponse {
  state: string;
  list: { id: string; values?: SettingsValues }[];
}

interface SetResponse {
  newState?: string;
  notUpdated?: Record<string, { type: string; description?: string; properties?: string[] }>;
}

/** A key as a JSON pointer segment inside the patch (RFC 6901: `~` → `~0`, `/` → `~1`). */
export function patchPath(key: string): string {
  return `values/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

export async function loadUserSettings(): Promise<UserSettingsSnapshot> {
  const response = await one<GetResponse>("UserSettings/get", { ids: ["singleton"] }, [CORE, SETTINGS]);
  return { state: response.state, values: response.list[0]?.values ?? {} };
}

/** Sets (or with `null` removes) single keys. Returns the new state. */
export async function patchUserSettings(changes: Record<string, unknown>): Promise<string | undefined> {
  const patch = Object.fromEntries(Object.entries(changes).map(([key, value]) => [patchPath(key), value]));
  const response = await one<SetResponse>("UserSettings/set", { update: { singleton: patch } }, [CORE, SETTINGS]);
  const problem = response.notUpdated?.singleton;
  if (problem) {
    if (problem.type === "tooLarge" || problem.type === "overQuota") {
      throw new BackendError("invalid_input", "That is too big for the server's settings.");
    }
    throw new BackendError(
      problem.type === "invalidProperties" ? "invalid_input" : "internal",
      problem.description ?? problem.type,
    );
  }
  return response.newState;
}

// Signatures: `signature:<id>` → { email, name, html, forNew, forReplies }.

const SIGNATURE_PREFIX = "signature:";
const SIGNATURE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function signatureKey(id: string): string {
  if (!SIGNATURE_ID.test(id)) throw new BackendError("invalid_input", "That signature id makes no sense.");
  return `${SIGNATURE_PREFIX}${id}`;
}

/** A fresh id in the allowed alphabet. */
export function newSignatureId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Every signature among the settings, sorted by name. Values that don't have the
 * agreed shape (another client's bug, a newer version) are skipped instead of breaking the list.
 * The html is still untrusted here: whoever shows or inserts it cleans it first.
 */
export function signaturesFrom(values: SettingsValues): Signature[] {
  const found: Signature[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(SIGNATURE_PREFIX)) continue;
    const id = key.slice(SIGNATURE_PREFIX.length);
    if (!SIGNATURE_ID.test(id) || typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.email !== "string" || typeof entry.html !== "string") continue;
    found.push({
      id,
      email: entry.email,
      name: typeof entry.name === "string" ? entry.name : "",
      html: entry.html,
      forNew: entry.forNew === true,
      forReplies: entry.forReplies === true,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The patch that saves `signature`. Only one signature per address can be the default for new
 * mail, and one for replies, so taking a default away from the others goes into the same write.
 */
export function signaturePatch(signature: Signature, existing: Signature[]): Record<string, unknown> {
  const value = signatureValue(signature);
  if (valueSize(value) > SIGNATURE_MAX_BYTES) {
    throw new BackendError("invalid_input", "The signature is too big. Try a smaller picture.");
  }
  const patch: Record<string, unknown> = { [signatureKey(signature.id)]: value };
  const email = signature.email.toLowerCase();
  for (const other of existing) {
    if (other.id === signature.id || other.email.toLowerCase() !== email) continue;
    const forNew = signature.forNew ? false : other.forNew;
    const forReplies = signature.forReplies ? false : other.forReplies;
    if (forNew !== other.forNew || forReplies !== other.forReplies) {
      patch[signatureKey(other.id)] = signatureValue({ ...other, forNew, forReplies });
    }
  }
  return patch;
}
