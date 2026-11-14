import { create } from "zustand";

export type ToastTone = "info" | "success" | "error";

/** A little flourish on top of the message. "sent" lets Nyu fly off with the mail. */
export type ToastEffect = "sent";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds until it goes away by itself. */
  duration?: number;
  /** Counts the seconds down to this time (ISO 8601), e.g. until a held-back mail goes. */
  countdownTo?: string;
  /** Runs when it went away by itself, not when it was closed or its action was used. */
  onTimeout?: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  effect?: ToastEffect;
  action?: ToastAction;
  countdownTo?: string;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone, effect?: ToastEffect, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  /** Holds a toast while the pointer or focus is on it; `resume` gives it its full time again. */
  pause: (id: number) => void;
  resume: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, { start: () => void; handle?: ReturnType<typeof setTimeout> }>();

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, tone = "info", effect, options = {}) => {
    const id = nextId++;
    const { action, countdownTo, onTimeout } = options;
    set({ toasts: [...get().toasts.slice(-3), { id, message, tone, effect, action, countdownTo }] });
    const timer: { start: () => void; handle?: ReturnType<typeof setTimeout> } = {
      start: () => {
        timer.handle = setTimeout(
          () => {
            const still = get().toasts.some((item) => item.id === id);
            get().dismiss(id);
            if (still) onTimeout?.();
          },
          options.duration ?? (tone === "error" ? 7000 : 3500),
        );
      },
    };
    timers.set(id, timer);
    timer.start();
    return id;
  },
  dismiss: (id) => {
    clearTimeout(timers.get(id)?.handle);
    timers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  pause: (id) => {
    // A countdown runs on the server's clock (the held-back mail goes anyway), so it is not held.
    if (get().toasts.some((t) => t.id === id && t.countdownTo)) return;
    clearTimeout(timers.get(id)?.handle);
  },
  resume: (id) => {
    const timer = timers.get(id);
    if (!timer || get().toasts.some((t) => t.id === id && t.countdownTo)) return;
    clearTimeout(timer.handle);
    timer.start();
  },
}));

/** Shows a toast and returns its id, e.g. to dismiss it early. */
export const toast = (message: string, tone?: ToastTone, effect?: ToastEffect, options?: ToastOptions) =>
  useToasts.getState().show(message, tone, effect, options);
