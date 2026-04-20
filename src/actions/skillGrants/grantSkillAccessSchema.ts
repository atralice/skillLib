import { z } from "zod";

export const GrantSkillAccessSchema = z
  .object({
    skillId: z.string().uuid(),
    username: z.string().optional(),
    teamId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => (data.username ? 1 : 0) + (data.teamId ? 1 : 0) === 1,
    "Provide either a username or a teamId, not both",
  );

export type GrantSkillAccessInput = z.infer<typeof GrantSkillAccessSchema>;
