import createFactory from "./createFactory";
import createTrait from "./createTrait";
import type { SkillVersion, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

function buildAttributes(): SkillVersion {
  return {
    id: uuidv4(),
    skillId: uuidv4(),
    version: "1.0.0",
    status: "draft",
    changelog: "",
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.SkillVersionUncheckedCreateInput>,
): Prisma.SkillVersionUncheckedCreateInput {
  return {
    skillId: attributes.skillId ?? uuidv4(),
    version: "1.0.0",
    ...attributes,
  };
}

const publishedTrait = createTrait<
  SkillVersion,
  Prisma.SkillVersionUncheckedCreateInput,
  Partial<Prisma.SkillVersionUncheckedCreateInput>
>({
  status: "published",
  publishedAt: new Date(),
});

const yankedTrait = createTrait<
  SkillVersion,
  Prisma.SkillVersionUncheckedCreateInput,
  Partial<Prisma.SkillVersionUncheckedCreateInput>
>({
  status: "yanked",
});

const traits = {
  published: publishedTrait,
  yanked: yankedTrait,
};

const skillVersionFactory = createFactory<
  SkillVersion,
  Prisma.SkillVersionUncheckedCreateInput,
  Partial<Prisma.SkillVersionUncheckedCreateInput>,
  typeof traits
>({
  modelName: "skillVersion",
  buildAttributes,
  createAttributes,
  traits,
});

export default skillVersionFactory;
