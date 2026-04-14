import createFactory from "./createFactory";
import createTrait from "./createTrait";
import type { User, Prisma } from "generated/prisma/client/client";
import { v4 as uuidv4 } from "uuid";

function buildAttributes(): User {
  return {
    id: uuidv4(),
    email: `test-${uuidv4()}@example.com`,
    username: `user-${uuidv4().slice(0, 8)}`,
    passwordHash: "hashed-password-placeholder",
    firstName: "Test",
    lastName: "User",
    systemRole: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createAttributes(attributes: Partial<Prisma.UserCreateInput>): Prisma.UserCreateInput {
  return {
    email: `test-${uuidv4()}@example.com`,
    username: `user-${uuidv4().slice(0, 8)}`,
    passwordHash: "hashed-password-placeholder",
    firstName: "Test",
    lastName: "User",
    ...attributes,
  };
}

const adminTrait = createTrait<User, Prisma.UserCreateInput, Partial<Prisma.UserCreateInput>>({
  systemRole: "admin",
});

const staffTrait = createTrait<User, Prisma.UserCreateInput, Partial<Prisma.UserCreateInput>>({
  systemRole: "staff",
});

const traits = {
  admin: adminTrait,
  staff: staffTrait,
};

const userFactory = createFactory<
  User,
  Prisma.UserCreateInput,
  Partial<Prisma.UserCreateInput>,
  typeof traits
>({
  modelName: "user",
  buildAttributes,
  createAttributes,
  traits,
});

export default userFactory;
