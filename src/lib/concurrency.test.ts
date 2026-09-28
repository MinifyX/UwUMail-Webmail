import { describe, expect, it } from "vitest";
import { createLimiter } from "./concurrency";

describe("createLimiter", () => {
  it("runs no more than the limit at once, in order, and goes on after a failure", async () => {
    const run = createLimiter(2);
    let active = 0;
    let most = 0;
    const order: number[] = [];
    const gates: (() => void)[] = [];
    const task = (n: number) => () =>
      new Promise<number>((resolve, reject) => {
        active += 1;
        most = Math.max(most, active);
        order.push(n);
        gates.push(() => {
          active -= 1;
          if (n === 1) reject(new Error("no"));
          else resolve(n);
        });
      });
    const results = [1, 2, 3, 4].map((n) => run(task(n)).catch(() => -n));
    // Let the first two start, then open the gates one by one.
    while (order.length < 4 || gates.length > 0) {
      await Promise.resolve();
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await Promise.all(results)).toEqual([-1, 2, 3, 4]);
    expect(most).toBe(2);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
