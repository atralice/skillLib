import { PrismaClient } from "generated/prisma/client/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* eslint-disable @typescript-eslint/consistent-type-assertions */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};
/* eslint-enable @typescript-eslint/consistent-type-assertions */

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
