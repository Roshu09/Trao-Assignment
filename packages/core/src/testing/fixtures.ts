import type { Question, Requirement } from "../schema";

export function req(id: string, priority: "must" | "nice" = "must", text?: string): Requirement {
  return { id, text: text ?? `Requirement ${id}`, kind: "technical", priority };
}

export function question(
  id: string,
  requirementIds: string[],
  difficulty = 2,
  category: Question["category"] = "technical",
): Question {
  return {
    id,
    requirement_ids: requirementIds,
    category,
    prompt: `Prompt ${id}`,
    answer_outline: `Outline ${id}`,
    difficulty,
  };
}
