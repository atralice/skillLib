import "server-only";
import getUser, {
  type NonNullableSessionUser,
  type SessionUser,
} from "@/utils/loaders/server/user/getUser";
import { serializeRsc } from "@/lib/serverActions/serializeRsc";

export default function createServerAction<ParsedType, ReturnType>(
  action: (
    params: ParsedType,
    context: {
      user: NonNullableSessionUser;
      impersonatingUser: SessionUser;
      attributedUser: NonNullableSessionUser;
    },
  ) => Promise<ReturnType>,
  {
    filterInput,
    authorize,
  }: {
    filterInput: (params: unknown) => ParsedType | Promise<ParsedType>;
    authorize: (
      params: ParsedType,
      user: NonNullableSessionUser,
      impersonatingUser: SessionUser,
    ) => Promise<boolean>;
  },
) {
  return async function (params: ParsedType): Promise<ReturnType> {
    const filteredParams = await filterInput(params);

    const user = await getUser();
    if (!user) {
      throw new Error("Unauthorized server action - no user found");
    }

    const impersonatingUser = user.isImpersonating ? await getUser({ impersonate: false }) : null;

    const hasAccess = await authorize(filteredParams, user, impersonatingUser);
    if (!hasAccess) {
      throw new Error("Unauthorized server action - authorize returned false");
    }

    const attributedUser = impersonatingUser || user;

    const result = await action(filteredParams, { user, impersonatingUser, attributedUser });
    return serializeRsc(result);
  };
}
