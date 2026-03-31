/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { expect } from "bun:test";
import type { SafeParseReturnType } from "zod";

expect.extend({
  toBeZodSuccess(received: unknown) {
    const result = received as SafeParseReturnType<unknown, unknown>;
    if (result.success) {
      return { pass: true, message: () => "Expected Zod parse to fail" };
    }

    return {
      pass: false,
      message: () =>
        `Expected Zod parse to succeed, but got errors:\n${result.error.issues
          .map((i) => `  ${JSON.stringify(i.path)}: ${i.message}`)
          .join("\n")}`,
    };
  },
});

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    toBeZodSuccess(): void;
  }
}
