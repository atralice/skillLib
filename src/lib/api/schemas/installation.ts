import { z } from "zod";

export const InstallSkillSchema = z
  .object({
    owner: z.string().min(1),
    name: z.string().min(1),
    versionConstraint: z.string().max(50).default("*"),
  })
  .strict();

export type InstallSkillInput = z.infer<typeof InstallSkillSchema>;

export const CheckUpdatesSchema = z
  .object({
    installations: z.array(
      z.object({
        skillId: z.string().uuid(),
        currentVersion: z.string(),
        versionConstraint: z.string(),
      }),
    ),
  })
  .strict();

export type CheckUpdatesInput = z.infer<typeof CheckUpdatesSchema>;
