import Link from "next/link";
import getUser from "@/utils/loaders/server/user/getUser";
import SignOutButton from "@/components/SignOutButton";
import hasSystemRole from "@/lib/user/hasSystemRole";

export default async function TopNav() {
  const user = await getUser();

  return (
    <nav className="border-b bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href={user ? "/dashboard" : "/"} className="text-xl font-bold">
            skillLib
          </Link>
          <div className="flex gap-4">
            {user ? (
              <>
                <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/skills"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  My Skills
                </Link>
                <Link href="/dashboard/teams" className="text-sm text-gray-600 hover:text-gray-900">
                  Teams
                </Link>
                <Link href="/skills" className="text-sm text-gray-600 hover:text-gray-900">
                  Browse
                </Link>
                <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900">
                  Settings
                </Link>
                {hasSystemRole(user) && (
                  <Link
                    href="/settings/invite-codes"
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    Invites
                  </Link>
                )}
              </>
            ) : (
              <Link href="/skills" className="text-sm text-gray-600 hover:text-gray-900">
                Skills
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-gray-500">
                {user.firstName} {user.lastName}
              </span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
