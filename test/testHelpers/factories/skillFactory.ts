import createFactory from "./createFactory";
import createTrait from "./createTrait";
import type { Skill, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

function buildAttributes(): Skill {
  const slug = `skill-${uuidv4().slice(0, 8)}`;
  return {
    id: uuidv4(),
    name: slug,
    displayName: `Test Skill ${slug}`,
    description: "A test skill",
    visibility: "public",
    ownerId: uuidv4(),
    teamId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.SkillUncheckedCreateInput>,
): Prisma.SkillUncheckedCreateInput {
  const slug = `skill-${uuidv4().slice(0, 8)}`;
  return {
    name: slug,
    displayName: `Test Skill ${slug}`,
    ownerId: attributes.ownerId ?? uuidv4(),
    ...attributes,
  };
}

const privateTrait = createTrait<Skill, Prisma.SkillUncheckedCreateInput, Partial<Prisma.SkillUncheckedCreateInput>>({
  visibility: "private",
});

const unlistedTrait = createTrait<Skill, Prisma.SkillUncheckedCreateInput, Partial<Prisma.SkillUncheckedCreateInput>>({
  visibility: "unlisted",
});

const traits = {
  private: privateTrait,
  unlisted: unlistedTrait,
};

const skillFactory = createFactory<
  Skill,
  Prisma.SkillUncheckedCreateInput,
  Partial<Prisma.SkillUncheckedCreateInput>,
  typeof traits
>({
  modelName: "skill",
  buildAttributes,
  createAttributes,
  traits,
});

export default skillFactory;
