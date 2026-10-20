import { describe, expect, it } from "vitest";
import { parseKit } from "./schema";

/** A small kit that satisfies Appendix A. Each test starts from a fresh copy. */
function validKit(): any {
  return {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 420,
      researched_at: "2026-10-20T09:00:00Z",
      pages_used: ["http://localhost:8099/acme/careers"],
    },
    company_brief: { summary: "Acme builds tools.", what_they_do: "Developer tools.", sources: [] },
    role: {
      title: "Senior Backend Engineer",
      seniority: "senior",
      responsibilities: ["Build APIs"],
      requirements: [
        { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentor juniors", kind: "behavioural", priority: "nice" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "How does the Node event loop work?",
        answer_outline: "Phases, microtasks, blocking.",
        difficulty: 2,
      },
    ],
    flashcards: [{ id: "f1", front: "Event loop?", back: "Single-threaded loop.", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "5+ years with Node.js", question_ids: ["q1"], minutes: 15 },
        { day: 2, focus: "Review: 5+ years with Node.js", question_ids: ["q1"], minutes: 9 },
      ],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 2 },
  };
}

function errorsFor(kit: unknown): string[] {
  const result = parseKit(kit);
  return result.success ? [] : result.errors;
}

describe("parseKit", () => {
  it("accepts a kit that matches the structure", () => {
    expect(parseKit(validKit()).success).toBe(true);
  });

  it("accepts the optional edit-state and research extensions", () => {
    const kit = validKit();
    kit.questions[0].origin = "manual";
    kit.questions[0].pinned = true;
    kit.research = {
      thin_description: false,
      hiring_page_found: false,
      discussion_found: false,
      failed_sources: [{ url: "http://localhost:8099/missing", reason: "404" }],
    };
    expect(parseKit(kit).success).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(parseKit(null).success).toBe(false);
    expect(parseKit("kit").success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const kit = validKit();
    delete kit.source.company;
    expect(errorsFor(kit).join("\n")).toMatch(/source\.company/);
  });

  it("rejects difficulty outside 1 to 3", () => {
    const kit = validKit();
    kit.questions[0].difficulty = 4;
    expect(errorsFor(kit).join("\n")).toMatch(/questions\.0\.difficulty/);
  });

  it("rejects minutes that are not whole numbers", () => {
    const kit = validKit();
    kit.schedule.days[0].minutes = 12.5;
    expect(errorsFor(kit).join("\n")).toMatch(/minutes/);
  });

  it("rejects a bad category or priority", () => {
    const kit = validKit();
    kit.questions[0].category = "trivia";
    kit.role.requirements[0].priority = "required";
    const text = errorsFor(kit).join("\n");
    expect(text).toMatch(/category/);
    expect(text).toMatch(/priority/);
  });

  it("rejects a question that references an unknown requirement", () => {
    const kit = validKit();
    kit.questions[0].requirement_ids = ["r99"];
    expect(errorsFor(kit).join("\n")).toMatch(/Unknown requirement id "r99"/);
  });

  it("rejects a schedule entry that references an unknown question", () => {
    const kit = validKit();
    kit.schedule.days[1].question_ids = ["q42"];
    expect(errorsFor(kit).join("\n")).toMatch(/Unknown question id "q42"/);
  });

  it("rejects a schedule whose length differs from days_available", () => {
    const kit = validKit();
    kit.schedule.days_available = 3;
    expect(errorsFor(kit).join("\n")).toMatch(/2 days but days_available is 3/);
  });

  it("rejects days that are not numbered in order", () => {
    const kit = validKit();
    kit.schedule.days[1].day = 5;
    expect(errorsFor(kit).join("\n")).toMatch(/Expected day 2/);
  });

  it("rejects duplicate ids", () => {
    const kit = validKit();
    kit.role.requirements.push({ ...kit.role.requirements[0] });
    expect(errorsFor(kit).join("\n")).toMatch(/Duplicate requirement id "r1"/);
  });

  it("rejects a must-have that is neither scheduled nor declared uncovered", () => {
    const kit = validKit();
    kit.role.requirements.push({ id: "r3", text: "Run Postgres", kind: "technical", priority: "must" });
    expect(errorsFor(kit).join("\n")).toMatch(/Must-have "r3"/);
  });

  it("accepts an uncovered must-have when the kit declares it honestly", () => {
    const kit = validKit();
    kit.role.requirements.push({ id: "r3", text: "Run Postgres", kind: "technical", priority: "must" });
    kit.coverage.uncovered_requirement_ids.push("r3");
    expect(parseKit(kit).success).toBe(true);
  });
});
