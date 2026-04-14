import createFactory from "./createFactory";
import type { ApiKey, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";
import { generateApiKey } from "@/lib/auth/apiKey";

function buildAttributes(): ApiKey {
  const { keyPrefix, keyHash } = generateApiKey();
  return {
    id: uuidv4(),
    userId: uuidv4(),
    name: "Test Key",
    keyPrefix,
    keyHash,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.ApiKeyUncheckedCreateInput>,
): Prisma.ApiKeyUncheckedCreateInput {
  const { keyPrefix, keyHash } = generateApiKey();
  return {
    userId: attributes.userId ?? uuidv4(),
    name: "Test Key",
    keyPrefix,
    keyHash,
    ...attributes,
  };
}

const apiKeyFactory = createFactory<
  ApiKey,
  Prisma.ApiKeyUncheckedCreateInput,
  Partial<Prisma.ApiKeyUncheckedCreateInput>
>({
  modelName: "apiKey",
  buildAttributes,
  createAttributes,
});

export default apiKeyFactory;
