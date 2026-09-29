/**
 * A mail's pictures on the server: the sizes of remote pictures before they load
 * (`imageSizesUrl` of `urn:uwumail:jmap:remote`) and the text in them (`Email/imageText`).
 */

import { readNdjson } from "@/lib/ndjson";
import type { ImageText, ImageTextResult, RemoteImageSize } from "../types";

/** The most addresses one request may ask about; the server refuses more. */
export const MAX_SIZE_URLS = 200;

const dimension = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** One line of the server's answer; null for anything that isn't one. */
export function toRemoteImageSize(value: unknown): RemoteImageSize | null {
  if (!value || typeof value !== "object") return null;
  const line = value as Record<string, unknown>;
  if (typeof line.url !== "string") return null;
  if (line.failed === true) return { url: line.url, width: null, height: null, failed: true };
  const width = dimension(line.width);
  const height = dimension(line.height);
  // Only both or neither: half a size says nothing about the shape.
  if (width === null || height === null) return { url: line.url, width: null, height: null, failed: false };
  return { url: line.url, width, height, failed: false };
}

/**
 * `POST imageSizesUrl` with the addresses; the answer streams one line per address as soon as the
 * server knows it. Rejects when the server can't be asked, so the caller loads the pictures directly.
 */
export async function probeImageSizes(
  path: string,
  csrfToken: string,
  urls: string[],
  onSize: (size: RemoteImageSize) => void,
  signal: AbortSignal,
): Promise<void> {
  const asked = new Set(urls.slice(0, MAX_SIZE_URLS));
  if (asked.size === 0) return;
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ urls: [...asked] }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`The picture sizes answered ${response.status}.`);
  await readNdjson(
    response.body,
    (value) => {
      const size = toRemoteImageSize(value);
      // Each address once, and only those we asked about.
      if (!size || !asked.delete(size.url)) return;
      onSize(size);
    },
    signal,
  );
}

function toImageText(value: unknown): ImageText | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.source !== "string" || typeof item.text !== "string") return null;
  return {
    source: item.source,
    text: item.text,
    width: dimension(item.width) ?? 0,
    height: dimension(item.height) ?? 0,
  };
}

/** `Email/imageText`'s answer, with what the server left out filled in. */
export function toImageTextResult(emailId: string, raw: Record<string, unknown>): ImageTextResult {
  const images = Array.isArray(raw.images) ? raw.images.map(toImageText).filter((item) => item !== null) : [];
  return {
    emailId,
    unavailable: raw.unavailable === true,
    images,
    skipped: typeof raw.skipped === "number" && Number.isFinite(raw.skipped) ? raw.skipped : 0,
  };
}
