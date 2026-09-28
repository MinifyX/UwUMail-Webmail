import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SenderPicture, SenderPictureLookup } from "@/backend/types";
import { refreshSenderPictures } from "@/lib/queries";
import { useSettings } from "@/state/settings";
import { Avatar } from "./Avatar";

const fake = {
  getSenderPicture: vi.fn(async (email: string, _lookup?: SenderPictureLookup): Promise<SenderPicture | null> =>
    email === "mina@example.org" ? { url: "blob:mina", kind: "photo" } : null,
  ),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

function renderAvatars(client: QueryClient, emails: string[]) {
  return render(
    <QueryClientProvider client={client}>
      {emails.map((email, index) => (
        <Avatar key={index} address={{ email }} />
      ))}
    </QueryClientProvider>,
  );
}

describe("sender pictures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettings.setState({ senderPictures: true });
  });
  afterEach(() => cleanup());

  it("asks once per address, whatever its case, and lets a person's photo fill the circle", async () => {
    const client = new QueryClient();
    const { container } = renderAvatars(client, [
      "Mina@Example.org",
      "mina@example.org",
      " mina@example.org",
      "kai@example.net",
      "not an address",
    ]);
    await waitFor(() => expect(fake.getSenderPicture).toHaveBeenCalledTimes(2));
    expect(fake.getSenderPicture.mock.calls.map(([email, lookup]) => [email, lookup?.local])).toEqual([
      ["mina@example.org", false],
      ["kai@example.net", false],
    ]);
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(3));
    const pictures = container.querySelectorAll("img");
    for (const picture of pictures) expect(picture.className).toContain("object-cover");
  });

  it("only asks for what the server has itself while sender pictures are off", async () => {
    useSettings.setState({ senderPictures: false });
    renderAvatars(new QueryClient(), ["mina@example.org"]);
    await waitFor(() => expect(fake.getSenderPicture).toHaveBeenCalledTimes(1));
    expect(fake.getSenderPicture).toHaveBeenCalledWith("mina@example.org", { local: true, fresh: false });
  });

  it("asks the server again, past the browser's copy, once pictures changed", async () => {
    const client = new QueryClient();
    renderAvatars(client, ["mina@example.org"]);
    await waitFor(() => expect(fake.getSenderPicture).toHaveBeenCalledTimes(1));
    await act(() => refreshSenderPictures(client));
    await waitFor(() => expect(fake.getSenderPicture).toHaveBeenCalledTimes(2));
    expect(fake.getSenderPicture).toHaveBeenLastCalledWith("mina@example.org", { local: false, fresh: true });
  });
});
