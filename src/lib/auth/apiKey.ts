import "server-only";
import { randomBytes, createHash } from "crypto";

const API_KEY_PREFIX = "sk_";
const API_KEY_BYTE_LENGTH = 32;

export function generateApiKey() {
  const raw = randomBytes(API_KEY_BYTE_LENGTH).toString("hex");
  const fullKey = `${API_KEY_PREFIX}${raw}`;
  const keyPrefix = fullKey.slice(0, 11); // "sk_" + 8 chars
  const keyHash = hashApiKey(fullKey);

  return { fullKey, keyPrefix, keyHash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
