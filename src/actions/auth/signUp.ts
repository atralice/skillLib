"use server";

import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import type { ServerActionError } from "@/lib/serverActions/serverActionError";
import { SignUpSchema } from "./signUpSchema";

async function signUp(
  input: unknown,
): Promise<{ success: true; userId: string } | ServerActionError> {
  const parsed = SignUpSchema.safeParse(input);
  if (!parsed.success) {
    return serverActionError({
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password, firstName, lastName, inviteCode } = parsed.data;

  const userCount = await prisma.user.count();
  const isBootstrap = userCount === 0;

  let inviteId: string | null = null;
  if (!isBootstrap) {
    const invite = await prisma.inviteCode.findUnique({
      where: { code: inviteCode },
    });

    if (!invite || invite.usedById) {
      return serverActionError({ formErrors: ["Invalid or already used invite code"] });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return serverActionError({ formErrors: ["Invite code has expired"] });
    }

    inviteId = invite.id;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return serverActionError({
      fieldErrors: { email: ["An account with this email already exists"] },
    });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      ...(isBootstrap
        ? { systemRole: "admin" as const, username: email.split("@")[0] }
        : {}),
    },
  });

  if (inviteId) {
    await prisma.inviteCode.update({
      where: { id: inviteId },
      data: { usedById: user.id },
    });
  }

  await createSession(user.id);

  return { success: true, userId: user.id };
}

export default signUp;
