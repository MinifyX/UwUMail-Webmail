import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShipmentsSupport } from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { ShipmentsSetting } from "./ShipmentsSetting";

let support: ShipmentsSupport = { offered: true, enabled: true };

const fake = {
  kind: "jmap",
  shipmentsSupport: vi.fn(async () => ({ ...support })),
  setShipmentsEnabled: vi.fn(async (on: boolean) => {
    support = { ...support, enabled: on };
  }),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderSetting() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShipmentsSetting />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.findByRole("switch", { name: /Parcel detection/ });

describe("parcel detection setting", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    support = { offered: true, enabled: true };
  });
  afterEach(cleanup);

  it("isn't there when the admin switched parcels off", async () => {
    support = { offered: false, enabled: false };
    renderSetting();
    await waitFor(() => expect(fake.shipmentsSupport).toHaveBeenCalled());
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("asks before switching off, and only deletes once confirmed", async () => {
    renderSetting();
    fireEvent.click(await toggle());
    expect(await screen.findByText("Switch off parcel detection?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fake.setShipmentsEnabled).not.toHaveBeenCalled();

    fireEvent.click(await toggle());
    fireEvent.click(await screen.findByRole("button", { name: "Switch off and delete" }));
    await waitFor(() => expect(fake.setShipmentsEnabled).toHaveBeenCalledWith(false));
    await waitFor(async () => expect((await toggle()).getAttribute("aria-checked")).toBe("false"));
  });

  it("switches back on without asking", async () => {
    support = { offered: true, enabled: false };
    renderSetting();
    fireEvent.click(await toggle());
    await waitFor(() => expect(fake.setShipmentsEnabled).toHaveBeenCalledWith(true));
    expect(screen.queryByText("Switch off parcel detection?")).toBeNull();
  });
});
