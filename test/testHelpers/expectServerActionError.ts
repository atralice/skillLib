import { expect } from "bun:test";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";
import type { ServerActionError } from "@/lib/serverActions/serverActionError";

export function expectServerActionError<T>(
  result: T,
): asserts result is Extract<T, ServerActionError> {
  expect(isServerActionError(result)).toBe(true);
}
