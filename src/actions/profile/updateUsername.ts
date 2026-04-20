"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import prisma from "@/lib/prisma";
import { UpdateUsernameSchema } from "./updateUsernameSchema";
import type { UpdateUsernameInput } from "./updateUsernameSchema";

const updateUsernameServerAction = createServerAction(
  async (input: UpdateUsernameInput, { user }) => {
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
    });

    if (existing && existing.id !== user.id) {
      return serverActionError({
        fieldErrors: { username: ["That username is already taken"] },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { username: input.username },
    });

    return { success: true, username: input.username };
  },
  {
    filterInput: (input) => UpdateUsernameSchema.parse(input),
    authorize: async () => true,
  },
);

export default updateUsernameServerAction;
