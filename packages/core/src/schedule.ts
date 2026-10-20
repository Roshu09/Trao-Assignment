import { MAX_DAYS, MIN_DAYS } from "./constants";
import type { Question, Requirement, Schedule, ScheduleDay } from "./schema";

/**
 * Schedule allocation is arithmetic, so it lives in code and never in a prompt (brief, section 3).
 *
 * Rules:
 *  - The schedule has exactly `daysAvailable` days.
 *  - Questions are ranked: must-have before nice-to-have, then harder before easier.
 *  - Ranked questions are dealt out in order, earlier days taking a larger share, so the hardest and
 *    highest-priority material never lands the night before.
 *  - With fewer questions than days, each question gets its own day and the extra days become
 *    review days that revisit the hardest material first.
 */

/** Study time per question, in whole minutes. */
export function minutesFor(difficulty: number): number {
  if (difficulty >= 3) return 20;
  if (difficulty <= 1) return 10;
  return 15;
}

const REVIEW_RATIO = 0.6;
const MIN_REVIEW_MINUTES = 5;
/** How strongly early days are favoured. Day i gets weight (FRONT_LOAD * days - i). */
const FRONT_LOAD = 1.5;
const FOCUS_MAX_CHARS = 60;
const FOCUS_MAX_ITEMS = 2;

export interface ScheduleInput {
  requirements: Requirement[];
  questions: Question[];
  daysAvailable: number;
}

export function buildSchedule({ requirements, questions, daysAvailable }: ScheduleInput): Schedule {
  if (!Number.isInteger(daysAvailable) || daysAvailable < MIN_DAYS || daysAvailable > MAX_DAYS) {
    throw new RangeError(
      `days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}, got ${daysAvailable}`,
    );
  }

  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const ranked = rankQuestions(questions, requirementById);
  const days: ScheduleDay[] = [];

  if (ranked.length === 0) {
    for (let day = 1; day <= daysAvailable; day++) {
      days.push({ day, focus: "No questions available yet", question_ids: [], minutes: 0 });
    }
  } else if (ranked.length >= daysAvailable) {
    const counts = allocateCounts(ranked.length, daysAvailable);
    let cursor = 0;
    counts.forEach((count, index) => {
      const batch = ranked.slice(cursor, cursor + count);
      cursor += count;
      days.push(studyDay(index + 1, batch, requirementById));
    });
  } else {
    ranked.forEach((question, index) => {
      days.push(studyDay(index + 1, [question], requirementById));
    });
    for (let day = ranked.length + 1; day <= daysAvailable; day++) {
      const question = ranked[(day - ranked.length - 1) % ranked.length];
      if (question) days.push(reviewDay(day, question, requirementById));
    }
  }

  return { days_available: daysAvailable, days };
}

/** Must-have outranks nice-to-have, then harder outranks easier, then original order. */
export function rankQuestions(
  questions: Question[],
  requirementById: Map<string, Requirement>,
): Question[] {
  return questions
    .map((question, index) => ({ question, index, weight: priorityWeight(question, requirementById) }))
    .sort(
      (a, b) =>
        b.weight - a.weight || b.question.difficulty - a.question.difficulty || a.index - b.index,
    )
    .map((entry) => entry.question);
}

function priorityWeight(question: Question, requirementById: Map<string, Requirement>): number {
  let weight = 1;
  for (const id of question.requirement_ids) {
    if (requirementById.get(id)?.priority === "must") weight = 2;
  }
  return weight;
}

/**
 * Splits `total` questions over `days` days (total >= days). Every day gets at least one, and the
 * rest are shared in proportion to a decreasing weight, using largest remainders so the counts
 * always sum to `total` and never increase from one day to the next.
 */
export function allocateCounts(total: number, days: number): number[] {
  const extra = total - days;
  const weights = Array.from({ length: days }, (_, i) => FRONT_LOAD * days - i);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const exact = weights.map((w) => (extra * w) / weightSum);
  const counts = exact.map((x) => 1 + Math.floor(x));

  const leftover = total - counts.reduce((sum, c) => sum + c, 0);
  const byRemainder = exact
    .map((x, index) => ({ index, fraction: x - Math.floor(x) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let k = 0; k < leftover; k++) {
    const target = byRemainder[k % days];
    if (target) counts[target.index] = (counts[target.index] ?? 0) + 1;
  }
  return counts;
}

function studyDay(
  day: number,
  batch: Question[],
  requirementById: Map<string, Requirement>,
): ScheduleDay {
  return {
    day,
    focus: focusFor(batch, requirementById),
    question_ids: batch.map((q) => q.id),
    minutes: batch.reduce((sum, q) => sum + minutesFor(q.difficulty), 0),
  };
}

function reviewDay(
  day: number,
  question: Question,
  requirementById: Map<string, Requirement>,
): ScheduleDay {
  return {
    day,
    focus: `Review: ${focusFor([question], requirementById)}`,
    question_ids: [question.id],
    minutes: Math.max(MIN_REVIEW_MINUTES, Math.round(minutesFor(question.difficulty) * REVIEW_RATIO)),
  };
}

/** A short, deterministic label built from the requirement texts a day's questions cover. */
function focusFor(batch: Question[], requirementById: Map<string, Requirement>): string {
  const tally = new Map<string, { requirement: Requirement; count: number; first: number }>();
  let order = 0;
  for (const question of batch) {
    for (const id of question.requirement_ids) {
      const requirement = requirementById.get(id);
      if (!requirement) continue;
      const entry = tally.get(id);
      if (entry) entry.count += 1;
      else tally.set(id, { requirement, count: 1, first: order++ });
    }
  }

  const top = [...tally.values()]
    .sort(
      (a, b) =>
        Number(b.requirement.priority === "must") - Number(a.requirement.priority === "must") ||
        b.count - a.count ||
        a.first - b.first,
    )
    .slice(0, FOCUS_MAX_ITEMS)
    .map((entry) => truncate(entry.requirement.text, FOCUS_MAX_CHARS));

  if (top.length > 0) return top.join("; ");
  const category = batch[0]?.category;
  return category ? `${category} practice` : "General practice";
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
