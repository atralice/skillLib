import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";
import SkillHeader from "@/components/SkillViewer/SkillHeader";
import SkillVersionSelector from "@/components/SkillViewer/SkillVersionSelector";
import SkillContent from "@/components/SkillViewer/SkillContent";
import SkillContentLoading from "@/components/SkillViewer/SkillContentLoading";
import SkillAccess from "@/components/SkillViewer/SkillAccess";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ version?: string }>;

type RouteParams = Promise<{ id: string }>;

export default async function SkillDetailPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const user = await getUser();
  if (!user) return null;

  const { id } = await params;
  const { version: versionParam } = await searchParams;

  const [skill, teamMemberships] = await Promise.all([
    prisma.skill.findUnique({
      where: { id },
      include: {
        owner: { select: { username: true } },
        _count: { select: { installations: true } },
        versions: {
          orderBy: { createdAt: "desc" },
          include: {
            files: {
              orderBy: { path: "asc" },
            },
          },
        },
        grants: {
          include: {
            user: { select: { username: true, firstName: true, lastName: true } },
            team: { select: { name: true, displayName: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.teamMember.findMany({
      where: { userId: user.id },
      include: { team: { select: { id: true, name: true, displayName: true } } },
    }),
  ]);

  if (!skill) notFound();

  const isOwner = skill.ownerId === user.id;
  const userTeamIds = new Set(teamMemberships.map((m) => m.team.id));

  const hasAccess =
    isOwner ||
    skill.visibility === "public" ||
    (skill.teamId !== null && userTeamIds.has(skill.teamId)) ||
    skill.grants.some(
      (g) =>
        g.userId === user.id || (g.teamId !== null && userTeamIds.has(g.teamId)),
    );

  if (!hasAccess) notFound();

  const fallbackVersion =
    skill.versions.find((v) => v.status === "published") ?? skill.versions[0];

  const preferredVersion = versionParam
    ? (skill.versions.find((v) => v.version === versionParam) ?? fallbackVersion)
    : fallbackVersion;

  if (!preferredVersion) {
    return (
      <div>
        <Link href="/dashboard/skills" className="text-sm text-gray-500 hover:underline">
          ← My Skills
        </Link>
        <h1 className="mt-4 text-2xl font-bold">{skill.displayName}</h1>
        <p className="mt-4 text-sm text-gray-500">
          This skill has no versions yet. Publish one with the CLI.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link href="/dashboard/skills" className="text-sm text-gray-500 hover:underline">
        ← My Skills
      </Link>
      <div className="mt-4 space-y-6">
        <SkillHeader
          displayName={skill.displayName}
          ownerUsername={skill.owner.username}
          name={skill.name}
          description={skill.description}
          visibility={skill.visibility}
          installCount={skill._count.installations}
        />
        <SkillVersionSelector
          skillId={skill.id}
          versions={skill.versions.map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            publishedAt: v.publishedAt,
          }))}
          selectedVersion={preferredVersion.version}
        />
        <Suspense key={preferredVersion.id} fallback={<SkillContentLoading />}>
          <SkillContent versionFiles={preferredVersion.files} />
        </Suspense>
        {isOwner && (
          <SkillAccess
            skillId={skill.id}
            visibility={skill.visibility}
            grants={skill.grants.map((g) => ({
              id: g.id,
              user: g.user,
              team: g.team,
            }))}
            ownedTeams={teamMemberships
              .filter((m) => m.role === "owner" || m.role === "admin")
              .map((m) => m.team)}
          />
        )}
      </div>
    </div>
  );
}
