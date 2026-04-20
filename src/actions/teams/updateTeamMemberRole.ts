"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import prisma from "@/lib/prisma";
import { UpdateTeamMemberRoleSchema } from "./updateTeamMemberRoleSchema";
import type { UpdateTeamMemberRoleInput } from "./updateTeamMemberRoleSchema";

const updateTeamMemberRoleServerAction = createServerAction(
  async (input: UpdateTeamMemberRoleInput, { user }) => {
    const target = await prisma.teamMember.findUnique({
      where: { id: input.memberId },
    });
    if (!target) {
      throw new Error("Member not found");
    }

    const caller = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: target.teamId, userId: user.id } },
    });

    if (!caller || caller.role !== "owner") {
      throw new Error("Only team owners can change member roles");
    }

    if (target.role === "owner" && input.role !== "owner") {
      const owners = await prisma.teamMember.count({
        where: { teamId: target.teamId, role: "owner" },
      });
      if (owners <= 1) {
        throw new Error("Cannot demote the last owner of the team");
      }
    }

    await prisma.teamMember.update({
      where: { id: input.memberId },
      data: { role: input.role },
    });

    return { success: true };
  },
  {
    filterInput: (input) => UpdateTeamMemberRoleSchema.parse(input),
    authorize: async () => true,
  },
);

export default updateTeamMemberRoleServerAction;
