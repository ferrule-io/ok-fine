import { describe, expect, it } from "vitest";
import { tokenIdentity } from "./identity.js";

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("tokenIdentity", () => {
  it("extracts email from JWT payload", () => {
    const token = makeToken({ email: "alice@example.com" });
    expect(tokenIdentity(token)).toBe("alice@example.com");
  });

  it("extracts preferred_username when email is absent", () => {
    const token = makeToken({ preferred_username: "alice" });
    expect(tokenIdentity(token)).toBe("alice");
  });

  it("extracts name when email and preferred_username are absent", () => {
    const token = makeToken({ name: "Alice Smith" });
    expect(tokenIdentity(token)).toBe("Alice Smith");
  });

  it("extracts sub when no friendly claims are present", () => {
    const token = makeToken({ sub: "user-12345" });
    expect(tokenIdentity(token)).toBe("user-12345");
  });

  it("respects claim priority: email > preferred_username > name > sub", () => {
    const token = makeToken({
      email: "alice@example.com",
      preferred_username: "alice",
      name: "Alice Smith",
      sub: "user-123",
    });
    expect(tokenIdentity(token)).toBe("alice@example.com");

    const token2 = makeToken({
      preferred_username: "alice",
      name: "Alice Smith",
      sub: "user-123",
    });
    expect(tokenIdentity(token2)).toBe("alice");
  });

  it("handles base64url padding and encoding correctly", () => {
    // Generate a payload that requires padding
    const token = makeToken({ email: "a@b.co" });
    expect(tokenIdentity(token)).toBe("a@b.co");
  });

  it("returns null for opaque or non-JWT tokens", () => {
    expect(tokenIdentity("opaque-access-token-without-dots")).toBeNull();
    expect(tokenIdentity("")).toBeNull();
    expect(tokenIdentity("only.one.dot.here.is.too.many")).toBeNull();
  });

  it("returns null for malformed base64 or non-JSON payloads", () => {
    expect(tokenIdentity("abc.not-valid-base64!.def")).toBeNull();
    const badJson = Buffer.from("not json").toString("base64url");
    expect(tokenIdentity(`abc.${badJson}.def`)).toBeNull();
  });

  it("rejects claims containing control characters", () => {
    const token = makeToken({ email: "alice\x00@example.com" });
    expect(tokenIdentity(token)).toBeNull();

    const tokenWithNewline = makeToken({ email: "alice\n@example.com", sub: "clean-sub" });
    expect(tokenIdentity(tokenWithNewline)).toBe("clean-sub");
  });

  it("returns null when claims are non-strings or whitespace", () => {
    expect(tokenIdentity(makeToken({ email: 12345 }))).toBeNull();
    expect(tokenIdentity(makeToken({ email: "   " }))).toBeNull();
    expect(tokenIdentity(makeToken({}))).toBeNull();
  });
});
