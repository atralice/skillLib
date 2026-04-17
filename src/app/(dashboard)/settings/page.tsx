import getUser from "@/utils/loaders/server/user/getUser";
import hasSystemRole from "@/lib/user/hasSystemRole";
import Link from "next/link";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) return null;
  const isAdmin = hasSystemRole(user);

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-6 space-y-6">
        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold">Profile</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Name</p>
              <p>
                {user.firstName} {user.lastName}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Email</p>
              <p>{user.email}</p>
            </div>
            <div>
              <p className="text-gray-500">Username</p>
              <p>{user.username ?? "Not set"}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">API Keys</h2>
            <Link href="/settings/api-keys" className="text-sm text-blue-600 hover:underline">
              Manage keys
            </Link>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            API keys are used to authenticate the CLI tool.
          </p>
        </div>
        {isAdmin && (
          <div className="rounded-lg border bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Invite codes</h2>
              <Link href="/settings/invite-codes" className="text-sm text-blue-600 hover:underline">
                Manage invites
              </Link>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Create and manage invite codes for new users.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
