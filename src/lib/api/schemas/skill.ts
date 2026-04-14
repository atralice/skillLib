import { z } from "zod";

const skillNameRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const CreateSkillSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .max(100)
      .regex(skillNameRegex, "Must be lowercase alphanumeric with hyphens, cannot start/end with hyphen"),
    displayName: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    visibility: z.enum(["public", "unlisted", "private"]).optional(),
  })
  .strict();

export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

export const SearchSkillsSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type SearchSkillsInput = z.infer<typeof SearchSkillsSchema>;
