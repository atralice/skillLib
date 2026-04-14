import createFactory from "./createFactory";
import type { InviteCode, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

function buildAttributes(): InviteCode {
  return {
    id: uuidv4(),
    code: `invite-${uuidv4().slice(0, 8)}`,
    usedById: null,
    expiresAt: null,
    createdAt: new Date(),
  };
}

function createAttributes(
  attributes: Partial<Prisma.InviteCodeCreateInput>,
): Prisma.InviteCodeCreateInput {
  return {
    code: `invite-${uuidv4().slice(0, 8)}`,
    ...attributes,
  };
}

const inviteCodeFactory = createFactory<
  InviteCode,
  Prisma.InviteCodeCreateInput,
  Partial<Prisma.InviteCodeCreateInput>
>({
  modelName: "inviteCode",
  buildAttributes,
  createAttributes,
});

export default inviteCodeFactory;
