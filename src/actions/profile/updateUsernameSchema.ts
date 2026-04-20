import { z } from "zod";

export const UpdateUsernameSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(32)
      .regex(
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
        "Username must be lowercase letters, numbers, or dashes, and must start and end with a letter or number",
      ),
  })
  .strict();

export type UpdateUsernameInput = z.infer<typeof UpdateUsernameSchema>;
