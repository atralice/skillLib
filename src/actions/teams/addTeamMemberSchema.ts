import { z } from "zod";

export const AddTeamMemberSchema = z
  .object({
    teamId: z.string().uuid(),
    username: z.string().min(1),
    role: z.enum(["member", "admin"]).default("member"),
  })
  .strict();

export type AddTeamMemberInput = z.infer<typeof AddTeamMemberSchema>;
