"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import prisma from "@/lib/prisma";
import { RemoveTeamMemberSchema } from "./removeTeamMemberSchema";
import type { RemoveTeamMemberInput } from "./removeTeamMemberSchema";

const removeTeamMemberServerAction = createServerAction(
  async (input: RemoveTeamMemberInput, { user }) => {
    const target = await prisma.teamMember.findUnique({
      where: { id: input.memberId },
    });
    if (!target) {
      throw new Error("Member not found");
    }

    const caller = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: target.teamId, userId: user.id } },
    });

    const isSelf = target.userId === user.id;
    const isCallerPrivileged = caller && (caller.role === "owner" || caller.role === "admin");

    if (!isSelf && !isCallerPrivileged) {
      throw new Error("Only team owners or admins can remove other members");
    }

    if (target.role === "owner") {
      const owners = await prisma.teamMember.count({
        where: { teamId: target.teamId, role: "owner" },
      });
      if (owners <= 1) {
        throw new Error("Cannot remove the last owner of the team");
      }
    }

    await prisma.teamMember.delete({ where: { id: input.memberId } });
    return { success: true };
  },
  {
    filterInput: (input) => RemoveTeamMemberSchema.parse(input),
    authorize: async () => true,
  },
);

export default removeTeamMemberServerAction;
