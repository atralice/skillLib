import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import type { User } from "generated/prisma/client";

export type SessionUser =
  | (User & {
      isImpersonating: boolean;
      impersonateUserId: string | null;
    })
  | null;

export type NonNullableSessionUser = NonNullable<SessionUser>;

type GetUserOptions = {
  impersonate?: boolean;
};

const getUser = cache(async (options: GetUserOptions = {}): Promise<SessionUser> => {
  const { impersonate = true } = options;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;

  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  });

  if (!session || !session.user) {
    return null;
  }

  const user = session.user;

  const impersonateUserId = session.impersonateUserId;
  const isImpersonating = !!impersonateUserId;

  if (impersonate && isImpersonating && impersonateUserId) {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: impersonateUserId },
    });

    if (impersonatedUser) {
      return {
        ...impersonatedUser,
        isImpersonating: true,
        impersonateUserId,
      };
    }
  }

  return {
    ...user,
    isImpersonating,
    impersonateUserId,
  };
});

export default getUser;
