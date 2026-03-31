/**
 * Serializes a value for React Server Component transport.
 * RSC cannot transport Date objects, so we convert them to ISO strings.
 */
export function serializeRsc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
