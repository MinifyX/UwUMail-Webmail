import "@/test/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistEstimate, AssistUsage } from "@/backend/types";
import { i18n } from "@/i18n";
import { useSettings } from "@/state/settings";
import { assistCurrency, formatCost, mayChooseCurrency } from "./cost";
import { EstimateTip } from "./Estimate";
import { parsePrice, providerUpdateInput, providerFormFrom } from "./providerForm";
import { CurrencySetting } from "./settings/AssistantSettings";
import { UsageSettings } from "./settings/UsageSettings";

const ESTIMATE: AssistEstimate = {
  method: "Assist/spamCheck",
  inputTokens: 1100,
  outputTokens: 134,
  totalTokens: 1234,
  providerId: "q1",
  providerName: "Mistral (Server)",
  model: "mistral-small-latest",
  tokensLeftToday: 48000,
  requestsLeftToday: null,
  cost: { amount: 0.0213, currency: "EUR", usd: 0.0248 },
};

const today = new Date().toISOString().slice(0, 10);
const USAGE: AssistUsage = {
  days: [
    {
      day: today,
      providerId: "q1",
      providerName: "Mistral (Server)",
      feature: "summarize",
      requests: 3,
      inputTokens: 3000,
      outputTokens: 300,
      cost: { amount: 1.5, currency: "EUR", usd: 1.74 },
    },
    {
      day: today,
      providerId: "q2",
      providerName: "Own",
      feature: "compose",
      requests: 1,
      inputTokens: 100,
      outputTokens: 100,
      // An older row, from before prices.
      cost: null,
    },
  ],
  today: [
    {
      providerId: "q1",
      providerName: "Mistral (Server)",
      requests: 3,
      tokens: 3300,
      requestsPerDay: null,
      tokensPerDay: null,
      cost: { amount: 1.5, currency: "EUR", usd: 1.74 },
    },
  ],
};

const fake = {
  assistOptions: vi.fn(async () => ({ features: {} })),
  assistEstimate: vi.fn(async () => ESTIMATE),
  assistUsage: vi.fn(async () => USAGE),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ...options, ns: "neutral" });

beforeAll(() => useSettings.getState().update({ tone: "neutral" }));
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  useSettings.getState().update({ assistCurrency: "EUR" });
});
afterEach(() => cleanup());

describe("the currency", () => {
  it("follows the language: yen, yuan, and in English euros or dollars as chosen", () => {
    expect(assistCurrency("ja", "USD")).toBe("JPY");
    expect(assistCurrency("zh-CN", "EUR")).toBe("CNY");
    expect(assistCurrency("de", "USD")).toBe("EUR");
    expect(assistCurrency("en-GB", "USD")).toBe("USD");
    expect(assistCurrency("en", "EUR")).toBe("EUR");
    expect(mayChooseCurrency("en-US")).toBe(true);
    expect(mayChooseCurrency("fr")).toBe(false);
  });
});

describe("formatCost", () => {
  it("writes small amounts with enough digits and tiny ones as below a floor", () => {
    expect(formatCost({ amount: 0.0213, currency: "EUR" }, "en", t, true)).toBe("≈ €0.021");
    expect(formatCost({ amount: 0.0023, currency: "EUR" }, "de", t)).toMatch(/^0,0023\s€$/);
    expect(formatCost({ amount: 0.00001, currency: "USD" }, "en", t)).toBe("< $0.0001");
    expect(formatCost({ amount: 12.345, currency: "USD" }, "en", t)).toBe("$12.35");
    expect(formatCost({ amount: 3.4, currency: "JPY" }, "ja", t)).toBe("￥3");
    expect(formatCost({ amount: 0, currency: "EUR" }, "en", t)).toBe("free");
  });
});

describe("costs in the UI", () => {
  it("puts the cost into the tooltip, asked in the person's currency", async () => {
    useSettings.getState().update({ assistCurrency: "USD" });
    renderWith(
      <EstimateTip request={{ method: "Assist/spamCheck", emailId: "e1" }}>
        <button type="button">Check</button>
      </EstimateTip>,
    );
    fireEvent.pointerOver(screen.getByRole("button"), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("≈ 1,200 tokens · ≈ €0.021 · 48,000 left today");
    expect(fake.assistEstimate).toHaveBeenCalledWith({ method: "Assist/spamCheck", emailId: "e1" }, "USD");
  });

  it("leaves the cost out where the server gives none", async () => {
    fake.assistEstimate.mockResolvedValueOnce({ ...ESTIMATE, cost: null });
    renderWith(
      <EstimateTip request={{ method: "Assist/spamCheck", emailId: "e2" }}>
        <button type="button">Check</button>
      </EstimateTip>,
    );
    fireEvent.pointerOver(screen.getByRole("button"), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("≈ 1,200 tokens · 48,000 left today");
  });

  it("shows what was spent today, per feature and over the month", async () => {
    renderWith(<UsageSettings />);
    expect(await screen.findByText(/1 request · 200 tokens$/)).toBeTruthy();
    // Today's provider and the summaries' feature row.
    expect(screen.getAllByText(/3 requests · 3.3K tokens · €1.50$/)).toHaveLength(2);
    // The month: what had no price adds nothing.
    expect(screen.getByText(/4 requests · 3.5K tokens · €1.50$/)).toBeTruthy();
    expect(fake.assistUsage).toHaveBeenCalledWith(30, "EUR");
  });

  it("offers the currency only in English", async () => {
    const { unmount } = renderWith(<CurrencySetting />);
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    expect(useSettings.getState().assistCurrency).toBe("USD");
    unmount();
    await i18n.changeLanguage("de");
    renderWith(<CurrencySetting />);
    expect(screen.queryByLabelText("Währung")).toBeNull();
  });
});

describe("prices in the provider form", () => {
  it("reads either decimal mark and sends only a changed price", () => {
    expect(parsePrice("0,40")).toBe(0.4);
    expect(parsePrice(" ")).toBeNull();
    expect(parsePrice("1e3")).toBeNaN();
    const provider = {
      id: "q9",
      name: "Mine",
      kind: "openai" as const,
      scope: "personal" as const,
      baseUrl: null,
      hasKey: true,
      keyHint: "…1234",
      model: null,
      fastModel: null,
      features: [],
      quota: null,
      experimental: false,
      connected: true,
      inputPricePerMillion: 0.4,
      outputPricePerMillion: null,
    };
    const form = providerFormFrom(provider);
    expect(form.inputPrice).toBe("0.4");
    expect(providerUpdateInput(provider, form)).toEqual({});
    expect(providerUpdateInput(provider, { ...form, inputPrice: "", outputPrice: "3" })).toEqual({
      inputPricePerMillion: null,
      outputPricePerMillion: 3,
    });
  });
});
