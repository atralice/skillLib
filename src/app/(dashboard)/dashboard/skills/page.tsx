import Link from "next/link";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";

export const dynamic = "force-dynamic";

export default async function MySkillsPage() {
  const user = await getUser();
  if (!user) return null;

  const skills = await prisma.skill.findMany({
    where: { ownerId: user.id },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { installations: true, versions: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">My Skills</h1>
      <p className="mt-2 text-sm text-gray-500">
        Skills you own. Click a skill to see its versions and files.
      </p>
      {skills.length === 0 ? (
        <p className="mt-8 text-center text-gray-400">
          You haven&apos;t published any skills yet. Use the CLI to publish one.
        </p>
      ) : (
        <div className="mt-6 grid gap-4">
          {skills.map((skill) => {
            const latest = skill.versions[0];
            return (
              <Link
                key={skill.id}
                href={`/dashboard/skills/${skill.id}`}
                className="rounded-lg border bg-white p-4 hover:border-gray-400"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{skill.displayName}</h2>
                    <p className="text-xs text-gray-400">{skill.name}</p>
                    {skill.description && (
                      <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                        {skill.visibility}
                      </span>
                    </p>
                    <p className="mt-1">{latest ? `v${latest.version}` : "no versions"}</p>
                    <p className="mt-1">
                      {skill._count.versions} version{skill._count.versions === 1 ? "" : "s"}
                    </p>
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
