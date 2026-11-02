import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queries";
import { codeForMessages, codeForThread, nextExpiry, useVerificationCodes, type VerificationCode } from "./codes";

const server = vi.hoisted(() => ({ verificationCodes: vi.fn() }));
vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => server,
}));

function code(overrides: Partial<VerificationCode> = {}): VerificationCode {
  return {
    id: "e93",
    emailId: "e93",
    threadId: "t7",
    kind: "otp",
    code: "482913",
    origin: "login.shop.example",
    sender: "Shop Beispiel",
    purpose: "login",
    source: "header",
    autofill: true,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useVerificationCodes(), { wrapper }) };
}

describe("useVerificationCodes", () => {
  afterEach(() => {
    cleanup();
    server.verificationCodes.mockReset();
  });

  it("shows the server's valid codes", async () => {
    server.verificationCodes.mockResolvedValue([code()]);
    const { result } = setup();
    await waitFor(() => expect(result.current.map((entry) => entry.id)).toEqual(["e93"]));
  });

  it("stays empty without the capability", async () => {
    server.verificationCodes.mockResolvedValue(null);
    const { result } = setup();
    await waitFor(() => expect(server.verificationCodes).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("drops a code when it expires and asks the server again", async () => {
    server.verificationCodes
      .mockResolvedValueOnce([code({ expiresAt: new Date(Date.now() + 150).toISOString() })])
      .mockResolvedValue([]);
    const { result } = setup();
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() => expect(result.current).toEqual([]));
    await waitFor(() => expect(server.verificationCodes).toHaveBeenCalledTimes(2));
  });

  it("reloads on an Email state change", async () => {
    server.verificationCodes.mockResolvedValueOnce([]).mockResolvedValue([code({ id: "e94", emailId: "e94" })]);
    const { result, client } = setup();
    await waitFor(() => expect(server.verificationCodes).toHaveBeenCalledTimes(1));
    // What useBackendEvents does on `mail:changed`.
    await client.invalidateQueries({ queryKey: queryKeys.verificationCodes });
    await waitFor(() => expect(result.current.map((entry) => entry.id)).toEqual(["e94"]));
  });
});

describe("matching codes", () => {
  const now = Date.now();

  it("marks a conversation's row, or the mail's with conversations off", () => {
    const codes = [code()];
    expect(codeForThread(codes, "t7", now)?.id).toBe("e93");
    expect(codeForThread(codes, "msg:e93", now)?.id).toBe("e93");
    expect(codeForThread(codes, "t8", now)).toBeUndefined();
    expect(codeForThread([code({ expiresAt: new Date(now - 1).toISOString() })], "t7", now)).toBeUndefined();
  });

  it("prefers the newest mail's own Email.verification in the reader", () => {
    const own = code({ id: "e2", emailId: "e2", code: "111222", expiresAt: new Date(now - 60_000).toISOString() });
    const messages = [{ id: "e1" }, { id: "e2", verification: own }];
    expect(codeForMessages(messages, "t7", [code()])?.code).toBe("111222");
    expect(codeForMessages([{ id: "e93" }], "t9", [code()])?.id).toBe("e93");
    expect(codeForMessages([{ id: "e5" }], "t9", [code()])).toBeUndefined();
  });

  it("knows when the first code runs out", () => {
    const soon = new Date(now + 1000).toISOString();
    expect(nextExpiry([code(), code({ expiresAt: soon })], now)).toBe(Date.parse(soon));
    expect(nextExpiry([code({ expiresAt: new Date(now - 1).toISOString() })], now)).toBeNull();
  });
});
