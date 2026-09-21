import type { OutgoingMessage, QueuedSend } from "@/backend/types";

/**
 * "Undo send" in the browser.
 *
 * The server sends a mail the moment it is submitted, so holding one back for a few seconds
 * happens here: the mail waits as a draft in the Drafts folder, and only when the time is up does
 * the page submit it. Closing the tab before that means it is never sent, but the draft stays;
 * the page asks before it closes while anything is still waiting or on its way.
 */

export interface SendQueueEvents {
  done: (sendId: string, message: OutgoingMessage) => void;
  failed: (sendId: string, message: OutgoingMessage, reason: string) => void;
}

/** Where the "leave the page?" question hooks in; the window, or nothing outside a browser. */
export type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">;

interface Waiting {
  message: OutgoingMessage;
  timer: ReturnType<typeof setTimeout>;
}

export class SendQueue {
  private waiting = new Map<string, Waiting>();
  /** Submissions that already left the queue but haven't answered yet. */
  private inFlight = 0;
  private nextId = 1;
  private guarded = false;
  private readonly warn = (event: Event) => {
    // The browser shows its own "leave site?" question; the text can't be chosen any more.
    event.preventDefault();
  };

  constructor(
    private readonly events: SendQueueEvents,
    private readonly unload: UnloadTarget | null = typeof window === "undefined" ? null : window,
  ) {}

  /**
   * Runs `submit` after `delaySeconds`, unless `cancel` comes first. The result arrives through
   * `events`. `message` is what `cancel` hands back, so it should carry the draft key.
   */
  add(message: OutgoingMessage, delaySeconds: number, submit: () => Promise<void>): QueuedSend {
    const id = `send-${this.nextId++}`;
    const delay = Math.max(0, delaySeconds) * 1000;
    const timer = setTimeout(() => {
      // From here on it can't be taken back: the request may already be on the wire.
      this.waiting.delete(id);
      this.inFlight += 1;
      void submit()
        .then(
          () => this.events.done(id, message),
          (reason: unknown) =>
            this.events.failed(id, message, reason instanceof Error ? reason.message : String(reason)),
        )
        .finally(() => {
          this.inFlight -= 1;
          this.updateGuard();
        });
    }, delay);
    this.waiting.set(id, { message, timer });
    this.updateGuard();
    return { id, sendAt: new Date(Date.now() + delay).toISOString() };
  }

  /** Takes a waiting mail back. Throws once it has gone to the server. */
  cancel(sendId: string): OutgoingMessage {
    const entry = this.waiting.get(sendId);
    if (!entry) throw new Error("This mail is already on its way.");
    clearTimeout(entry.timer);
    this.waiting.delete(sendId);
    this.updateGuard();
    return entry.message;
  }

  /** Mails still waiting or being submitted. */
  get pending(): number {
    return this.waiting.size + this.inFlight;
  }

  private updateGuard(): void {
    const want = this.pending > 0;
    if (!this.unload || want === this.guarded) return;
    if (want) this.unload.addEventListener("beforeunload", this.warn);
    else this.unload.removeEventListener("beforeunload", this.warn);
    this.guarded = want;
  }
}
