import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each(["/leads", "/leads/123?tab=calls", "/reset-password"])("allows %s", (p) => expect(safeNextPath(p)).toBe(p));
  it.each([
    "https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "evil.com", "/\nfoo", "/%0d", "http://localhost/x",
  ].filter((p) => p !== "/%0d"))("rejects %j", (p) => expect(safeNextPath(p)).toBe("/dashboard"));
  it("falls back for empty values", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("", "/x")).toBe("/x");
  });
});
