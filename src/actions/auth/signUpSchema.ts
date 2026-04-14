import { z } from "zod";

export const SignUpSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    inviteCode: z.string().min(1),
  })
  .strict();

export type SignUpInput = z.infer<typeof SignUpSchema>;
