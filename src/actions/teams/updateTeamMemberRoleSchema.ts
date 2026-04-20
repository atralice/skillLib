import { z } from "zod";

export const UpdateTeamMemberRoleSchema = z
  .object({
    memberId: z.string().uuid(),
    role: z.enum(["owner", "admin", "member"]),
  })
  .strict();

export type UpdateTeamMemberRoleInput = z.infer<typeof UpdateTeamMemberRoleSchema>;
