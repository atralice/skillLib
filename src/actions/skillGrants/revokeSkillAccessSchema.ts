import { z } from "zod";

export const RevokeSkillAccessSchema = z
  .object({
    grantId: z.string().uuid(),
  })
  .strict();

export type RevokeSkillAccessInput = z.infer<typeof RevokeSkillAccessSchema>;
