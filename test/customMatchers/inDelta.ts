/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { expect } from "bun:test";

expect.extend({
  inDelta(received: unknown, expected: number, delta: number = 0.01) {
    const num = received as number;
    const pass = Math.abs(num - expected) <= delta;
    return {
      pass,
      message: () =>
        pass
          ? `Expected ${num} not to be within ${delta} of ${expected}`
          : `Expected ${num} to be within ${delta} of ${expected}`,
    };
  },
});

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    inDelta(expected: number, delta?: number): void;
  }
}
