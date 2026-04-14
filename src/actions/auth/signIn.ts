"use server";

import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import type { ServerActionError } from "@/lib/serverActions/serverActionError";
import { SignInSchema } from "./signInSchema";

async function signIn(
  input: unknown,
): Promise<{ success: true } | ServerActionError> {
  const parsed = SignInSchema.safeParse(input);
  if (!parsed.success) {
    return serverActionError({
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return serverActionError({ formErrors: ["Invalid email or password"] });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return serverActionError({ formErrors: ["Invalid email or password"] });
  }

  await createSession(user.id);

  return { success: true };
}

export default signIn;
