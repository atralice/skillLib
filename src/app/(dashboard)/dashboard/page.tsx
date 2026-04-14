import getUser from "@/utils/loaders/server/user/getUser";
import prisma from "@/lib/prisma";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) return null;

  const [skillCount, installationCount] = await Promise.all([
    prisma.skill.count({ where: { ownerId: user.id } }),
    prisma.installation.count({ where: { userId: user.id } }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Published skills</p>
          <p className="mt-1 text-3xl font-bold">{skillCount}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Installed skills</p>
          <p className="mt-1 text-3xl font-bold">{installationCount}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Username</p>
          <p className="mt-1 text-lg font-medium">{user.username ?? "Not set"}</p>
          {!user.username && (
            <Link href="/settings" className="mt-1 text-sm text-blue-600 hover:underline">
              Set username to publish
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
