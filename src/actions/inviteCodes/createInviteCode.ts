"use server";

import { randomUUID } from "node:crypto";
import createServerAction from "@/lib/serverActions/createServerAction";
import authorizeSystemRole from "@/lib/serverActions/authorize/authorizeSystemRole";
import prisma from "@/lib/prisma";
import { CreateInviteCodeSchema } from "./createInviteCodeSchema";
import type { CreateInviteCodeInput } from "./createInviteCodeSchema";

const createInviteCodeServerAction = createServerAction(
  async (input: CreateInviteCodeInput, { user }) => {
    const code = `invite-${randomUUID().slice(0, 8)}`;
    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdById: user.id,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    return invite;
  },
  {
    filterInput: (input) => CreateInviteCodeSchema.parse(input),
    authorize: (_input, user, impersonatingUser) => authorizeSystemRole(user, impersonatingUser),
  },
);

export default createInviteCodeServerAction;
