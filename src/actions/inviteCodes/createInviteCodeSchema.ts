import { z } from "zod";

export const CreateInviteCodeSchema = z
  .object({
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export type CreateInviteCodeInput = z.infer<typeof CreateInviteCodeSchema>;
