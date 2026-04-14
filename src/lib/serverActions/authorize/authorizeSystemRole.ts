import type { NonNullableSessionUser } from "@/utils/loaders/server/user/getUser";
import hasSystemRole from "@/lib/user/hasSystemRole";
import type { User } from "generated/prisma/client/client";

export default async function authorizeSystemRole(
  user: Pick<NonNullableSessionUser, "id" | "systemRole" | "impersonateUserId" | "isImpersonating">,
  impersonatingUser: Pick<User, "id" | "systemRole"> | null,
) {
  if (impersonatingUser && hasSystemRole(impersonatingUser)) {
    return true;
  } else if (user && hasSystemRole(user)) {
    return true;
  }

  return false;
}
