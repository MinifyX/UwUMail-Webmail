import { describe, expect, it } from "vitest";
import { suggestionLimit, suggestionsToContacts } from "./suggest";

describe("address suggestions from the server", () => {
  it("keep the server's order, names and last use", () => {
    const contacts = suggestionsToContacts([
      {
        email: "nyu.katze@cats.example",
        name: "Nyu Katze",
        source: "contact",
        sources: ["contact", "sent"],
        lastUsedAt: "2026-09-20T08:12:00Z",
      },
      { email: "kai@paws.example", name: null, source: "sent", sources: ["sent"], lastUsedAt: null },
    ]);
    expect(contacts).toEqual([
      { email: "nyu.katze@cats.example", name: "Nyu Katze", lastUsed: "2026-09-20T08:12:00Z", timesContacted: 0 },
      { email: "kai@paws.example", timesContacted: 0 },
    ]);
  });

  it("skip doubles and what isn't an address", () => {
    const contacts = suggestionsToContacts([
      { email: "kai@paws.example" },
      { email: "KAI@paws.example", name: "Kai" },
      { email: "not an address" },
    ]);
    expect(contacts.map((contact) => contact.email)).toEqual(["kai@paws.example"]);
  });

  it("ask for no more than the server allows", () => {
    expect(suggestionLimit(8, { maxLimit: 50 })).toBe(8);
    expect(suggestionLimit(8, { maxLimit: 5 })).toBe(5);
    expect(suggestionLimit(8, null)).toBe(8);
  });
});
