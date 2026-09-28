import { describe, expect, it } from "vitest";
import { profileOptionsFrom, profileSetError, visibilityOf } from "./profile";

describe("profile pictures over JMAP", () => {
  it("reads what the account's capability allows", () => {
    expect(profileOptionsFrom({ maxSize: 5000, mayBePublic: false })).toEqual({ maxSize: 5000, mayBePublic: false });
    expect(profileOptionsFrom({})).toEqual({ maxSize: 10 * 1024 * 1024, mayBePublic: true });
    expect(profileOptionsFrom(undefined)).toBeNull();
    expect(profileOptionsFrom(null)).toBeNull();
  });

  it("takes the server's default for a visibility it doesn't know", () => {
    expect(visibilityOf({ id: "singleton", visibility: "public" })).toBe("public");
    expect(visibilityOf({ id: "singleton", visibility: "off" })).toBe("off");
    expect(visibilityOf({ id: "singleton", visibility: "world" })).toBe("server");
    expect(visibilityOf({ id: "singleton" })).toBe("server");
  });

  it("turns a refused public picture into forbidden", () => {
    expect(profileSetError({ type: "invalidProperties", properties: ["visibility"] }).code).toBe("forbidden");
    expect(profileSetError({ type: "invalidProperties", properties: ["blobId"] }).code).toBe("invalid_input");
    expect(profileSetError({ type: "tooLarge" }).code).toBe("invalid_input");
    expect(profileSetError({ type: "serverFail" }).code).toBe("internal");
  });
});
