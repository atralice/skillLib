import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";
import TeamMembersManager from "@/components/TeamMembersManager";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return null;
  const { id } = await params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, username: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      skills: {
        select: { id: true, name: true, displayName: true, visibility: true },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!team) notFound();

  const callerMembership = team.members.find((m) => m.userId === user.id);
  if (!callerMembership) notFound();

  return (
    <div>
      <Link href="/dashboard/teams" className="text-sm text-gray-500 hover:underline">
        ← Teams
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{team.displayName}</h1>
      <p className="text-sm text-gray-400">{team.name}</p>

      <TeamMembersManager
        teamId={team.id}
        callerRole={callerMembership.role}
        currentUserId={user.id}
        members={team.members.map((m) => ({
          id: m.id,
          role: m.role,
          user: m.user,
        }))}
      />

      <div className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Team skills</h2>
        {team.skills.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">This team doesn&apos;t own any skills yet.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {team.skills.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link href={`/dashboard/skills/${s.id}`} className="font-medium hover:underline">
                    {s.displayName}
                  </Link>
                  <p className="text-xs text-gray-400">{s.name}</p>
                </div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {s.visibility}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
