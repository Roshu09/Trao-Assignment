/**
 * Sliding-window limiter for tokens per minute. Free tiers limit tokens as well as requests,
 * and hitting that limit is the most common way to lose points (brief, "Preferred Tech Stack").
 * Staying under it beats recovering from it.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const WINDOW_MS = 60_000;

export class TokenRateLimiter {
  private events: { at: number; tokens: number }[] = [];
  private readonly budget: number;

  /**
   * @param tokensPerMinute provider limit
   * @param headroom fraction of the limit we allow ourselves, to absorb estimation error
   */
  constructor(
    tokensPerMinute: number,
    private readonly clock: Clock = realClock,
    headroom = 0.85,
  ) {
    if (!(tokensPerMinute > 0)) throw new RangeError("tokensPerMinute must be positive");
    this.budget = Math.max(1, Math.floor(tokensPerMinute * headroom));
  }

  /** Resolves once `tokens` more tokens fit inside the current minute. */
  async acquire(tokens: number): Promise<void> {
    // A single request larger than the whole budget could never fit, so clamp instead of hanging.
    const cost = Math.min(Math.max(1, Math.ceil(tokens)), this.budget);

    for (;;) {
      const now = this.clock.now();
      this.events = this.events.filter((event) => now - event.at < WINDOW_MS);
      const used = this.events.reduce((sum, event) => sum + event.tokens, 0);

      if (used + cost <= this.budget) {
        this.events.push({ at: now, tokens: cost });
        return;
      }

      const oldest = this.events[0];
      const wait = oldest ? oldest.at + WINDOW_MS - now : 1_000;
      await this.clock.sleep(Math.max(wait, 50));
    }
  }
}
