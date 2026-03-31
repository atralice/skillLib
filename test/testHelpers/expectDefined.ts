import { expect } from "bun:test";

export function expectDefined<T, NarrowedType extends T>(
  value: T | undefined,
  typeGuard?: (value: T) => value is NarrowedType,
  customFailMessage?: string,
): asserts value is NarrowedType {
  expect(value, customFailMessage).toBeDefined();

  if (typeGuard && value !== undefined && !typeGuard(value)) {
    throw new Error("Value did not match the specified type");
  }
}

export function expectDefinedNotNull<T>(
  value: T | undefined | null,
): asserts value is NonNullable<T> {
  expectDefined(value, (val): val is NonNullable<T> => val !== null);
}

export function expectString(value: unknown): asserts value is string {
  expect(value).toBeString();
}

export function expectInstanceOf<T>(
  value: unknown,
  constructor: new (...args: any[]) => T,
): asserts value is T {
  expect(value).toBeInstanceOf(constructor);
}

export function expectHasProperty<K extends string, T extends Record<string, unknown>>(
  value: T,
  key: K,
): asserts value is T & Record<K, unknown> {
  expect(key in value).toBe(true);
}

export function expectDate(value: Date | string | null | undefined): Date {
  if (!(value instanceof Date)) {
    throw new Error("Value is not a Date instance");
  }
  return value;
}
