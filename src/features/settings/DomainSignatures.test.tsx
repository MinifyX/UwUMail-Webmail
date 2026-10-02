import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainSignatureChange, DomainSignatureOverview } from "@/lib/domainSignatures";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { useToasts } from "@/state/toasts";
import { Signatures } from "./Signatures";

let overview: DomainSignatureOverview | null = null;

const sample = (): DomainSignatureOverview => ({
  state: "3",
  allDomains: null,
  domains: [
    {
      domain: "example.net",
      addressCount: 1,
      signature: { text: "Net", html: "<p>Net</p>" },
      company: null,
      source: "domain",
    },
    {
      domain: "example.org",
      addressCount: 2,
      signature: null,
      company: { mode: "footer", text: "Beispiel GmbH · {name}", html: "" },
      source: "none",
    },
  ],
  identities: [
    {
      id: "i1",
      name: "Mini",
      email: "mini@example.net",
      domain: "example.net",
      signature: null,
      effective: { text: "Net", html: "<p>Net</p>" },
      source: "domain",
    },
    {
      id: "i2",
      name: "Mini",
      email: "mini@example.org",
      domain: "example.org",
      signature: null,
      effective: { text: "", html: "" },
      source: "none",
    },
    {
      id: "i3",
      name: "Info",
      email: "info@example.org",
      domain: "example.org",
      signature: { text: "Info", html: "" },
      effective: { text: "Info", html: "" },
      source: "identity",
    },
  ],
});

const fake = {
  kind: "jmap",
  signatureStore: vi.fn(async () => "identity" as const),
  domainSignatures: vi.fn(async () => overview),
  saveDomainSignatures: vi.fn(async (_change: DomainSignatureChange) => overview!),
  listIdentities: vi.fn(async () => []),
  listSignatures: vi.fn(async () => []),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Signatures />
    </QueryClientProvider>,
  );
}

/** Types into the first rich editor on the page, as the composer's cleaner sees it. */
function write(html: string, index = 0) {
  const editor = screen.getAllByRole("textbox", { name: "Signatures" })[index]!;
  editor.innerHTML = html;
}

describe("signatures per domain", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
    useSettings.getState().update({ tone: "neutral" });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    overview = sample();
  });
  afterEach(() => {
    cleanup();
    act(() => useToasts.setState({ toasts: [] }));
  });

  it("picks a domain with its address count and saves one signature for it", async () => {
    renderPage();
    const select = (await screen.findByRole("combobox", { name: "Domain" })) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "example.net (1 address)",
      "example.org (2 addresses)",
    ]);
    fireEvent.change(select, { target: { value: "example.org" } });
    // The company footer of the domain, with the placeholders filled for its first address.
    expect(await screen.findByText("Beispiel GmbH · Mini")).toBeTruthy();
    expect(screen.getByText("Different signature for single addresses (1)")).toBeTruthy();

    write("<p>Gruß, {name}</p>");
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(fake.saveDomainSignatures).toHaveBeenCalled());
    expect(fake.saveDomainSignatures.mock.calls[0]![0]).toEqual({
      domains: { "example.org": { text: "Gruß, {name}", html: "<p>Gruß, {name}</p>" } },
    });
  });

  it("applies one signature to all domains, replacing the domains' own", async () => {
    renderPage();
    await screen.findByRole("combobox", { name: "Domain" });
    fireEvent.click(screen.getByRole("checkbox", { name: "All domains (including future ones)" }));
    write("<p>Für alle</p>");
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(fake.saveDomainSignatures).toHaveBeenCalled());
    expect(fake.saveDomainSignatures.mock.calls[0]![0]).toEqual({
      domains: { "*": { text: "Für alle", html: "<p>Für alle</p>" }, "example.net": null },
    });
  });

  it("lets a single address differ and go back to the domain's", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("combobox", { name: "Domain" }), { target: { value: "example.org" } });
    fireEvent.click(await screen.findByRole("button", { name: "Own signature for this address" }));
    // Editors: the domain's, Mini's new one, Info's own.
    write("<p>Nur Mini</p>", 1);
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(fake.saveDomainSignatures).toHaveBeenCalled());
    expect(fake.saveDomainSignatures.mock.calls[0]![0]).toEqual({
      identities: { i2: { text: "Nur Mini", html: "<p>Nur Mini</p>" } },
    });
    fake.saveDomainSignatures.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Use the domain signature" }).at(-1)!);
    await waitFor(() => expect(fake.saveDomainSignatures).toHaveBeenCalledWith({ identities: { i3: null } }));
  });

  it("keeps the signatures per address on servers without domains", async () => {
    overview = null;
    renderPage();
    expect(await screen.findByText(/One per sender address/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Domain" })).toBeNull();
  });
});
