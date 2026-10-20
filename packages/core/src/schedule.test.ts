import { describe, expect, it } from "vitest";
import { findMustsMissingFromSchedule } from "./coverage";
import { allocateCounts, buildSchedule, minutesFor } from "./schedule";
import { question, req } from "./testing/fixtures";

/** 12 questions over 6 requirements: r1-r4 are must-haves, r5-r6 nice-to-haves. */
function sample() {
  const requirements = [
    req("r1", "must", "5+ years with React"),
    req("r2", "must", "Design REST APIs"),
    req("r3", "must", "Mentor junior engineers"),
    req("r4", "must", "Operate services on AWS"),
    req("r5", "nice", "Experience with GraphQL"),
    req("r6", "nice", "Open source contributions"),
  ];
  const questions = [
    question("q1", ["r1"], 3),
    question("q2", ["r1"], 1),
    question("q3", ["r2"], 2),
    question("q4", ["r2"], 3),
    question("q5", ["r3"], 2, "behavioural"),
    question("q6", ["r3"], 1, "behavioural"),
    question("q7", ["r4"], 3, "system-design"),
    question("q8", ["r4"], 2),
    question("q9", ["r5"], 3),
    question("q10", ["r5"], 1),
    question("q11", ["r6"], 2),
    question("q12", ["r6"], 1),
  ];
  return { requirements, questions };
}

describe("buildSchedule", () => {
  it.each([1, 2, 5, 7, 12])("spans exactly %i days and schedules every question once", (days) => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: days });

    expect(schedule.days_available).toBe(days);
    expect(schedule.days).toHaveLength(days);
    expect(schedule.days.map((d) => d.day)).toEqual(Array.from({ length: days }, (_, i) => i + 1));

    const scheduled = schedule.days.flatMap((d) => d.question_ids).sort();
    expect(scheduled).toEqual(questions.map((q) => q.id).sort());
  });

  it("puts everything in one day for a 1-day schedule", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 1 });
    expect(schedule.days[0]?.question_ids).toHaveLength(12);
  });

  it("turns spare days into review days for a 60-day schedule", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 60 });

    expect(schedule.days).toHaveLength(60);
    const known = new Set(questions.map((q) => q.id));
    for (const day of schedule.days) {
      expect(day.question_ids.length).toBeGreaterThan(0);
      for (const id of day.question_ids) expect(known.has(id)).toBe(true);
    }
    // First 12 days introduce each question once; the rest only review.
    const firstPass = schedule.days.slice(0, 12).flatMap((d) => d.question_ids);
    expect(new Set(firstPass).size).toBe(12);
    for (const day of schedule.days.slice(12)) expect(day.focus.startsWith("Review:")).toBe(true);
  });

  it("reviews the hardest must-have material first", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 14 });
    const firstReview = schedule.days[12]; // day 13
    expect(firstReview?.question_ids).toEqual([schedule.days[0]?.question_ids[0]]);
  });

  it("schedules must-have and harder material earlier", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 6 });
    const dayOf = (id: string) => schedule.days.find((d) => d.question_ids.includes(id))?.day ?? 99;

    // The hardest must-have question is on day 1.
    expect(dayOf("q1")).toBe(1);
    // No nice-to-have question lands before the last must-have question.
    const lastMust = Math.max(...["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map(dayOf));
    const firstNice = Math.min(...["q9", "q10", "q11", "q12"].map(dayOf));
    expect(lastMust).toBeLessThanOrEqual(firstNice);
  });

  it("front-loads: day sizes never grow", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 5 });
    const sizes = schedule.days.map((d) => d.question_ids.length);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i] ?? 0).toBeLessThanOrEqual(sizes[i - 1] ?? 0);
    }
  });

  it("uses integer minutes that match the questions scheduled", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 5 });
    const byId = new Map(questions.map((q) => [q.id, q]));
    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
      const expected = day.question_ids.reduce(
        (sum, id) => sum + minutesFor(byId.get(id)?.difficulty ?? 2),
        0,
      );
      expect(day.minutes).toBe(expected);
    }
  });

  it("includes every must-have requirement somewhere in the schedule", () => {
    const { requirements, questions } = sample();
    for (const days of [1, 3, 5, 12, 60]) {
      const schedule = buildSchedule({ requirements, questions, daysAvailable: days });
      expect(findMustsMissingFromSchedule(requirements, questions, schedule)).toEqual([]);
    }
  });

  it("gives every day a focus", () => {
    const { requirements, questions } = sample();
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 5 });
    for (const day of schedule.days) expect(day.focus.length).toBeGreaterThan(0);
  });

  it("still returns the requested number of days when there are no questions", () => {
    const schedule = buildSchedule({ requirements: [req("r1")], questions: [], daysAvailable: 3 });
    expect(schedule.days).toHaveLength(3);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(0);
    }
  });

  it.each([0, -1, 61, 2.5, Number.NaN])("rejects %s days", (days) => {
    const { requirements, questions } = sample();
    expect(() => buildSchedule({ requirements, questions, daysAvailable: days })).toThrow(
      /whole number/,
    );
  });
});

describe("allocateCounts", () => {
  it.each([
    [12, 5],
    [5, 5],
    [100, 7],
    [61, 60],
    [9, 2],
  ])("splits %i questions over %i days without losing any", (total, days) => {
    const counts = allocateCounts(total, days);
    expect(counts).toHaveLength(days);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i] ?? 0).toBeLessThanOrEqual(counts[i - 1] ?? 0);
    }
  });
});
