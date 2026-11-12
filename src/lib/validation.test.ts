import { describe, expect, it } from "vitest";
import { isUuid, isValidEmail } from "@/lib/validation";

describe("isUuid", () => {
  it("accepts a valid v4 UUID", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(isUuid("abc")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a minimal valid address", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("rejects a string without @ or domain", () => {
    expect(isValidEmail("nope")).toBe(false);
  });
});
