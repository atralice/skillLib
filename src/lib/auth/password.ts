import "server-only";
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
  });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return await verify(passwordHash, password);
}
