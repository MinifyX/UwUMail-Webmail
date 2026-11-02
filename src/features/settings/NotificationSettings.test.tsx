import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n";
import { queryKeys } from "@/lib/queries";
import { DEFAULT_SETTINGS, useSettings } from "@/state/settings";
import { NotificationSettings } from "./NotificationSettings";
import { cleanTemplateHtml } from "./Templates";

function shown() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.accounts, [{ id: "a1", email: "mini@example.org", protocol: "jmap" }]);
  client.setQueryData(queryKeys.sharedAccounts, [
    { id: "a3", email: "Support@example.org", name: "Support", readOnly: false },
  ]);
  return render(
    <QueryClientProvider client={client}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
}

describe("notification settings", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(() => {
    cleanup();
    useSettings.setState({ notifyMuted: [], quietHours: DEFAULT_SETTINGS.quietHours });
  });

  it("mutes a mailbox by its address, the shared ones too", () => {
    shown();
    fireEvent.click(screen.getByRole("switch", { name: /Support/ }));
    expect(useSettings.getState().notifyMuted).toEqual(["support@example.org"]);
    fireEvent.click(screen.getByRole("switch", { name: /mini@example\.org/ }));
    expect(useSettings.getState().notifyMuted).toEqual(["support@example.org", "mini@example.org"]);
    fireEvent.click(screen.getByRole("switch", { name: /Support/ }));
    expect(useSettings.getState().notifyMuted).toEqual(["mini@example.org"]);
  });

  it("sets quiet hours: times and days", () => {
    useSettings.setState({ quietHours: { enabled: true, from: "22:00", to: "07:00", days: [1, 2] } });
    shown();
    fireEvent.change(screen.getByDisplayValue("22:00"), { target: { value: "23:15" } });
    expect(useSettings.getState().quietHours.from).toBe("23:15");
    const days = screen.getByRole("group").querySelectorAll("button");
    expect(days).toHaveLength(7);
    // Monday first: the last one is Sunday.
    fireEvent.click(days[6]!);
    fireEvent.click(days[0]!);
    expect(useSettings.getState().quietHours.days).toEqual([0, 2]);
  });
});

describe("template markup", () => {
  it("is cleaned like a signature", () => {
    const html = cleanTemplateHtml(
      '<p onclick="x()">Hi {firstName}</p><script>alert(1)</script><img src="https://tracker.example/p.png"><a href="https://example.com">a</a>',
    );
    expect(html).toContain("Hi {firstName}");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/script|onclick|tracker\.example|<img/);
  });
});
