import { describe, expect, it } from "vitest";
import { fakeClock, rejection } from "../testing/helpers";
import { createLlmClient, LlmError, type JsonSchemaLike } from "./client";
import { llmConfigFromEnv } from "./config";

/** A tiny stand-in for a Zod schema: expects { answer: number }. */
const answerSchema: JsonSchemaLike<{ answer: number }> = {
  safeParse(input) {
    const value = (input as { answer?: unknown } | null)?.answer;
    if (typeof value === "number") return { success: true, data: { answer: value } };
    return { success: false, error: { issues: [{ path: ["answer"], message: "Expected number" }] } };
  },
};

type Scripted = { status?: number; headers?: Record<string, string>; content?: string; text?: string };

/** Returns a fetch that replays scripted responses and records every request body. */
function scriptedFetch(script: Scripted[]) {
  const requests: any[] = [];
  const headersSeen: Record<string, string>[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    headersSeen.push(init?.headers as Record<string, string>);
    const step = script[requests.length - 1] ?? script[script.length - 1]!;
    const status = step.status ?? 200;
    const body =
      status >= 200 && status < 300
        ? JSON.stringify({ choices: [{ message: { content: step.content ?? "" } }] })
        : (step.text ?? "error");
    return new Response(body, { status, headers: step.headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests, headersSeen };
}

function makeClient(script: Scripted[], extra: Partial<Parameters<typeof createLlmClient>[0]> = {}) {
  const clock = fakeClock();
  const scripted = scriptedFetch(script);
  const client = createLlmClient({
    apiKey: "test-key",
    model: "big-model",
    fallbackModel: "small-model",
    tokensPerMinute: 1_000_000,
    maxAttempts: 2,
    fetchImpl: scripted.fetchImpl,
    clock,
    random: () => 0,
    ...extra,
  });
  return { client, clock, ...scripted };
}

const ask = { schema: answerSchema, messages: [{ role: "user" as const, content: "What is 6 x 7?" }] };

describe("createLlmClient.completeJson", () => {
  it("returns validated JSON and sends the key, model and JSON mode", async () => {
    const { client, requests, headersSeen } = makeClient([{ content: '{"answer": 42}' }]);
    await expect(client.completeJson(ask)).resolves.toEqual({ answer: 42 });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("big-model");
    expect(requests[0].response_format).toEqual({ type: "json_object" });
    expect(headersSeen[0]?.authorization).toBe("Bearer test-key");
  });

  it("accepts JSON wrapped in a code fence or surrounded by chatter", async () => {
    const fenced = makeClient([{ content: '```json\n{"answer": 1}\n```' }]);
    expect(await fenced.client.completeJson(ask)).toEqual({ answer: 1 });

    const chatty = makeClient([{ content: 'Sure! Here you go: {"answer": 2} Hope that helps.' }]);
    expect(await chatty.client.completeJson(ask)).toEqual({ answer: 2 });
  });

  it("honours retry-after on a 429, then succeeds", async () => {
    const { client, clock, requests } = makeClient([
      { status: 429, headers: { "retry-after": "2" } },
      { content: '{"answer": 5}' },
    ]);
    expect(await client.completeJson(ask)).toEqual({ answer: 5 });
    expect(requests).toHaveLength(2);
    expect(clock.sleeps).toContain(2000);
  });

  it("backs off exponentially when there is no retry-after header", async () => {
    const { client, clock } = makeClient([{ status: 503 }, { content: '{"answer": 5}' }]);
    await client.completeJson(ask);
    expect(clock.sleeps).toContain(1000);
  });

  it("falls back to the smaller model after the main one keeps failing", async () => {
    const { client, requests } = makeClient([
      { status: 500 },
      { status: 500 },
      { content: '{"answer": 9}' },
    ]);
    expect(await client.completeJson(ask)).toEqual({ answer: 9 });
    expect(requests.map((r) => r.model)).toEqual(["big-model", "big-model", "small-model"]);
  });

  it("makes one repair attempt that shows the model what was wrong", async () => {
    const { client, requests } = makeClient([
      { content: '{"answer": "forty-two"}' },
      { content: '{"answer": 42}' },
    ]);
    expect(await client.completeJson(ask)).toEqual({ answer: 42 });
    expect(requests).toHaveLength(2);

    const repair = requests[1].messages;
    expect(repair[repair.length - 2].role).toBe("assistant");
    expect(repair[repair.length - 1].content).toMatch(/answer: Expected number/);
  });

  it("repairs output that is not JSON at all", async () => {
    const { client, requests } = makeClient([{ content: "I cannot do that" }, { content: '{"answer": 3}' }]);
    expect(await client.completeJson(ask)).toEqual({ answer: 3 });
    expect(requests[1].messages.at(-1).content).toMatch(/not valid JSON/);
  });

  it("fails with INVALID_OUTPUT when the repair is also wrong", async () => {
    const { client, requests } = makeClient([{ content: "nope" }, { content: '{"answer": "x"}' }]);
    const error = await rejection(client.completeJson(ask));
    expect(error).toBeInstanceOf(LlmError);
    expect(error.code).toBe("INVALID_OUTPUT");
    expect(requests).toHaveLength(2);
  });

  it("does not retry a rejected API key", async () => {
    const { client, requests } = makeClient([{ status: 401, text: "bad key" }]);
    const error = await rejection(client.completeJson(ask));
    expect(error.code).toBe("AUTH");
    expect(requests).toHaveLength(1);
  });

  it("does not retry other client errors", async () => {
    const { client, requests } = makeClient([{ status: 422, text: "unprocessable" }]);
    const error = await rejection(client.completeJson(ask));
    expect(error.code).toBe("PROVIDER_ERROR");
    expect(requests).toHaveLength(1);
  });

  it("retries Groq's json_validate_failed 400", async () => {
    const { client, requests } = makeClient([
      { status: 400, text: '{"error":{"code":"json_validate_failed"}}' },
      { content: '{"answer": 7}' },
    ]);
    expect(await client.completeJson(ask)).toEqual({ answer: 7 });
    expect(requests).toHaveLength(2);
  });

  it("reports RATE_LIMITED once every model and attempt is exhausted by 429s", async () => {
    const { client, requests } = makeClient([{ status: 429 }]);
    const error = await rejection(client.completeJson(ask));
    expect(error.code).toBe("RATE_LIMITED");
    expect(requests).toHaveLength(4); // 2 models x 2 attempts
  });

  it("survives a network error and retries", async () => {
    let calls = 0;
    const clock = fakeClock();
    const client = createLlmClient({
      apiKey: "k",
      model: "m",
      tokensPerMinute: 1_000_000,
      maxAttempts: 2,
      clock,
      random: () => 0,
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) throw new Error("socket hang up");
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer": 1}' } }] }));
      }) as unknown as typeof fetch,
    });
    expect(await client.completeJson(ask)).toEqual({ answer: 1 });
    expect(calls).toBe(2);
  });
});

describe("llmConfigFromEnv", () => {
  it("reads the documented variables", () => {
    const config = llmConfigFromEnv({
      GROQ_API_KEY: "k",
      GROQ_MODEL: "big",
      GROQ_FALLBACK_MODEL: "small",
      LLM_TOKENS_PER_MINUTE: "8000",
    });
    expect(config).toEqual({ apiKey: "k", model: "big", fallbackModel: "small", tokensPerMinute: 8000 });
  });

  it("fails early with a readable message when the key or model is missing", () => {
    expect(() => llmConfigFromEnv({ GROQ_MODEL: "m" })).toThrow(/GROQ_API_KEY/);
    expect(() => llmConfigFromEnv({ GROQ_API_KEY: "k" })).toThrow(/GROQ_MODEL/);
  });

  it("rejects a bad tokens-per-minute value", () => {
    expect(() =>
      llmConfigFromEnv({ GROQ_API_KEY: "k", GROQ_MODEL: "m", LLM_TOKENS_PER_MINUTE: "lots" }),
    ).toThrow(/LLM_TOKENS_PER_MINUTE/);
  });
});
