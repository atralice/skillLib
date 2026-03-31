import { mock } from "bun:test";

export default function mockCookies(cookies: Record<string, any>) {
  return mock.module("next/headers", () => ({
    cookies: () => {
      const cookieMap = new Map();
      for (const [key, value] of Object.entries(cookies)) {
        cookieMap.set(key, { value });
      }
      return cookieMap;
    },
  }));
}
