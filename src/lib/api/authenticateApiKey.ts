import "server-only";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { hashApiKey } from "@/lib/auth/apiKey";
import type { User } from "generated/prisma/client/client";

export async function authenticateApiKey(request: NextRequest): Promise<User | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token.startsWith("sk_")) {
    return null;
  }

  const keyHash = hashApiKey(token);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: true },
  });

  if (!apiKey) {
    return null;
  }

  if (apiKey.revokedAt) {
    return null;
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return apiKey.user;
}
