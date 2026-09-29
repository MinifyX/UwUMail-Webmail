import { describe, expect, it } from "vitest";
import type { ContactInput } from "../types";
import {
  cardFromInput,
  contactPhotoSource,
  contactSuggestions,
  patchFromInput,
  toAddressBookInfo,
  toContactRecord,
  type JmapCard,
} from "./contacts";

const card = (patch: Partial<JmapCard> = {}): JmapCard => ({
  id: "k1",
  addressBookIds: { b1: true },
  kind: "individual",
  name: {
    components: [
      { kind: "given", value: "Mina" },
      { kind: "surname", value: "Sommer" },
    ],
    full: "Mina Sommer",
  },
  emails: {
    e1: { address: "mina@example.org", contexts: { private: true }, pref: 1, label: "kept" },
  },
  phones: {
    p1: { number: "+49 30 5550123", features: { mobile: true, voice: true } },
  },
  organizations: { o1: { name: "Nyu & Co" } },
  ...patch,
});

const input = (patch: Partial<ContactInput> = {}): ContactInput => ({
  ...inputOf(card()),
  ...patch,
});

function inputOf(from: JmapCard): ContactInput {
  const record = toContactRecord(from, "a");
  return {
    addressBookId: record.addressBookId,
    given: record.given,
    surname: record.surname,
    organization: record.organization,
    title: record.title,
    emails: record.emails,
    phones: record.phones,
    addresses: record.addresses,
    birthday: record.birthday,
    birthdayChanged: false,
    note: record.note,
  };
}

describe("reading cards", () => {
  it("reads the parts the view shows", () => {
    const record = toContactRecord(
      card({
        titles: { t1: { name: "Baker" } },
        notes: { n1: { note: "Likes rye" } },
        addresses: {
          a1: {
            contexts: { work: true },
            components: [
              { kind: "name", value: "Musterweg" },
              { kind: "separator", value: " " },
              { kind: "number", value: "5" },
              { kind: "postcode", value: "12345" },
              { kind: "locality", value: "Musterstadt" },
              { kind: "country", value: "Germany" },
            ],
          },
        },
        anniversaries: { b1: { kind: "birth", date: { "@type": "PartialDate", year: 1996, month: 4, day: 12 } } },
      }),
      "a",
    );
    expect(record).toMatchObject({
      id: "k1",
      accountId: "a",
      addressBookId: "b1",
      displayName: "Mina Sommer",
      given: "Mina",
      surname: "Sommer",
      organization: "Nyu & Co",
      title: "Baker",
      note: "Likes rye",
      birthday: "1996-04-12",
      emails: [{ id: "e1", address: "mina@example.org", kind: "home" }],
      phones: [{ id: "p1", number: "+49 30 5550123", kind: "mobile" }],
      addresses: [
        {
          id: "a1",
          street: "Musterweg 5",
          postcode: "12345",
          locality: "Musterstadt",
          country: "Germany",
          kind: "work",
        },
      ],
      isGroup: false,
    });
  });

  it("splits a full name without parts at its last space", () => {
    const record = toContactRecord(card({ name: { full: "Anna Lena Beispiel" } }), "a");
    expect([record.given, record.surname]).toEqual(["Anna Lena", "Beispiel"]);
  });

  it("names a contact without a name by its company, then its address", () => {
    expect(toContactRecord(card({ name: undefined }), "a").displayName).toBe("Nyu & Co");
    expect(toContactRecord(card({ name: undefined, organizations: undefined }), "a").displayName).toBe(
      "mina@example.org",
    );
  });

  it("reads a birthday without a year", () => {
    const record = toContactRecord(
      card({ anniversaries: { x: { kind: "birth", date: { "@type": "PartialDate", month: 9, day: 30 } } } }),
      "a",
    );
    expect(record.birthday).toBe("--09-30");
  });

  it("reads photos inside the card and web links, nothing else", () => {
    const inside = "data:image/png;base64,iVBORw0KGgo=";
    const photoOf = (uri: string) => toContactRecord(card({ media: { m1: { kind: "photo", uri } } }), "a").photo;
    expect(photoOf(inside)).toBe(inside);
    expect(photoOf("https://photos.example/me.png")).toBe("https://photos.example/me.png");
    expect(photoOf("http://photos.example/me.png")).toBeNull();
    expect(photoOf("cid:me@example.org")).toBeNull();
    expect(photoOf("javascript:alert(1)")).toBeNull();
    expect(
      toContactRecord(card({ media: { l1: { kind: "logo", uri: inside }, m1: { kind: "photo", uri: "cid:x" } } }), "a")
        .photo,
    ).toBeNull();
  });

  it("shows a linked photo only through the server's proxy, never directly", () => {
    const proxy = (url: string) => `/jmap/image/a1?url=${encodeURIComponent(url)}`;
    const inside = "data:image/jpeg;base64,/9j/4AAQ";
    expect(contactPhotoSource(inside, null)).toBe(inside);
    expect(contactPhotoSource(inside, proxy)).toBe(inside);
    expect(contactPhotoSource("https://photos.example/me.png", proxy)).toBe(
      "/jmap/image/a1?url=https%3A%2F%2Fphotos.example%2Fme.png",
    );
    // Without a proxy, or with one that hands the link back, nothing is shown.
    expect(contactPhotoSource("https://photos.example/me.png", null)).toBeNull();
    expect(contactPhotoSource("https://photos.example/me.png", (url) => url)).toBeNull();
    expect(contactPhotoSource("https://photos.example/me.png", () => "//photos.example/me.png")).toBeNull();
    expect(contactPhotoSource("http://photos.example/me.png", proxy)).toBeNull();
  });

  it("reads address books and their rights", () => {
    expect(
      toAddressBookInfo({ id: "b1", name: "Kontakte", isDefault: true, myRights: { mayDelete: false } }, "a"),
    ).toEqual({ id: "b1", accountId: "a", name: "Kontakte", isDefault: true, sortOrder: 0, mayDelete: false });
  });

  it("suggests one entry per address", () => {
    const cards = [card({ emails: { e1: { address: "mina@example.org" }, e2: { address: "sommer@example.com" } } })];
    expect(contactSuggestions(cards, "a").map((c) => [c.name, c.email])).toEqual([
      ["Mina Sommer", "mina@example.org"],
      ["Mina Sommer", "sommer@example.com"],
    ]);
  });
});

