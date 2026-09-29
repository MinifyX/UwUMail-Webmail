import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

/** A stream handing out these chunks one by one, as a slow server would. */
function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) return controller.close();
      controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
  });
}

async function collect(chunks: (string | Uint8Array)[]) {
  const values: unknown[] = [];
  await readNdjson(streamOf(chunks), (value) => values.push(value));
  return values;
}

describe("readNdjson", () => {
  it("hands out each line as soon as it is complete", async () => {
    const values: unknown[] = [];
    const encoder = new TextEncoder();
    let push: (chunk: string) => void = () => {};
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(encoder.encode(chunk));
        close = () => controller.close();
      },
    });
    const reading = readNdjson(stream, (value) => values.push(value));
    push('{"a":1}\n{"b"');
    await expect.poll(() => values).toEqual([{ a: 1 }]);
    push(":2}\n");
    await expect.poll(() => values).toEqual([{ a: 1 }, { b: 2 }]);
    close();
    await reading;
  });

  it("joins lines split across chunks, also inside a character", async () => {
    const bytes = new TextEncoder().encode('{"text":"Grüße ✓"}\n');
    const cut = bytes.indexOf(0xc3) + 1;
    expect(await collect([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([{ text: "Grüße ✓" }]);
  });

  it("takes a last line without a newline, and skips blank and broken lines", async () => {
    expect(await collect(['{"a":1}\r\n', "\n", "not json\n", '{"b":', "2}"])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    const values: unknown[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(sink) {
        sink.enqueue(new TextEncoder().encode('{"a":1}\n'));
      },
    });
    const reading = readNdjson(stream, (value) => values.push(value), controller.signal);
    await expect.poll(() => values).toEqual([{ a: 1 }]);
    controller.abort();
    await expect(reading).rejects.toThrow();
  });

  it("drops a line that never ends instead of keeping it all", async () => {
    const huge = "x".repeat(70 * 1024);
    expect(await collect([`{"a":"${huge}`, `${huge}"}\n`, '{"b":2}\n'])).toEqual([{ b: 2 }]);
  });
});
