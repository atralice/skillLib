import Link from "next/link";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";
import TeamCreateForm from "@/components/TeamCreateForm";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await getUser();
  if (!user) return null;

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    include: {
      team: {
        include: {
          _count: { select: { members: true, skills: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Teams</h1>
      <p className="mt-2 text-sm text-gray-500">Teams let you share private skills with a group.</p>
      <div className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Create a team</h2>
        <TeamCreateForm />
      </div>

      <div className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Your teams</h2>
        {memberships.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">You&apos;re not on any teams yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Team</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Members</th>
                <th className="pb-2 font-medium">Skills</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-semibold">{m.team.displayName}</p>
                    <p className="text-xs text-gray-400">{m.team.name}</p>
                  </td>
                  <td className="py-2 text-gray-500">{m.role}</td>
                  <td className="py-2 text-gray-500">{m.team._count.members}</td>
                  <td className="py-2 text-gray-500">{m.team._count.skills}</td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/dashboard/teams/${m.team.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
