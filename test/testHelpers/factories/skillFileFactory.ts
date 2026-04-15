import createFactory from "./createFactory";
import type { SkillFile, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

const defaultContent = `---
name: test-skill
description: A test skill
---

# Test Skill

This is a test skill.
`;

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function buildAttributes(): SkillFile {
  return {
    id: uuidv4(),
    skillVersionId: uuidv4(),
    path: "SKILL.md",
    sha256: sha256Of(defaultContent),
    size: Buffer.byteLength(defaultContent),
    contentType: "text/markdown",
    createdAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.SkillFileUncheckedCreateInput>,
): Prisma.SkillFileUncheckedCreateInput {
  return {
    skillVersionId: attributes.skillVersionId ?? uuidv4(),
    path: "SKILL.md",
    sha256: sha256Of(defaultContent),
    size: Buffer.byteLength(defaultContent),
    contentType: "text/markdown",
    ...attributes,
  };
}

const skillFileFactory = createFactory<
  SkillFile,
  Prisma.SkillFileUncheckedCreateInput,
  Partial<Prisma.SkillFileUncheckedCreateInput>
>({
  modelName: "skillFile",
  buildAttributes,
  createAttributes,
});

export default skillFileFactory;
