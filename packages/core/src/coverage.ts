import { DEFAULT_MAX_COVERAGE_PASSES } from "./constants";
import { nextId } from "./ids";
import type { Question, Requirement, Schedule } from "./schema";

/**
 * Coverage checking is code, not a prompt (brief, sections 3 and 4): which requirements have no
 * question is a comparison, so the application decides it. The model is only asked to fill gaps
 * the code has found.
 */

export interface CoverageReport {
  /** Requirement ids that at least one question references. */
  covered: string[];
  /** Requirement ids with no question, must-haves first. */
  uncovered: Requirement[];
  uncovered_must_ids: string[];
}

export function checkCoverage(requirements: Requirement[], questions: Question[]): CoverageReport {
  const known = new Set(requirements.map((r) => r.id));
  const referenced = new Set<string>();
  for (const question of questions) {
    for (const id of question.requirement_ids) {
      // Ids the model invented do not count towards coverage.
      if (known.has(id)) referenced.add(id);
    }
  }

  const covered = requirements.filter((r) => referenced.has(r.id)).map((r) => r.id);
  const uncovered = requirements
    .filter((r) => !referenced.has(r.id))
    .sort((a, b) => Number(b.priority === "must") - Number(a.priority === "must"));

  return {
    covered,
    uncovered,
    uncovered_must_ids: uncovered.filter((r) => r.priority === "must").map((r) => r.id),
  };
}

/** Must-have requirements that no scheduled question reaches. */
export function findMustsMissingFromSchedule(
  requirements: Requirement[],
  questions: Question[],
  schedule: Schedule,
): string[] {
  const scheduled = new Set(schedule.days.flatMap((day) => day.question_ids));
  const reachable = new Set<string>();
  for (const question of questions) {
    if (scheduled.has(question.id)) question.requirement_ids.forEach((id) => reachable.add(id));
  }
  return requirements.filter((r) => r.priority === "must" && !reachable.has(r.id)).map((r) => r.id);
}

/** Asked to write questions for the gaps the code found. Implemented by the LLM step. */
export type GapFiller = (gaps: Requirement[], existing: Question[]) => Promise<Question[]>;

export type CoverageStopReason = "complete" | "max_passes" | "no_progress" | "error";

export interface CoverageLoopOptions {
  requirements: Requirement[];
  /** The first draft. Counts as pass 1. */
  questions: Question[];
  fillGaps: GapFiller;
  maxPasses?: number;
}

export interface CoverageLoopResult {
  questions: Question[];
  uncovered_requirement_ids: string[];
  /** Generation passes run, including the first draft. */
  passes: number;
  stop_reason: CoverageStopReason;
  error?: string;
}

/**
 * Check, then ask only for what is missing, then check again.
 *
 * Stops when nothing is uncovered, when `maxPasses` is reached (default 3: the first draft, one
 * repair, one straggler pass), or when a pass closes no gap at all (asking again is wasted quota).
 * Whatever is still uncovered at the end is reported honestly rather than hidden.
 */
export async function runCoverageLoop(options: CoverageLoopOptions): Promise<CoverageLoopResult> {
  const { requirements, fillGaps, maxPasses = DEFAULT_MAX_COVERAGE_PASSES } = options;
  let questions = [...options.questions];
  let passes = 1;
  let report = checkCoverage(requirements, questions);

  const finish = (reason: CoverageStopReason, error?: string): CoverageLoopResult => ({
    questions,
    uncovered_requirement_ids: report.uncovered.map((r) => r.id),
    passes,
    stop_reason: reason,
    ...(error ? { error } : {}),
  });

  while (report.uncovered.length > 0) {
    if (passes >= maxPasses) return finish("max_passes");

    let added: Question[];
    try {
      added = await fillGaps(report.uncovered, questions);
    } catch (err) {
      return finish("error", err instanceof Error ? err.message : String(err));
    }
    passes += 1;

    questions = [...questions, ...withUniqueIds(questions, added)];
    const before = report.uncovered.length;
    report = checkCoverage(requirements, questions);
    if (report.uncovered.length > 0 && report.uncovered.length >= before) {
      return finish("no_progress");
    }
  }

  return finish("complete");
}

/** Gives any newly generated question that collides with an existing id a fresh one. */
function withUniqueIds(existing: Question[], added: Question[]): Question[] {
  const taken = new Set(existing.map((q) => q.id));
  return added.map((question) => {
    if (!taken.has(question.id)) {
      taken.add(question.id);
      return question;
    }
    const id = nextId("q", taken);
    taken.add(id);
    return { ...question, id };
  });
}
