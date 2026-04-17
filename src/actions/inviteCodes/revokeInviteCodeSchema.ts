import { z } from "zod";

export const RevokeInviteCodeSchema = z
  .object({
    inviteCodeId: z.string().uuid(),
  })
  .strict();

export type RevokeInviteCodeInput = z.infer<typeof RevokeInviteCodeSchema>;
