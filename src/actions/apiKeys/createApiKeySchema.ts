import { z } from "zod";

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
  })
  .strict();

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
