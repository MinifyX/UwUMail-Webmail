/**
 * Newline-delimited JSON as it streams in: one value per line, handed out as soon as its line is
 * complete. A last line without a newline still counts; a line that isn't JSON is skipped.
 */

/** The longest line kept while waiting for its end; anything longer is dropped. */
const MAX_LINE = 64 * 1024;

export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onValue: (value: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  // A line that grew too long is skipped up to its newline.
  let skipping = false;
  const take = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    onValue(value);
  };
  const stop = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` keeps a character split between two chunks together.
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        if (!skipping) take(buffered.slice(0, newline));
        skipping = false;
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      if (buffered.length > MAX_LINE) {
        buffered = "";
        skipping = true;
      }
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    buffered += decoder.decode();
    if (!skipping) take(buffered);
  } finally {
    signal?.removeEventListener("abort", stop);
    reader.releaseLock();
  }
}
