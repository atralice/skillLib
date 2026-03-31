/**
 * Makes all properties optional except for the specified required keys.
 * Useful for factory inputs where some fields must be provided.
 *
 * @example
 * type UserInput = PartialWithRequired<User, "email" | "firstName">;
 * // email and firstName are required, all others optional
 */
export type PartialWithRequired<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;
