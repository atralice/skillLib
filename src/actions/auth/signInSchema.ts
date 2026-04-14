import { z } from "zod";

export const SignInSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export type SignInInput = z.infer<typeof SignInSchema>;
