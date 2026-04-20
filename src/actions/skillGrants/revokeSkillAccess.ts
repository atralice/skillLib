"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import prisma from "@/lib/prisma";
import { RevokeSkillAccessSchema } from "./revokeSkillAccessSchema";
import type { RevokeSkillAccessInput } from "./revokeSkillAccessSchema";

const revokeSkillAccessServerAction = createServerAction(
  async (input: RevokeSkillAccessInput, { user }) => {
    const grant = await prisma.skillGrant.findUnique({
      where: { id: input.grantId },
      include: { skill: { select: { ownerId: true } } },
    });
    if (!grant) {
      throw new Error("Grant not found");
    }
    if (grant.skill.ownerId !== user.id) {
      throw new Error("Only the skill owner can revoke access");
    }
    await prisma.skillGrant.delete({ where: { id: input.grantId } });
    return { success: true };
  },
  {
    filterInput: (input) => RevokeSkillAccessSchema.parse(input),
    authorize: async () => true,
  },
);

export default revokeSkillAccessServerAction;
