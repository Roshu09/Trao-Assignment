import { describe, expect, it } from "vitest";
import { parseEvaluateArgs } from "./args";

describe("parseEvaluateArgs", () => {
  it("reads --input and --output", () => {
    expect(parseEvaluateArgs(["--input", "cases.json", "--output", "kits.json"])).toEqual({
      input: "cases.json",
      output: "kits.json",
    });
  });

  it("rejects a missing --input", () => {
    expect(() => parseEvaluateArgs(["--output", "kits.json"])).toThrow(/--input/);
  });

  it("rejects a flag without a value", () => {
    expect(() => parseEvaluateArgs(["--input", "--output", "kits.json"])).toThrow(/Missing value/);
  });
});
