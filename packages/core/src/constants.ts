/** Shared constants. No runtime dependencies, so pure logic can import this freely. */

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;
/** Extension to Appendix A: who created an item. Drives the regenerate-without-clobbering rules. */
export const ORIGINS = ["generated", "manual"] as const;

/** Days the user may ask for (brief mentions 1-day and 60-day schedules as edge cases). */
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** Default cap on coverage passes: first draft, one repair, one straggler pass. */
export const DEFAULT_MAX_COVERAGE_PASSES = 3;
