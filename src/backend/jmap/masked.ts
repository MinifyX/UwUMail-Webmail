/**
 * Masked addresses over Fastmail's JMAP extension (`https://www.fastmail.com/dev/maskedemail`),
 * which UwUMail Server speaks. UwUMail adds to it: the account's capability names the domains
 * the account may make them on (`domains`, `defaultDomain`), and a new one may name its `domain`.
 * See the server's docs/jmap-masked-email.md.
 */

import { BackendError } from "../backend";
import type { MaskedAddress, MaskedAddressInput, MaskedAddressPatch, MaskedOptions, MaskedState } from "../types";

export const MASKED = "https://www.fastmail.com/dev/maskedemail";

export interface JmapMaskedEmail {
  id: string;
  email: string;
  state?: string;
  forDomain?: string | null;
  description?: string | null;
  url?: string | null;
  createdAt?: string | null;
  lastMessageAt?: string | null;
  createdBy?: string | null;
}

export interface JmapSetError {
  type: string;
  description?: string;
  properties?: string[];
}

const STATES: readonly MaskedState[] = ["pending", "enabled", "disabled", "deleted"];

/**
 * What the own account's capabilities say: null without the extension. An older server announces
 * it as `{}`, which leaves the domain to it (`domains` null); an empty list means nobody enabled
 * masked addresses for the account.
 */
export function maskedOptionsFrom(accountCapabilities: Record<string, unknown> | undefined): MaskedOptions | null {
  const value = accountCapabilities?.[MASKED];
  if (!value || typeof value !== "object") return null;
  const raw = value as { domains?: unknown; defaultDomain?: unknown };
  const domains = Array.isArray(raw.domains)
    ? [...new Set(raw.domains.filter((domain): domain is string => typeof domain === "string" && domain !== ""))]
    : null;
  const wanted = typeof raw.defaultDomain === "string" ? raw.defaultDomain : null;
  const defaultDomain = wanted && (domains === null || domains.includes(wanted)) ? wanted : null;
  return { domains, defaultDomain };
}

export function toMaskedAddress(raw: JmapMaskedEmail): MaskedAddress {
  return {
    id: raw.id,
    email: raw.email,
    state: STATES.includes(raw.state as MaskedState) ? (raw.state as MaskedState) : "enabled",
    forDomain: raw.forDomain ?? "",
    description: raw.description ?? "",
    url: raw.url ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    lastMessageAt: raw.lastMessageAt ?? null,
    createdBy: raw.createdBy ?? "",
  };
}

/** The create object: made by hand, so `enabled` at once; `domain` only when one was chosen. */
export function maskedCreate(input: MaskedAddressInput): Record<string, unknown> {
  return {
    state: "enabled",
    description: input.description,
    forDomain: input.forDomain,
    ...(input.url ? { url: input.url } : {}),
    ...(input.emailPrefix ? { emailPrefix: input.emailPrefix } : {}),
    ...(input.domain ? { domain: input.domain } : {}),
  };
}

/** The update, with only what the patch names. */
export function maskedUpdate(patch: MaskedAddressPatch): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

/**
 * A refused create or update as the settings explain it: `forbidden` (a domain the account may not
 * use, or the limit reached), `invalid_input` (a value the server doesn't take) or `not_found`.
 */
export function maskedSetError(problem: JmapSetError): BackendError {
  const description = problem.description ?? problem.type;
  if (problem.type === "forbidden" || problem.type === "overQuota") return new BackendError("forbidden", description);
  if (problem.type === "notFound") return new BackendError("not_found", description);
  if (problem.type === "invalidProperties" || problem.type === "invalidPatch") {
    return new BackendError("invalid_input", description);
  }
  return new BackendError("internal", description);
}
