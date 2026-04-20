import type { Prisma } from "generated/prisma/client/client";

export default function accessibleSkillsWhere({
  userId,
  teamIds,
}: {
  userId: string;
  teamIds: string[];
}): Prisma.SkillWhereInput {
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
