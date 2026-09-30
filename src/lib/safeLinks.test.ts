import { describe, expect, it } from "vitest";
import { checkLink } from "./links";
import { unwrapSafeLink } from "./safeLinks";

const wrap = (target: string, host = "eur01.safelinks.protection.outlook.com") =>
  `https://${host}/?url=${encodeURIComponent(target)}&data=05%7C02%7C%7Cabc&sdata=xyz&reserved=0`;

describe("unwrapSafeLink", () => {
  it("reads the real link from every regional and sovereign Safe Links host", () => {
    for (const host of [
      "eur01.safelinks.protection.outlook.com",
      "nam12.safelinks.protection.outlook.com",
      "gcc02.safelinks.protection.outlook.com",
      "safelinks.protection.outlook.com",
      "na01.safelinks.protection.office365.us",
      "can01.safelinks.protection.partner.outlook.cn",
    ]) {
      expect(unwrapSafeLink(wrap("https://shop.example/deal?a=1&b=2", host))).toEqual({
        target: "https://shop.example/deal?a=1&b=2",
        host,
      });
    }
  });

  it("reads the Teams and Office apps variant", () => {
    const href = `https://statics.teams.cdn.office.net/evergreen-assets/safelinks/1/atp-safelinks.html?url=${encodeURIComponent("https://docs.example.org/a")}&locale=en-us`;
    expect(unwrapSafeLink(href)?.target).toBe("https://docs.example.org/a");
  });

  it("keeps mail links and links encoded twice", () => {
    expect(unwrapSafeLink(wrap("mailto:leni@example.com?subject=Hi"))?.target).toBe(
      "mailto:leni@example.com?subject=Hi",
    );
    expect(unwrapSafeLink(wrap(encodeURIComponent("https://shop.example/x")))?.target).toBe("https://shop.example/x");
  });

  it("unwraps a Safe Link inside a Safe Link", () => {
    expect(unwrapSafeLink(wrap(wrap("https://shop.example/"), "nam02.safelinks.protection.outlook.com"))).toEqual({
      target: "https://shop.example/",
      host: "nam02.safelinks.protection.outlook.com",
    });
  });

  it("never unwraps to anything but web and mail links", () => {
    expect(unwrapSafeLink(wrap("javascript:alert(1)"))).toBeNull();
    expect(unwrapSafeLink(wrap("data:text/html,<b>hi</b>"))).toBeNull();
    expect(unwrapSafeLink(wrap("file:///etc/passwd"))).toBeNull();
    expect(unwrapSafeLink(wrap("not a link"))).toBeNull();
    expect(unwrapSafeLink("https://eur01.safelinks.protection.outlook.com/?data=1")).toBeNull();
  });

  it("ignores look-alike hosts and other pages", () => {
    expect(unwrapSafeLink(wrap("https://shop.example/", "safelinks.protection.outlook.com.evil.example"))).toBeNull();
    expect(unwrapSafeLink(wrap("https://shop.example/", "evilsafelinks.protection.outlook.com"))).toBeNull();
    expect(unwrapSafeLink(`https://statics.teams.cdn.office.net/other.html?url=https%3A%2F%2Fshop.example`)).toBeNull();
    expect(unwrapSafeLink("https://shop.example/?url=https%3A%2F%2Fother.example")).toBeNull();
  });
});

describe("checkLink with Safe Links", () => {
  it("checks the real target: its domain, the phishing check and the offer to remember it", () => {
    const check = checkLink(wrap("https://www.bank.example/login"), "www.bank.example");
    expect(check).toMatchObject({
      href: "https://www.bank.example/login",
      safeLink: "eur01.safelinks.protection.outlook.com",
      host: "www.bank.example",
      misleading: null,
      redirect: null,
      rememberable: "bank.example",
    });
  });

  it("still flags text that names another site than the real target", () => {
    expect(checkLink(wrap("https://bank-login.example/"), "www.bank.example")?.misleading).toEqual({
      shown: "bank.example",
      actual: "bank-login.example",
    });
  });

  it("keeps reading redirects behind the Safe Link", () => {
    const check = checkLink(wrap("https://x.list-manage.com/track/click?u=1"), "");
    expect(check?.redirect?.hidden?.service).toBe("tracking");
  });

  it("takes the host the reader already removed", () => {
    expect(checkLink("https://shop.example/", "", "eur01.safelinks.protection.outlook.com")?.safeLink).toBe(
      "eur01.safelinks.protection.outlook.com",
    );
    expect(checkLink("https://shop.example/", "")?.safeLink).toBeNull();
  });
});
