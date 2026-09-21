import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutgoingMessage } from "@/backend/types";
import { SendQueue, type UnloadTarget } from "./sendQueue";

const message: OutgoingMessage = {
  accountId: "acc",
  to: [{ email: "leni@example.org" }],
  cc: [],
  bcc: [],
  subject: "Hallo",
  html: "<p>Hi</p>",
  text: "Hi",
  attachments: [],
  draftKey: "uwu-1@webmail.local",
};

function fakeWindow() {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const target: UnloadTarget = {
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener),
  } as UnloadTarget;
  return { target, listeners };
}

describe("SendQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits only once the delay is over", async () => {
    const done = vi.fn();
    const submit = vi.fn(() => Promise.resolve());
    const queue = new SendQueue({ done, failed: vi.fn() }, null);
    const queued = queue.add(message, 10, submit);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(queued.id, message);
    expect(queue.pending).toBe(0);
  });

  it("hands the mail back when undone in time, and never submits it", async () => {
    const submit = vi.fn(() => Promise.resolve());
    const queue = new SendQueue({ done: vi.fn(), failed: vi.fn() }, null);
    const queued = queue.add(message, 5, submit);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(queue.cancel(queued.id)).toBe(message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(submit).not.toHaveBeenCalled();
    expect(queue.pending).toBe(0);
  });

  it("is too late to undo once the time is up", async () => {
    let finish = () => {};
    const submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const queue = new SendQueue({ done: vi.fn(), failed: vi.fn() }, null);
    const queued = queue.add(message, 5, submit);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(() => queue.cancel(queued.id)).toThrow();
    // Still on its way: it counts as pending until the server answered.
    expect(queue.pending).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.pending).toBe(0);
  });

  it("reports a failed submission with the mail, so it can be opened again", async () => {
    const failed = vi.fn();
    const queue = new SendQueue({ done: vi.fn(), failed }, null);
    const queued = queue.add(message, 5, () => Promise.reject(new Error("The mailbox is full.")));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed).toHaveBeenCalledWith(queued.id, message, "The mailbox is full.");
  });

  it("asks before the page closes only while something is pending", async () => {
    const { target, listeners } = fakeWindow();
    const queue = new SendQueue({ done: vi.fn(), failed: vi.fn() }, target);

    const first = queue.add(message, 10, () => Promise.resolve());
    queue.add(message, 20, () => Promise.resolve());
    expect(listeners.size).toBe(1);

    queue.cancel(first.id);
    expect(listeners.size).toBe(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(listeners.size).toBe(0);

    const event = new Event("beforeunload", { cancelable: true });
    queue.add(message, 5, () => Promise.resolve());
    for (const listener of listeners) (listener as EventListener)(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("gives each queued mail its own id and send time", () => {
    vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
    const queue = new SendQueue({ done: vi.fn(), failed: vi.fn() }, null);
    const a = queue.add(message, 10, () => Promise.resolve());
    const b = queue.add(message, 30, () => Promise.resolve());
    expect(a.id).not.toBe(b.id);
    expect(a.sendAt).toBe("2026-09-21T10:00:10.000Z");
    expect(b.sendAt).toBe("2026-09-21T10:00:30.000Z");
  });
});
