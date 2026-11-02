import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { useToasts } from "@/state/toasts";
import { formatCode, remaining, type VerificationCode } from "./codes";
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

  it("offers to open a sign-in link instead of copying", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <VerificationCodeBar
        codes={[code({ kind: "link", code: undefined, url: "https://forum.example.net/login", autofill: false })]}
      />,
    );
    expect(screen.getByText("Anmeldelink")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Code kopieren" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    expect(open).toHaveBeenCalledWith("https://forum.example.net/login", "_blank", "noopener,noreferrer");
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
