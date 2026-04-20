import { z } from "zod";

export const CreateTeamSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(32)
      .regex(
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
        "Team slug must be lowercase letters, numbers, or dashes",
      ),
    displayName: z.string().min(1).max(100),
  })
  .strict();

export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;
