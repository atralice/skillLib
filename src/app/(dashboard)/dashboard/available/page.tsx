import Link from "next/link";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";
import accessibleSkillsWhere from "@/lib/skills/accessibleSkillsWhere";

export const dynamic = "force-dynamic";

function accessLabel(
  skill: { id: string; visibility: string; ownerId: string; teamId: string | null },
  userId: string,
  teamIds: Set<string>,
  grantedUserIds: Set<string>,
  grantedTeamIds: Set<string>,
): string {
  if (skill.ownerId === userId) return "Owned by you";
  if (skill.teamId && teamIds.has(skill.teamId)) return "Via your team";
  if (grantedUserIds.has(skill.id)) return "Granted to you";
  if (grantedTeamIds.has(skill.id)) return "Granted to your team";
  if (skill.visibility === "public") return "Public";
  return "Accessible";
}

export default async function AvailableSkillsPage() {
  const user = await getUser();
  if (!user) return null;

  const where = await accessibleSkillsWhere(user.id);

  const [skills, memberships] = await Promise.all([
    prisma.skill.findMany({
      where,
      include: {
        owner: { select: { username: true } },
        team: { select: { name: true, displayName: true } },
        versions: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { installations: true, versions: true } },
        grants: { where: { OR: [{ userId: user.id }] }, select: { skillId: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.teamMember.findMany({
      where: { userId: user.id },
      select: { teamId: true },
    }),
  ]);

  const teamIds = new Set(memberships.map((m) => m.teamId));
  const grantsToMe = await prisma.skillGrant.findMany({
    where: { userId: user.id },
    select: { skillId: true },
  });
  const grantsToMyTeams =
    teamIds.size > 0
      ? await prisma.skillGrant.findMany({
          where: { teamId: { in: Array.from(teamIds) } },
          select: { skillId: true },
        })
      : [];
  const grantedUserIds = new Set(grantsToMe.map((g) => g.skillId));
  const grantedTeamIds = new Set(grantsToMyTeams.map((g) => g.skillId));

  return (
    <div>
      <h1 className="text-2xl font-bold">Available skills</h1>
      <p className="mt-2 text-sm text-gray-500">
        Every skill you can install — public skills plus anything shared with you or your teams.
      </p>
      {skills.length === 0 ? (
        <p className="mt-8 text-center text-gray-400">No available skills yet.</p>
      ) : (
        <div className="mt-6 grid gap-4">
          {skills.map((skill) => {
            const latest = skill.versions[0];
            const label = accessLabel(skill, user.id, teamIds, grantedUserIds, grantedTeamIds);
            return (
              <Link
                key={skill.id}
                href={`/dashboard/skills/${skill.id}`}
                className="rounded-lg border bg-white p-4 hover:border-gray-400"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{skill.displayName}</h2>
                    <p className="text-xs text-gray-400">
                      <span>@{skill.owner.username ?? "anonymous"}/</span>
                      {skill.name}
                      {skill.team && (
                        <span className="ml-2 text-gray-500">· {skill.team.displayName}</span>
                      )}
                    </p>
                    {skill.description && (
                      <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">{label}</span>
                    </p>
                    <p className="mt-1">{latest ? `v${latest.version}` : "no versions"}</p>
                    <p>{skill._count.installations} installs</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
