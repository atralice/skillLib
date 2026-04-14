import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, unauthorized, notFound } from "@/lib/api/apiResponse";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  const { skillId } = await params;

  const installation = await prisma.installation.findUnique({
    where: { userId_skillId: { userId: user.id, skillId } },
  });
  if (!installation) return notFound("Installation not found");

  await prisma.installation.delete({
    where: { id: installation.id },
  });

  return apiSuccess({ deleted: true });
}
