import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const skills = await prisma.skill.findMany({
    where: { visibility: "public" },
    include: {
      owner: { select: { username: true, firstName: true, lastName: true } },
      _count: { select: { installations: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Explore Skills</h1>
      <p className="mt-2 text-gray-600">Browse published skills from the community.</p>
      {skills.length === 0 ? (
        <p className="mt-8 text-center text-gray-400">No skills published yet.</p>
      ) : (
        <div className="mt-6 grid gap-4">
          {skills.map((skill) => (
            <div key={skill.id} className="rounded-lg border bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold">
                    <span className="text-gray-400">@{skill.owner.username ?? "anonymous"}/</span>
                    {skill.name}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {skill.description || skill.displayName}
                  </p>
                </div>
                <span className="text-xs text-gray-400">{skill._count.installations} installs</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
