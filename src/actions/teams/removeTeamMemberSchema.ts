import { z } from "zod";

export const RemoveTeamMemberSchema = z
  .object({
    memberId: z.string().uuid(),
  })
  .strict();

export type RemoveTeamMemberInput = z.infer<typeof RemoveTeamMemberSchema>;
