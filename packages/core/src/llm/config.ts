import type { LlmClientConfig } from "./client";

type Env = Record<string, string | undefined>;

/** Reads the LLM settings documented in .env.example. Fails early with a readable message. */
export function llmConfigFromEnv(env: Env = process.env): LlmClientConfig {
  const apiKey = env.GROQ_API_KEY?.trim();
  const model = env.GROQ_MODEL?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env and fill it in.");
  if (!model) throw new Error("GROQ_MODEL is not set. See .env.example.");

  const tokensPerMinute = Number(env.LLM_TOKENS_PER_MINUTE ?? "6000");
  if (!Number.isFinite(tokensPerMinute) || tokensPerMinute <= 0) {
    throw new Error("LLM_TOKENS_PER_MINUTE must be a positive number.");
  }

  const fallbackModel = env.GROQ_FALLBACK_MODEL?.trim();
  return { apiKey, model, tokensPerMinute, ...(fallbackModel ? { fallbackModel } : {}) };
}
