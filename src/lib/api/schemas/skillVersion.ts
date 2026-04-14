import { z } from "zod";

const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

const safePathRegex = /^[a-zA-Z0-9_\-/.]+$/;

const SkillFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .regex(safePathRegex, "Path contains invalid characters")
    .refine((p) => !p.includes(".."), "Path traversal not allowed")
    .refine((p) => !p.startsWith("/"), "Path must be relative"),
  content: z.string().max(500_000, "File content too large (max 500KB)"),
});

export const PublishVersionSchema = z
  .object({
    version: z.string().regex(semverRegex, "Must be valid semver (e.g. 1.0.0)"),
    changelog: z.string().max(10_000).optional(),
    files: z
      .array(SkillFileSchema)
      .min(1, "At least one file is required")
      .max(50, "Maximum 50 files per version")
      .refine(
        (files) => files.some((f) => f.path === "SKILL.md"),
        "SKILL.md is required",
      ),
  })
  .strict();

export type PublishVersionInput = z.infer<typeof PublishVersionSchema>;
