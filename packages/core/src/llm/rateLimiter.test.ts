import { describe, expect, it } from "vitest";
import { fakeClock } from "../testing/helpers";
import { TokenRateLimiter } from "./rateLimiter";

describe("TokenRateLimiter", () => {
  it("lets requests through immediately while under the budget", async () => {
    const clock = fakeClock();
    const limiter = new TokenRateLimiter(1000, clock, 1);
    await limiter.acquire(300);
    await limiter.acquire(300);
    await limiter.acquire(400);
    expect(clock.sleeps).toEqual([]);
  });

  it("waits for the window to clear once the budget is spent", async () => {
    const clock = fakeClock();
    const limiter = new TokenRateLimiter(1000, clock, 1);
    await limiter.acquire(600);
    await limiter.acquire(600); // does not fit alongside the first
    expect(clock.elapsed()).toBeGreaterThanOrEqual(60_000);
    expect(clock.elapsed()).toBeLessThanOrEqual(60_100);
  });

  it("frees capacity as old requests age out", async () => {
    const clock = fakeClock();
    const limiter = new TokenRateLimiter(1000, clock, 1);
    await limiter.acquire(900);
    await clock.sleep(61_000);
    const before = clock.sleeps.length;
    await limiter.acquire(900);
    expect(clock.sleeps.length).toBe(before); // no extra wait
  });

  it("does not hang on a request larger than the whole budget", async () => {
    const clock = fakeClock();
    const limiter = new TokenRateLimiter(1000, clock, 1);
    await limiter.acquire(5000);
    expect(clock.sleeps).toEqual([]);
  });

  it("keeps headroom below the provider limit", async () => {
    const clock = fakeClock();
    const limiter = new TokenRateLimiter(1000, clock, 0.5); // budget 500
    await limiter.acquire(400);
    await limiter.acquire(400); // 800 > 500, must wait
    expect(clock.elapsed()).toBeGreaterThanOrEqual(60_000);
  });

  it("rejects a non-positive limit", () => {
    expect(() => new TokenRateLimiter(0)).toThrow(/positive/);
  });
});
