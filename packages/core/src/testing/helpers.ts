import type { Clock } from "../llm/rateLimiter";

/** Awaits a promise that is expected to reject and returns the error (fails loudly if it resolves). */
export async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}

/** A fake clock: sleeping advances time instantly and records each wait. */
export function fakeClock(start = 1_000_000): Clock & { sleeps: number[]; elapsed(): number } {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    elapsed: () => now - start,
  };
}
