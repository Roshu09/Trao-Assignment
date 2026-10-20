import { describe, expect, it } from "vitest";
import { nextId } from "./ids";

describe("nextId", () => {
  it("starts at 1 when nothing exists", () => {
    expect(nextId("q", [])).toBe("q1");
  });

  it("goes past the highest existing id, never reusing gaps", () => {
    expect(nextId("q", ["q1", "q7", "q3"])).toBe("q8");
  });

  it("ignores other prefixes and non-numeric ids", () => {
    expect(nextId("q", ["r9", "qx", "q2"])).toBe("q3");
  });
});
