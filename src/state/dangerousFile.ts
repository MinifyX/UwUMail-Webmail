import { create } from "zustand";

interface DangerousFileState {
  /** The open "really download this?" question: the file, and who waits for the answer. */
  pending: { filename: string; answer: (confirmed: boolean) => void } | null;
}

export const useDangerousFile = create<DangerousFileState>()(() => ({ pending: null }));

/**
 * Asks before a file that can run programs is downloaded.
 *
 * The app hands this to the operating system's own dialog. A browser has no
 * such dialog, so the webmail asks itself — the warning was a deliberate
 * decision and shouldn't quietly disappear just because this is a web page.
 */
export function confirmDangerousFile(filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    // A question still open counts as "no"; only the newest one is on screen.
    useDangerousFile.getState().pending?.answer(false);
    useDangerousFile.setState({ pending: { filename, answer: resolve } });
  });
}

export function answerDangerousFile(confirmed: boolean) {
  const { pending } = useDangerousFile.getState();
  if (!pending) return;
  useDangerousFile.setState({ pending: null });
  pending.answer(confirmed);
}
