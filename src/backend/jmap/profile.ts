/**
 * The own profile picture over UwUMail's `urn:uwumail:jmap:profile` extension: one
 * `ProfilePicture` object per account, id "singleton", with the picture as a blob and who may
 * see it. The server decodes, crops and cleans whatever is uploaded; the webmail sends a square
 * it cropped itself anyway.
 */

import { BackendError } from "../backend";
import type { PictureVisibility, ProfilePictureOptions } from "../types";

export const PROFILE = "urn:uwumail:jmap:profile";
export const PROFILE_ID = "singleton";

/** What the server allows when it doesn't say: its own default of 10 MiB. */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

export interface JmapProfilePicture {
  id: string;
  blobId?: string | null;
  type?: string | null;
  visibility?: string | null;
  sendFace?: boolean | null;
  updated?: string | null;
}

const VISIBILITIES = new Set<PictureVisibility>(["off", "server", "public"]);

/** The account's profile capability; null when it may have no picture here. */
export function profileOptionsFrom(capability: unknown): ProfilePictureOptions | null {
  if (!capability || typeof capability !== "object") return null;
  const raw = capability as { maxSize?: unknown; mayBePublic?: unknown };
  const maxSize = typeof raw.maxSize === "number" && raw.maxSize > 0 ? raw.maxSize : DEFAULT_MAX_SIZE;
  return { maxSize, mayBePublic: raw.mayBePublic !== false };
}

export function visibilityOf(raw: JmapProfilePicture): PictureVisibility {
  return VISIBILITIES.has(raw.visibility as PictureVisibility) ? (raw.visibility as PictureVisibility) : "server";
}

/** A refusal of ProfilePicture/set in the webmail's words. */
export function profileSetError(problem: { type: string; description?: string; properties?: string[] }): BackendError {
  if (problem.type === "invalidProperties" && (problem.properties ?? []).includes("visibility")) {
    return new BackendError("forbidden", problem.description ?? "Public pictures are switched off here.");
  }
  if (problem.type === "tooLarge") return new BackendError("invalid_input", "That picture is too big for the server.");
  if (problem.type === "invalidProperties") {
    return new BackendError("invalid_input", problem.description ?? "The server didn't take that picture.");
  }
  return new BackendError("internal", problem.description ?? problem.type);
}
