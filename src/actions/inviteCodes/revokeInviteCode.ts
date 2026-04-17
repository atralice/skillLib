"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import authorizeSystemRole from "@/lib/serverActions/authorize/authorizeSystemRole";
import prisma from "@/lib/prisma";
import { RevokeInviteCodeSchema } from "./revokeInviteCodeSchema";
import type { RevokeInviteCodeInput } from "./revokeInviteCodeSchema";

const revokeInviteCodeServerAction = createServerAction(
  async (input: RevokeInviteCodeInput) => {
    const invite = await prisma.inviteCode.findUnique({
      where: { id: input.inviteCodeId },
    });

    if (!invite) {
      throw new Error("Invite code not found");
    }

    if (invite.usedById) {
      throw new Error("Invite code already used");
    }

    if (invite.revokedAt) {
      return { success: true };
    }

    await prisma.inviteCode.update({
      where: { id: input.inviteCodeId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  },
  {
    filterInput: (input) => RevokeInviteCodeSchema.parse(input),
    authorize: (_input, user, impersonatingUser) => authorizeSystemRole(user, impersonatingUser),
  },
);

export default revokeInviteCodeServerAction;
