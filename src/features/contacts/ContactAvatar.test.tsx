import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactRecord } from "@/backend/types";
import { useSettings } from "@/state/settings";
import { ContactAvatar } from "./ContactAvatar";

const fake = {
  contactPhotoUrl: vi.fn((photo: string) =>
    photo.startsWith("data:") ? photo : `/jmap/image/acc?url=${encodeURIComponent(photo)}`,
  ),
  getSenderPicture: vi.fn(async () => null),
};

vi.mock("@/backend/backend", async (original) => ({
  ...(await original<typeof import("@/backend/backend")>()),
  backend: () => fake,
}));

const card = (photo: string): ContactRecord => ({
  id: "k1",
  accountId: "acc",
  addressBookId: "b1",
  displayName: "Mia Sommer",
  given: "Mia",
  surname: "Sommer",
  organization: "",
  title: "",
  emails: [{ id: "e1", address: "mia@example.org", kind: "home" }],
  phones: [],
  addresses: [],
  birthday: null,
  note: "",
  photo,
  isGroup: false,
});

function renderAvatar(photo: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactAvatar contact={card(photo)} />
    </QueryClientProvider>,
  );
}

describe("a contact's picture", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    useSettings.setState({ senderPictures: true });
  });

  it("shows a linked photo through the server while sender pictures are on", () => {
    useSettings.setState({ senderPictures: true });
    const { container } = renderAvatar("https://photos.example.org/mia.jpg");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/jmap/image/acc?url=https%3A%2F%2Fphotos.example.org%2Fmia.jpg",
    );
  });

  it("doesn't have the server fetch a linked photo while sender pictures are off (W-31)", () => {
    useSettings.setState({ senderPictures: false });
    const { container } = renderAvatar("https://photos.example.org/mia.jpg");
    expect(fake.contactPhotoUrl).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    // What the server has itself is still asked for.
    expect(fake.getSenderPicture).toHaveBeenCalledWith("mia@example.org", { local: true, fresh: false });
  });

  it("always shows a picture inside the card", () => {
    useSettings.setState({ senderPictures: false });
    const { container } = renderAvatar("data:image/jpeg;base64,/9j/4AAQ");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,/9j/4AAQ");
  });
});
