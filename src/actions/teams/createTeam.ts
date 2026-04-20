"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import prisma from "@/lib/prisma";
import { CreateTeamSchema } from "./createTeamSchema";
import type { CreateTeamInput } from "./createTeamSchema";

const createTeamServerAction = createServerAction(
  async (input: CreateTeamInput, { user }) => {
    const existing = await prisma.team.findUnique({ where: { name: input.name } });
    if (existing) {
      return serverActionError({
        fieldErrors: { name: ["That team slug is already taken"] },
      });
    }

    const team = await prisma.team.create({
      data: {
        name: input.name,
        displayName: input.displayName,
        members: {
          create: {
            userId: user.id,
            role: "owner",
          },
        },
      },
    });

    return { id: team.id, name: team.name, displayName: team.displayName };
  },
  {
    filterInput: (input) => CreateTeamSchema.parse(input),
    authorize: async () => true,
  },
);

export default createTeamServerAction;
