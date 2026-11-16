import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@/backend/backend";
import type { ShipmentNotRefreshed } from "@/backend/types";
import { i18n } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import { useShipmentActions } from "./useShipments";

const fake = { kind: "jmap", refreshShipment: vi.fn(async (): Promise<ShipmentNotRefreshed | null> => null) };

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useShipmentActions(), { wrapper });
  return { lookUp: (id: string) => act(() => result.current.lookUp(id)), invalidate };
}

const lastToast = () => useToasts.getState().toasts.at(-1);

describe("asking the carrier now", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => useToasts.setState({ toasts: [] }));

  it("reloads the parcels and says it asked", async () => {
    const { lookUp, invalidate } = setup();
    await lookUp("s7");
    expect(fake.refreshShipment).toHaveBeenCalledWith("s7");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.shipments });
    expect(lastToast()).toMatchObject({ message: "Asked the carrier", tone: "success" });
  });

  it.each([
    ["tooSoon", /Just asked/],
    ["notSupported", /doesn't ask the carrier/],
    ["unavailable", /isn't answering/],
    ["notFound", /doesn't know this tracking number/],
  ] as const)("says why it didn't ask (%s), and still reloads", async (why, text) => {
    fake.refreshShipment.mockResolvedValueOnce(why);
    const { lookUp, invalidate } = setup();
    await lookUp("s8");
    expect(invalidate).toHaveBeenCalled();
    expect(lastToast()?.tone).toBe("info");
    expect(lastToast()?.message).toMatch(text);
  });

  it("shows a failed call as an error", async () => {
    fake.refreshShipment.mockRejectedValueOnce(new BackendError("connection_failed", "offline"));
    const { lookUp } = setup();
    await lookUp("s9");
    expect(lastToast()).toMatchObject({
      message: "No connection to the server. Try again in a moment.",
      tone: "error",
    });
  });
});
