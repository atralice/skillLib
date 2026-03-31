/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { expect } from "bun:test";

expect.extend({
  async toHaveDifference(
    received: unknown,
    expected: Record<string, { count: number; query: () => Promise<number> }>,
  ) {
    if (typeof received !== "function") {
      throw new Error("Expected received to be a function");
    }

    const checks = Object.entries(expected).map(([name, { count, query }]) => ({
      name,
      count,
      query,
    }));

    const initialCounts = await Promise.all(checks.map((c) => c.query()));
    await (received as () => Promise<unknown>)();
    const finalCounts = await Promise.all(checks.map((c) => c.query()));

    const failedChecks = checks
      .map((check, i) => ({
        name: check.name,
        expectedDifference: check.count,
        actualDifference: (finalCounts[i] ?? 0) - (initialCounts[i] ?? 0),
      }))
      .filter(
        ({ expectedDifference, actualDifference }) => actualDifference !== expectedDifference,
      );

    return {
      pass: failedChecks.length === 0,
      message: () =>
        failedChecks
          .map(
            ({ name, expectedDifference, actualDifference }) =>
              `${name}: Expected ${expectedDifference}, got ${actualDifference}`,
          )
          .join("\n"),
    };
  },
});

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    toHaveDifference(
      expected: Record<string, { count: number; query: () => Promise<number> }>,
    ): Promise<void>;
  }
}
