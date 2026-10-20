import { TokenRateLimiter, realClock, type Clock } from "./rateLimiter";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmErrorCode = "RATE_LIMITED" | "PROVIDER_ERROR" | "INVALID_OUTPUT" | "AUTH";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** The part of a Zod schema we rely on. Zod schemas satisfy this structurally. */
export interface JsonSchemaLike<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

export interface CompleteJsonOptions<T> {
  schema: JsonSchemaLike<T>;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmClient {
  completeJson<T>(options: CompleteJsonOptions<T>): Promise<T>;
}

export interface LlmClientConfig {
  apiKey: string;
  model: string;
  /** Smaller model tried when the main one keeps failing or is rate limited. */
  fallbackModel?: string;
  tokensPerMinute: number;
  baseUrl?: string;
  /** Attempts per model before moving on. */
  maxAttempts?: number;
  // Injectable for tests.
  fetchImpl?: typeof fetch;
  clock?: Clock;
  random?: () => number;
  limiter?: TokenRateLimiter;
}

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const MAX_BACKOFF_MS = 20_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function createLlmClient(config: LlmClientConfig): LlmClient {
  const clock = config.clock ?? realClock;
  const fetchImpl = config.fetchImpl ?? fetch;
  const random = config.random ?? Math.random;
  const maxAttempts = config.maxAttempts ?? 4;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const limiter = config.limiter ?? new TokenRateLimiter(config.tokensPerMinute, clock);
  const models = config.fallbackModel && config.fallbackModel !== config.model
    ? [config.model, config.fallbackModel]
    : [config.model];

  const backoff = (attempt: number): number =>
    Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempt - 1)) + Math.floor(random() * 250);

  /** One logical call: retries with backoff, then falls back to the smaller model. */
  async function chat(
    messages: ChatMessage[],
    maxOutputTokens: number,
    temperature: number,
  ): Promise<string> {
    let lastError: LlmError | undefined;

    for (const model of models) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await limiter.acquire(estimateTokens(messages, maxOutputTokens));
        const isLastAttempt = attempt === maxAttempts;

        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_completion_tokens: maxOutputTokens,
              response_format: { type: "json_object" },
            }),
          });
        } catch (err) {
          lastError = new LlmError(
            "PROVIDER_ERROR",
            `Network error calling ${model}: ${err instanceof Error ? err.message : String(err)}`,
          );
          if (!isLastAttempt) await clock.sleep(backoff(attempt));
          continue;
        }

        if (response.ok) {
          const content = await readContent(response);
          if (content) return content;
          lastError = new LlmError("PROVIDER_ERROR", `${model} returned an empty response`);
          if (!isLastAttempt) await clock.sleep(backoff(attempt));
          continue;
        }

        const body = await safeText(response);
        if (response.status === 401 || response.status === 403) {
          throw new LlmError("AUTH", `LLM provider rejected the API key (HTTP ${response.status})`);
        }

        // Groq answers 400 "json_validate_failed" when the model produced broken JSON: worth another try.
        const retryable =
          RETRYABLE_STATUS.has(response.status) ||
          (response.status === 400 && body.includes("json_validate_failed"));
        if (!retryable) {
          throw new LlmError("PROVIDER_ERROR", `HTTP ${response.status} from ${model}: ${body.slice(0, 200)}`);
        }

        lastError = new LlmError(
          response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
          `HTTP ${response.status} from ${model}`,
        );
        if (!isLastAttempt) {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          await clock.sleep(retryAfter ?? backoff(attempt));
        }
      }
    }

    throw lastError ?? new LlmError("PROVIDER_ERROR", "No LLM attempt was made");
  }

  return {
    async completeJson<T>(options: CompleteJsonOptions<T>): Promise<T> {
      const maxOutputTokens = options.maxOutputTokens ?? 2_000;
      const temperature = options.temperature ?? 0.2;
      const messages: ChatMessage[] = [
        { role: "system", content: "Respond with a single valid JSON object and nothing else." },
        ...options.messages,
      ];

      const first = await chat(messages, maxOutputTokens, temperature);
      const firstResult = validate(first, options.schema);
      if (firstResult.ok) return firstResult.value;

      // One repair attempt: show the model exactly what was wrong with its own output.
      const repair: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: first },
        {
          role: "user",
          content: `That output was rejected: ${firstResult.problem}. Reply again with only the corrected JSON.`,
        },
      ];
      const second = await chat(repair, maxOutputTokens, temperature);
      const secondResult = validate(second, options.schema);
      if (secondResult.ok) return secondResult.value;

      throw new LlmError(
        "INVALID_OUTPUT",
        `Model output failed validation after one repair attempt: ${secondResult.problem}`,
      );
    },
  };
}

function estimateTokens(messages: ChatMessage[], maxOutputTokens: number): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4) + maxOutputTokens;
}

async function readContent(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content : undefined;
  } catch {
    return undefined;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Seconds (the form Groq sends) to milliseconds, capped so a bad header cannot stall the run. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(Math.ceil(seconds * 1_000), MAX_RETRY_AFTER_MS);
}

type Validation<T> = { ok: true; value: T } | { ok: false; problem: string };

function validate<T>(text: string, schema: JsonSchemaLike<T>): Validation<T> {
  const json = parseJsonLoosely(text);
  if (json === undefined) return { ok: false, problem: "it was not valid JSON" };

  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };

  const problem = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, problem };
}

/** Accepts plain JSON, JSON in a code fence, or JSON surrounded by chatter. */
function parseJsonLoosely(text: string): unknown {
  const candidates = [text.trim()];
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}
