import { describe, expect, it } from "vitest";
import { checkCoverage, runCoverageLoop } from "./coverage";
import type { Question, Requirement } from "./schema";
import { question, req } from "./testing/fixtures";

describe("checkCoverage", () => {
  it("reports no gaps when every requirement has a question", () => {
    const requirements = [req("r1"), req("r2", "nice")];
    const report = checkCoverage(requirements, [question("q1", ["r1"]), question("q2", ["r2"])]);
    expect(report.uncovered).toEqual([]);
    expect(report.covered).toEqual(["r1", "r2"]);
  });

  it("finds a requirement with no question and lists must-haves first", () => {
    const requirements = [req("r1", "nice"), req("r2", "must"), req("r3", "must")];
    const report = checkCoverage(requirements, [question("q1", ["r3"])]);
    expect(report.uncovered.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(report.uncovered_must_ids).toEqual(["r2"]);
  });

  it("does not count requirement ids the model invented", () => {
    const report = checkCoverage([req("r1")], [question("q1", ["r99"])]);
    expect(report.uncovered.map((r) => r.id)).toEqual(["r1"]);
  });

  it("counts a question that covers several requirements for each of them", () => {
    const report = checkCoverage([req("r1"), req("r2")], [question("q1", ["r1", "r2"])]);
    expect(report.uncovered).toEqual([]);
  });
});

describe("runCoverageLoop", () => {
  it("does not call the model when nothing is uncovered", async () => {
    let calls = 0;
    const result = await runCoverageLoop({
      requirements: [req("r1")],
      questions: [question("q1", ["r1"])],
      fillGaps: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
    expect(result.passes).toBe(1);
    expect(result.stop_reason).toBe("complete");
    expect(result.uncovered_requirement_ids).toEqual([]);
  });

  it("closes a gap on the second pass and asks only about the gap", async () => {
    const asked: string[][] = [];
    const result = await runCoverageLoop({
      requirements: [req("r1"), req("r2")],
      questions: [question("q1", ["r1"])],
      fillGaps: async (gaps) => {
        asked.push(gaps.map((g) => g.id));
        return gaps.map((g, i) => question(`q${i + 2}`, [g.id]));
      },
    });
    expect(asked).toEqual([["r2"]]);
    expect(result.passes).toBe(2);
    expect(result.stop_reason).toBe("complete");
    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.questions).toHaveLength(2);
  });

  it("stops at the pass cap and reports what is still uncovered", async () => {
    const requirements = [req("r1"), req("r2"), req("r3"), req("r4"), req("r5")];
    let calls = 0;
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      maxPasses: 3,
      // Closes exactly one gap per pass.
      fillGaps: async (gaps) => {
        calls++;
        const first = gaps[0] as Requirement;
        return [question(`q${calls}`, [first.id])];
      },
    });
    expect(calls).toBe(2);
    expect(result.passes).toBe(3);
    expect(result.stop_reason).toBe("max_passes");
    expect(result.uncovered_requirement_ids).toHaveLength(3);
  });

  it("stops early when a pass closes no gap", async () => {
    let calls = 0;
    const result = await runCoverageLoop({
      requirements: [req("r1"), req("r2")],
      questions: [question("q1", ["r1"])],
      fillGaps: async () => {
        calls++;
        return [question("q2", ["r1"])]; // useless: does not cover r2
      },
    });
    expect(calls).toBe(1);
    expect(result.stop_reason).toBe("no_progress");
    expect(result.uncovered_requirement_ids).toEqual(["r2"]);
  });

  it("gives new questions fresh ids when the model reuses one", async () => {
    const result = await runCoverageLoop({
      requirements: [req("r1"), req("r2")],
      questions: [question("q1", ["r1"])],
      fillGaps: async () => [question("q1", ["r2"])], // collides with the existing q1
    });
    const ids = result.questions.map((q: Question) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.uncovered_requirement_ids).toEqual([]);
  });

  it("records a generator failure instead of throwing", async () => {
    const result = await runCoverageLoop({
      requirements: [req("r1"), req("r2")],
      questions: [question("q1", ["r1"])],
      fillGaps: async () => {
        throw new Error("rate limited");
      },
    });
    expect(result.stop_reason).toBe("error");
    expect(result.error).toBe("rate limited");
    expect(result.uncovered_requirement_ids).toEqual(["r2"]);
    expect(result.passes).toBe(1);
  });
});
