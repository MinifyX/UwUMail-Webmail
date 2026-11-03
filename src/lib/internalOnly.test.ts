import { describe, expect, it } from "vitest";
import { canSendTo, normalizeDomain, OPEN_SEND_POLICY, recipientDomain, undeliverableRecipients } from "./internalOnly";

const internal = { internalOnly: true, internalDomains: ["uwumail.example", "team.example.org"] };

describe("recipientDomain", () => {
  it("reads the domain of bare, display-name and subaddressed forms", () => {
    expect(recipientDomain("leni@Wanders.Example")).toBe("wanders.example");
    expect(recipientDomain("Leni Wanders <leni@wanders.example>")).toBe("wanders.example");
    expect(recipientDomain('"Wanders, Leni" <leni+news@wanders.example> ')).toBe("wanders.example");
    expect(recipientDomain("leni+tag@wanders.example.")).toBe("wanders.example");
  });

  it("takes the last @ of a quoted local part", () => {
    expect(recipientDomain('"a@b.test"@uwumail.example')).toBe("uwumail.example");
  });

  it("writes international names as DNS has them", () => {
    expect(recipientDomain("mia@bücher.example")).toBe("xn--bcher-kva.example");
  });

  it("has nothing for text without a domain", () => {
    expect(recipientDomain("leni")).toBeNull();
    expect(recipientDomain("leni@")).toBeNull();
  });
});

describe("canSendTo", () => {
  it("lets every address through without the limit", () => {
    expect(canSendTo("leni@wanders.example", OPEN_SEND_POLICY)).toBe(true);
  });

  it("compares domains case-insensitively and exactly", () => {
    expect(canSendTo("Noah <noah+x@UWUMAIL.example>", internal)).toBe(true);
    expect(canSendTo("emma@Team.Example.org", internal)).toBe(true);
    expect(canSendTo("leni@wanders.example", internal)).toBe(false);
    // A subdomain is another host, and so is a lookalike.
    expect(canSendTo("x@mail.uwumail.example", internal)).toBe(false);
    expect(canSendTo("x@uwumail.example.test", internal)).toBe(false);
    expect(canSendTo("no-domain", internal)).toBe(false);
  });

  it("leaves the decision to the server when it named no domains", () => {
    expect(canSendTo("leni@wanders.example", { internalOnly: true, internalDomains: [] })).toBe(true);
  });
});

describe("undeliverableRecipients", () => {
  it("lists every outside address once, in order", () => {
    const list = undeliverableRecipients(
      [
        { email: "mini@uwumail.example" },
        { name: "Leni", email: "leni@wanders.example" },
        { email: "noah@zockt.example" },
        { email: "LENI@wanders.example" },
      ],
      internal,
    );
    expect(list.map((a) => a.email)).toEqual(["leni@wanders.example", "noah@zockt.example"]);
  });

  it("is empty without the limit", () => {
    expect(undeliverableRecipients([{ email: "leni@wanders.example" }], OPEN_SEND_POLICY)).toEqual([]);
  });
});

describe("normalizeDomain", () => {
  it("keeps text URL parsing would reshape, so it can't match a hosted domain", () => {
    for (const raw of [
      "uwumail.example/x",
      "uwumail.example\\x",
      "uwumail.example?a",
      "uwumail.example#a",
      "uwumail.example:25",
      "x@uwumail.example",
      "uwumail.example ",
    ]) {
      expect(normalizeDomain(raw)).not.toBe("uwumail.example");
    }
    expect(normalizeDomain("Evil.Test/UwUMail.Example")).toBe("evil.test/uwumail.example");
    expect(canSendTo("a@uwumail.example:25", internal)).toBe(false);
    expect(canSendTo("a@x@uwumail.example/", internal)).toBe(false);
  });
});

describe("the domain set", () => {
  it("reads the list only once per policy", () => {
    let reads = 0;
    const domains = new Proxy(["uwumail.example"], {
      get(target, key, receiver) {
        if (key === "slice") reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const policy = { internalOnly: true, internalDomains: domains };
    canSendTo("a@uwumail.example", policy);
    undeliverableRecipients([{ email: "b@wanders.example" }], policy);
    expect(reads).toBe(1);
  });
});
