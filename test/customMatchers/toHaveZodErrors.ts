/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { expect } from "bun:test";
import type { SafeParseReturnType } from "zod";

type ZodErrorExpectation = {
  path: (string | number)[];
  message: string | RegExp;
};

expect.extend({
  toHaveZodErrors(received: unknown, expected: ZodErrorExpectation[]) {
    const result = received as SafeParseReturnType<unknown, unknown>;
    if (result.success) {
      return {
        pass: false,
        message: () => "Expected Zod parse to fail, but it succeeded",
      };
    }

    const issues = result.error.issues;
    const failures: string[] = [];

    for (const exp of expected) {
      const matching = issues.find((issue) => {
        const pathMatch = JSON.stringify(issue.path) === JSON.stringify(exp.path);
        const msgMatch =
          exp.message instanceof RegExp
            ? exp.message.test(issue.message)
            : issue.message === exp.message;
        return pathMatch && msgMatch;
      });

      if (!matching) {
        failures.push(
          `No issue found for path=${JSON.stringify(exp.path)}, message=${exp.message}`,
        );
      }
    }

    return {
      pass: failures.length === 0,
      message: () => failures.join("\n"),
    };
  },
});

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    toHaveZodErrors(expected: ZodErrorExpectation[]): void;
  }
}
