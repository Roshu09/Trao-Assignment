import { z } from "zod";
import {
  MAX_DAYS,
  MIN_DAYS,
  ORIGINS,
  PRIORITIES,
  QUESTION_CATEGORIES,
  REQUIREMENT_KINDS,
} from "./constants";

/**
 * Kit structure from Appendix A of the brief. Field names must match exactly.
 * Optional fields (origin, edited, pinned, research) are our extensions; the brief allows
 * extending the structure where it genuinely helps.
 */

const nonEmpty = z.string().min(1);

export const RequirementSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
});

/** Edit-state flags shared by questions and flashcards (see README: generated, edited, pinned). */
const editState = {
  origin: z.enum(ORIGINS).optional(),
  edited: z.boolean().optional(),
  pinned: z.boolean().optional(),
};

export const QuestionSchema = z.object({
  id: nonEmpty,
  requirement_ids: z.array(nonEmpty),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: nonEmpty,
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  ...editState,
});

export const FlashcardSchema = z.object({
  id: nonEmpty,
  front: nonEmpty,
  back: z.string(),
  requirement_ids: z.array(nonEmpty),
  ...editState,
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(nonEmpty),
  minutes: z.number().int().min(0),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(MIN_DAYS).max(MAX_DAYS),
  days: z.array(ScheduleDaySchema),
});

const KitShape = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().min(0),
    researched_at: nonEmpty,
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: z.object({
    uncovered_requirement_ids: z.array(nonEmpty),
    passes: z.number().int().min(0),
  }),
  /** Extension: an honest record of what research found, and what it did not. */
  research: z
    .object({
      thin_description: z.boolean(),
      hiring_page_found: z.boolean(),
      discussion_found: z.boolean(),
      failed_sources: z.array(z.object({ url: z.string(), reason: z.string() })),
    })
    .optional(),
});

export const KitSchema = KitShape.superRefine((kit, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  const collectIds = (items: { id: string }[], path: string[], label: string): Set<string> => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) issue([...path, index, "id"], `Duplicate ${label} id "${item.id}"`);
      seen.add(item.id);
    });
    return seen;
  };

  const requirementIds = collectIds(kit.role.requirements, ["role", "requirements"], "requirement");
  const questionIds = collectIds(kit.questions, ["questions"], "question");
  collectIds(kit.flashcards, ["flashcards"], "flashcard");

  kit.questions.forEach((question, qi) => {
    question.requirement_ids.forEach((id, ri) => {
      if (!requirementIds.has(id)) {
        issue(["questions", qi, "requirement_ids", ri], `Unknown requirement id "${id}"`);
      }
    });
  });

  kit.flashcards.forEach((card, fi) => {
    card.requirement_ids.forEach((id, ri) => {
      if (!requirementIds.has(id)) {
        issue(["flashcards", fi, "requirement_ids", ri], `Unknown requirement id "${id}"`);
      }
    });
  });

  kit.coverage.uncovered_requirement_ids.forEach((id, i) => {
    if (!requirementIds.has(id)) {
      issue(["coverage", "uncovered_requirement_ids", i], `Unknown requirement id "${id}"`);
    }
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issue(
      ["schedule", "days"],
      `Schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`,
    );
  }

  kit.schedule.days.forEach((day, di) => {
    if (day.day !== di + 1) {
      issue(["schedule", "days", di, "day"], `Expected day ${di + 1} but found ${day.day}`);
    }
    day.question_ids.forEach((id, qi) => {
      if (!questionIds.has(id)) {
        issue(["schedule", "days", di, "question_ids", qi], `Unknown question id "${id}"`);
      }
    });
  });

  // Every must-have must be reachable through the schedule, unless the kit honestly declares it uncovered.
  const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
  const reachable = new Set<string>();
  for (const question of kit.questions) {
    if (scheduled.has(question.id)) question.requirement_ids.forEach((id) => reachable.add(id));
  }
  const declared = new Set(kit.coverage.uncovered_requirement_ids);
  kit.role.requirements.forEach((req, i) => {
    if (req.priority === "must" && !reachable.has(req.id) && !declared.has(req.id)) {
      issue(
        ["role", "requirements", i],
        `Must-have "${req.id}" is not in the schedule and not listed as uncovered`,
      );
    }
  });
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Kit = z.infer<typeof KitSchema>;

export type ParseKitResult = { success: true; kit: Kit } | { success: false; errors: string[] };

/** Validates untrusted data (model output, request bodies) against the kit structure. */
export function parseKit(data: unknown): ParseKitResult {
  const result = KitSchema.safeParse(data);
  if (result.success) return { success: true, kit: result.data };
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
