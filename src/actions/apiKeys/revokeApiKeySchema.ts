import { z } from "zod";

export const RevokeApiKeySchema = z
  .object({
    apiKeyId: z.string().uuid(),
  })
  .strict();

export type RevokeApiKeyInput = z.infer<typeof RevokeApiKeySchema>;
