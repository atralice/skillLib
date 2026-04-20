"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import prisma from "@/lib/prisma";
import { AddTeamMemberSchema } from "./addTeamMemberSchema";
import type { AddTeamMemberInput } from "./addTeamMemberSchema";

const addTeamMemberServerAction = createServerAction(
  async (input: AddTeamMemberInput, { user }) => {
    const caller = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: input.teamId, userId: user.id } },
    });

    if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
      throw new Error("Only team owners or admins can add members");
    }

    const target = await prisma.user.findUnique({
      where: { username: input.username },
    });
    if (!target) {
      return serverActionError({
        fieldErrors: { username: ["No user with that username"] },
      });
    }

    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: input.teamId, userId: target.id } },
    });
    if (existing) {
      return serverActionError({
        fieldErrors: { username: ["User is already a team member"] },
      });
    }

    await prisma.teamMember.create({
      data: {
        teamId: input.teamId,
        userId: target.id,
        role: input.role,
      },
    });

    return { success: true };
  },
  {
    filterInput: (input) => AddTeamMemberSchema.parse(input),
    authorize: async () => true,
  },
);

export default addTeamMemberServerAction;
