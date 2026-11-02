import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { useLinks } from "@/state/links";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import {
  clearCopiedCode,
  CLIPBOARD_CLEAR_MS,
  formatCode,
  openableUrl,
  remaining,
  safeUrl,
  type VerificationCode,
} from "./codes";
import { CodeHint, VerificationCodeBar } from "./VerificationCodeBar";

const NOW = Date.parse("2048-03-01T10:00:00Z");

function code(overrides: Partial<VerificationCode> = {}): VerificationCode {
  return {
    id: "c1",
    emailId: "m1",
    kind: "otp",
    code: "482913",
    origin: "login.bank.example",
    sender: "Bank Beispiel",
    purpose: "login",
    source: "header",
    autofill: true,
    expiresAt: new Date(NOW + 90_000).toISOString(),
    ...overrides,
  };
}

describe("verification codes", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("de");
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useToasts.setState({ toasts: [] });
  });

  it("formats codes and countdowns", () => {
    expect(formatCode("482913")).toBe("482 913");
    expect(formatCode("A1B2")).toBe("A1B2");
    expect(remaining(new Date(NOW + 61_000).toISOString(), NOW)).toBe("1:01");
    expect(remaining(new Date(NOW - 5_000).toISOString(), NOW)).toBe("0:00");
  });

  it("renders nothing without codes", () => {
    const { container } = render(<VerificationCodeBar codes={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("counts down and drops a code once it expired", () => {
    const { container } = render(<VerificationCodeBar codes={[code()]} />);
    expect(screen.getByText("noch 1:30")).toBeTruthy();
    act(() => vi.advanceTimersByTime(31_000));
    expect(screen.getByText("noch 0:59").className).toContain("text-warning-ink");
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.innerHTML).toBe("");
  });

  it("marks codes read from the text as not filled in", () => {
    render(<VerificationCodeBar codes={[code({ source: "heuristic", autofill: false })]} />);
    expect(screen.getByText("Absender unbestätigt")).toBeTruthy();
    expect(screen.getByRole("listitem").className).toContain("border-dashed");
  });

  it("offers to open a signed sign-in link through the link checks", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    useSettings.setState({ linkConfirm: false });
    render(
      <VerificationCodeBar
        codes={[
          code({
            kind: "link",
            code: undefined,
            url: "https://forum.example.net/login",
            origin: "forum.example.net",
            autofill: false,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Anmeldelink")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Code kopieren" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    expect(open).toHaveBeenCalledWith("https://forum.example.net/login", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("asks first when links from mail need confirming", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    useSettings.setState({ linkConfirm: true, linkDomains: [] });
    const link = code({
      kind: "link",
      code: undefined,
      url: "https://forum.example.net/l",
      origin: "forum.example.net",
    });
    render(<VerificationCodeBar codes={[link]} />);
    fireEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    expect(open).not.toHaveBeenCalled();
    expect(useLinks.getState().pending?.href).toBe("https://forum.example.net/l");
    useLinks.setState({ pending: null });
    open.mockRestore();
  });

  it("offers no Open for a link read from the text or off the code's origin", () => {
    const link = { kind: "link" as const, code: undefined, origin: "forum.example.net" };
    render(
      <VerificationCodeBar
        codes={[
          code({ ...link, id: "h", url: "https://forum.example.net/l", source: "heuristic" }),
          code({ ...link, id: "o", url: "https://evil.example.com/l" }),
        ]}
      />,
    );
    expect(screen.getAllByText("Anmeldelink")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Öffnen" })).toBeNull();
  });

  it("opens https links on the origin or its subdomains only", () => {
    const origin = "Forum.Example.NET.";
    expect(safeUrl("https://forum.example.net/l", origin)).toBe("https://forum.example.net/l");
    expect(safeUrl("https://login.forum.example.net./l", origin)).toBe("https://login.forum.example.net./l");
    for (const bad of [
      "http://forum.example.net/l",
      "https://user:pw@forum.example.net/l",
      "https://user@forum.example.net/l",
      "https://evilforum.example.net/l",
      "https://forum.example.net.evil.example/l",
      "https://example.net/l",
      "javascript:alert(1)",
      "not a url",
      undefined,
    ]) {
      expect(safeUrl(bad, origin)).toBeNull();
    }
    const signed = code({ kind: "link", url: "https://forum.example.net/l", origin: "forum.example.net" });
    expect(openableUrl(signed)).toBe("https://forum.example.net/l");
    expect(openableUrl({ ...signed, source: "heuristic" })).toBeNull();
    expect(openableUrl({ ...signed, kind: "otp" })).toBeNull();
  });

  it("empties the clipboard after a minute if it still holds the code", async () => {
    let clip = "";
    const writeText = vi.fn(async (value: string) => void (clip = value));
    const readText = vi.fn(async () => clip);
    Object.defineProperty(navigator, "clipboard", { value: { writeText, readText }, configurable: true });
    render(<VerificationCodeBar codes={[code()]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Code kopieren" }));
    });
    expect(clip).toBe("482913");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    });
    expect(clip).toBe("");

    clip = "something else";
    await clearCopiedCode("482913");
    expect(clip).toBe("something else");

    readText.mockRejectedValueOnce(new Error("denied"));
    await expect(clearCopiedCode("482913")).resolves.toBeUndefined();
  });

  it("copies the code to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<VerificationCodeBar codes={[code()]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Code kopieren" }));
    });
    expect(writeText).toHaveBeenCalledWith("482913");
    expect(useToasts.getState().toasts[0]?.message).toBe("Code 482 913 kopiert");
  });

  it("tells in the reader where a code comes from", () => {
    const { rerender } = render(<CodeHint code={code()} />);
    expect(screen.getByRole("note").textContent).toContain("Autofill auf login.bank.example möglich");
    rerender(<CodeHint code={code({ id: "c2", source: "heuristic", autofill: false })} />);
    expect(screen.getByRole("note").textContent).toContain("Herkunft nicht bestätigt");
    rerender(<CodeHint code={code({ id: "c3", expiresAt: new Date(NOW - 1000).toISOString() })} />);
    expect(screen.getByRole("note").textContent).toBe("Dieser Code ist abgelaufen.");
  });
});