describe("writing cards", () => {
  it("makes a new card with a full name vCard can use", () => {
    const created = cardFromInput({
      ...input(),
      emails: [
        { id: "", address: " neu@example.org ", kind: "work" },
        { id: "", address: "", kind: "other" },
      ],
      phones: [],
      birthday: "--09-30",
    });
    expect(created).toMatchObject({
      "@type": "Card",
      addressBookIds: { b1: true },
      name: { full: "Mina Sommer" },
      organizations: { o1: { name: "Nyu & Co" } },
      emails: { e1: { address: "neu@example.org", contexts: { work: true } } },
      anniversaries: { b1: { kind: "birth", date: { "@type": "PartialDate", month: 9, day: 30 } } },
    });
    expect(created.phones).toBeUndefined();
  });

  it("names a card without a name by its company", () => {
    const created = cardFromInput(input({ given: "", surname: "" }));
    expect(created.name).toEqual({ full: "Nyu & Co" });
  });

  it("sends nothing when nothing changed", () => {
    expect(patchFromInput(card(), input())).toEqual({});
  });

  it("keeps what the editor doesn't show when an entry changes", () => {
    const patch = patchFromInput(card(), input({ emails: [{ id: "e1", address: "mina@example.net", kind: "home" }] }));
    expect(patch).toEqual({
      emails: { e1: { address: "mina@example.net", contexts: { private: true }, pref: 1, label: "kept" } },
    });
  });

  it("keeps other phone features when the kind changes", () => {
    const patch = patchFromInput(card(), input({ phones: [{ id: "p1", number: "+49 30 5550123", kind: "work" }] }));
    expect(patch).toEqual({
      phones: { p1: { number: "+49 30 5550123", features: { voice: true }, contexts: { work: true } } },
    });
  });

  it("changes, removes and adds single entries with patches", () => {
    expect(patchFromInput(card(), input({ organization: "Nyu GmbH" }))).toEqual({
      "organizations/o1/name": "Nyu GmbH",
    });
    expect(patchFromInput(card(), input({ organization: "" }))).toEqual({ "organizations/o1": null });
    expect(patchFromInput(card(), input({ note: "New" }))).toEqual({ notes: { n1: { note: "New" } } });
  });

  it("rebuilds the name and keeps its other parts", () => {
    const withTitle = card({
      name: {
        components: [
          { kind: "title", value: "Dr." },
          { kind: "given", value: "Mina" },
          { kind: "surname", value: "Sommer" },
        ],
        full: "Dr. Mina Sommer",
      },
    });
    expect(patchFromInput(withTitle, input({ surname: "Winter" }))).toEqual({
      name: {
        components: [
          { kind: "title", value: "Dr." },
          { kind: "given", value: "Mina" },
          { kind: "surname", value: "Winter" },
        ],
        full: "Dr. Mina Winter",
      },
    });
  });

  it("changes the birthday only when the editor touched it", () => {
    const born = card({ anniversaries: { x: { kind: "birth", date: { "@type": "PartialDate", month: 1, day: 2 } } } });
    const from = inputOf(born);
    expect(patchFromInput(born, { ...from, birthday: "2000-01-02" })).toEqual({});
    expect(patchFromInput(born, { ...from, birthday: "2000-01-02", birthdayChanged: true })).toEqual({
      "anniversaries/x/date": { "@type": "PartialDate", year: 2000, month: 1, day: 2 },
    });
    expect(patchFromInput(born, { ...from, birthday: null, birthdayChanged: true })).toEqual({
      "anniversaries/x": null,
    });
  });

  it("puts a new card's picture into its media", () => {
    const photo = "data:image/jpeg;base64,/9j/4AAQ";
    expect(cardFromInput(input({ photo })).media).toEqual({
      p1: { kind: "photo", uri: photo, mediaType: "image/jpeg" },
    });
    expect(cardFromInput(input({ photo: null })).media).toBeUndefined();
    expect(cardFromInput(input()).media).toBeUndefined();
  });

  it("replaces the shown photo and keeps the other media", () => {
    const withMedia = card({
      media: {
        logo: { kind: "logo", uri: "https://nyu.example/logo.png" },
        m1: { kind: "photo", uri: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png", pref: 1 },
        old: { kind: "photo", uri: "cid:photo@example.org" },
      },
    });
    const photo = "data:image/jpeg;base64,/9j/4AAQ";
    expect(patchFromInput(withMedia, input({ photo }))).toEqual({
      "media/m1": { kind: "photo", uri: photo, mediaType: "image/jpeg", pref: 1 },
      "media/old": null,
    });
  });

  it("adds a photo next to other media, or as the first media", () => {
    const photo = "data:image/jpeg;base64,/9j/4AAQ";
    const withLogo = card({ media: { p1: { kind: "logo", uri: "https://nyu.example/logo.png" } } });
    expect(patchFromInput(withLogo, input({ photo }))).toEqual({
      "media/p2": { kind: "photo", uri: photo, mediaType: "image/jpeg" },
    });
    expect(patchFromInput(card(), input({ photo }))).toEqual({
      media: { p1: { kind: "photo", uri: photo, mediaType: "image/jpeg" } },
    });
  });

  it("replaces a linked photo with the cropped one", () => {
    const linked = card({
      media: { m1: { kind: "photo", uri: "https://photos.example/me.png", mediaType: "image/png" } },
    });
    const photo = "data:image/jpeg;base64,/9j/4AAQ";
    expect(patchFromInput(linked, input({ photo }))).toEqual({
      "media/m1": { kind: "photo", uri: photo, mediaType: "image/jpeg" },
    });
  });

  it("removes every photo and nothing else when the picture goes", () => {
    const withMedia = card({
      media: {
        s1: { kind: "sound", uri: "https://nyu.example/name.ogg" },
        m1: { kind: "photo", uri: "data:image/png;base64,iVBORw0KGgo=" },
        m2: { kind: "photo", uri: "cid:photo@example.org" },
      },
    });
    expect(patchFromInput(withMedia, input({ photo: null }))).toEqual({ "media/m1": null, "media/m2": null });
  });

  it("leaves the picture alone when the editor didn't touch it", () => {
    const inside = "data:image/png;base64,iVBORw0KGgo=";
    const withPhoto = card({ media: { m1: { kind: "photo", uri: inside } } });
    expect(patchFromInput(withPhoto, input())).toEqual({});
    expect(patchFromInput(withPhoto, input({ photo: inside }))).toEqual({});
  });

  it("moves a card to another address book", () => {
    expect(patchFromInput(card(), input({ addressBookId: "b2" }))).toEqual({ addressBookIds: { b2: true } });
  });
});
