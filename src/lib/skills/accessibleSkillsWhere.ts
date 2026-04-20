import prisma from "@/lib/prisma";
import type { Prisma } from "generated/prisma/client/client";

export default async function accessibleSkillsWhere(
  userId: string,
): Promise<Prisma.SkillWhereInput> {
  const teamMemberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = teamMemberships.map((m) => m.teamId);

  return {
    OR: [
      { visibility: "public" },
      { ownerId: userId },
      ...(teamIds.length > 0
        ? [{ teamId: { in: teamIds } }, { grants: { some: { teamId: { in: teamIds } } } }]
        : []),
      { grants: { some: { userId } } },
    ],
  };
}
