"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import { generateApiKey } from "@/lib/auth/apiKey";
import prisma from "@/lib/prisma";
import { CreateApiKeySchema } from "./createApiKeySchema";
import type { CreateApiKeyInput } from "./createApiKeySchema";

async function createApiKeyAction(input: CreateApiKeyInput, { user }: { user: { id: string } }) {
  const { fullKey, keyPrefix, keyHash } = generateApiKey();

  await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: input.name,
      keyPrefix,
      keyHash,
    },
  });

  return { fullKey, keyPrefix, name: input.name };
}

const createApiKeyServerAction = createServerAction(
  async (input: CreateApiKeyInput, context) => {
    return await createApiKeyAction(input, context);
  },
  {
    filterInput: (input) => CreateApiKeySchema.parse(input),
    authorize: async () => true,
  },
);

export default createApiKeyServerAction;
