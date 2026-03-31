import { PrismaClient } from "generated/prisma/client";

/* eslint-disable @typescript-eslint/consistent-type-assertions */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};
/* eslint-enable @typescript-eslint/consistent-type-assertions */

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
