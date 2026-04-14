"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import prisma from "@/lib/prisma";
import { RevokeApiKeySchema } from "./revokeApiKeySchema";
import type { RevokeApiKeyInput } from "./revokeApiKeySchema";

const revokeApiKeyServerAction = createServerAction(
  async (input: RevokeApiKeyInput, { user }) => {
    const apiKey = await prisma.apiKey.findFirst({
      where: { id: input.apiKeyId, userId: user.id },
    });

    if (!apiKey) {
      throw new Error("API key not found");
    }

    await prisma.apiKey.update({
      where: { id: input.apiKeyId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  },
  {
    filterInput: (input) => RevokeApiKeySchema.parse(input),
    authorize: async () => true,
  },
);

export default revokeApiKeyServerAction;
