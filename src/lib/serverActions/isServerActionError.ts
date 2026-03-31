import type { ServerActionError } from "./serverActionError";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isServerActionError<T>(result: T | ServerActionError): result is ServerActionError {
  if (!isRecord(result)) return false;
  if (!("success" in result) || false !== result.success) return false;
  if (!("error" in result) || !isRecord(result.error)) return false;
  if (!("fieldErrors" in result.error) || !isRecord(result.error.fieldErrors)) return false;
  return "formErrors" in result.error && Array.isArray(result.error.formErrors);
}
