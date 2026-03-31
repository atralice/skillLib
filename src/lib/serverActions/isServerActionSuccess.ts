import type { ServerActionError } from "./serverActionError";
import { isServerActionError } from "./isServerActionError";

export function isServerActionSuccess<T>(result: T | ServerActionError): result is T {
  return !isServerActionError(result);
}
