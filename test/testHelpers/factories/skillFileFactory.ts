import createFactory from "./createFactory";
import type { SkillFile, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

const defaultContent = `---
name: test-skill
description: A test skill
---

# Test Skill

This is a test skill.
`;

function buildAttributes(): SkillFile {
  return {
    id: uuidv4(),
    skillVersionId: uuidv4(),
    path: "SKILL.md",
    content: defaultContent,
    size: Buffer.byteLength(defaultContent),
    createdAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.SkillFileUncheckedCreateInput>,
): Prisma.SkillFileUncheckedCreateInput {
  const content = attributes.content ?? defaultContent;
  return {
    skillVersionId: attributes.skillVersionId ?? uuidv4(),
    path: "SKILL.md",
    content,
    size: Buffer.byteLength(String(content)),
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
