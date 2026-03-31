import prisma from "@/lib/prisma";
import type { NonNullableSessionUser } from "@/utils/loaders/server/user/getUser";
import type { User } from "generated/prisma/client";
import authorizeSystemRole from "./authorizeSystemRole";

export default async function authorizeUserCanAccessExchange(
  { exchangeId }: { exchangeId: string },
  user: Pick<NonNullableSessionUser, "id" | "systemRole" | "impersonateUserId" | "isImpersonating">,
  impersonatingUser: Pick<User, "id" | "systemRole"> | null,
) {
  const hasRole = await authorizeSystemRole(user, impersonatingUser);
  if (hasRole) {
    return true;
  }

  const exchange = await prisma.exchange.findFirst({
    where: { id: exchangeId },
    include: { exchangeUsers: true },
  });

  return !!(
    exchange && exchange.exchangeUsers.some((exchangeUser) => exchangeUser.userId === user.id)
  );
}
