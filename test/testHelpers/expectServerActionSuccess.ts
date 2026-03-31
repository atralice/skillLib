import { expect } from "bun:test";
import { isServerActionSuccess } from "@/lib/serverActions/isServerActionSuccess";
import type { ServerActionError } from "@/lib/serverActions/serverActionError";
import { inspect } from "node:util";

export function expectServerActionSuccess<T>(
  result: T,
): asserts result is Exclude<T, ServerActionError> {
  expect(isServerActionSuccess(result), `Received ${inspect(result, { depth: 10 })}`).toBe(true);
}
