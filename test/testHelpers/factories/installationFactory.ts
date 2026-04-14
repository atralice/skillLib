import createFactory from "./createFactory";
import type { Installation, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

function buildAttributes(): Installation {
  return {
    id: uuidv4(),
    userId: uuidv4(),
    skillId: uuidv4(),
    skillVersionId: uuidv4(),
    versionConstraint: "*",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.InstallationUncheckedCreateInput>,
): Prisma.InstallationUncheckedCreateInput {
  return {
    userId: attributes.userId ?? uuidv4(),
    skillId: attributes.skillId ?? uuidv4(),
    skillVersionId: attributes.skillVersionId ?? uuidv4(),
    ...attributes,
  };
}

const installationFactory = createFactory<
  Installation,
  Prisma.InstallationUncheckedCreateInput,
  Partial<Prisma.InstallationUncheckedCreateInput>
>({
  modelName: "installation",
  buildAttributes,
  createAttributes,
});

export default installationFactory;
