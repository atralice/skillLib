import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import getUser from "@/utils/loaders/server/user/getUser";
import { getBlobContent, getPresignedDownloadUrl } from "@/lib/blob";
import { parseSkillMd } from "@/lib/skills/parseSkillMd";
import isTextContentType from "@/lib/skills/isTextContentType";
import SkillViewer from "@/components/SkillViewer/SkillViewer";

export const dynamic = "force-dynamic";

const MAX_INLINE_BYTES = 256 * 1024;

type SearchParams = Promise<{ version?: string }>;

type RouteParams = Promise<{ name: string }>;

export default async function SkillDetailPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const user = await getUser();
  if (!user) return null;

  const { name } = await params;
  const { version: versionParam } = await searchParams;

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: user.id, name } },
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
    },
  });

  if (!skill) notFound();

  const fallbackVersion = skill.versions.find((v) => v.status === "published") ?? skill.versions[0];

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

  const versionFiles = preferredVersion.files;
  const skillMdFile = versionFiles.find(
    (f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"),
  );

  const fileEntries = await Promise.all(
    versionFiles.map(async (f) => {
      const downloadUrl = await getPresignedDownloadUrl(
        f.sha256,
        f.path.split("/").pop() ?? f.path,
        f.contentType,
      );
      let content: string | null = null;
      let truncated = false;
      if (isTextContentType(f.contentType)) {
        const buf = await getBlobContent(f.sha256);
        if (buf.byteLength > MAX_INLINE_BYTES) {
          content = buf.subarray(0, MAX_INLINE_BYTES).toString("utf8");
          truncated = true;
        } else {
          content = buf.toString("utf8");
        }
      }
      return {
        path: f.path,
        sha256: f.sha256,
        size: f.size,
        contentType: f.contentType,
        downloadUrl,
        content,
        truncated,
      };
    }),
  );

  fileEntries.sort((a, b) => {
    if (a.path === "SKILL.md") return -1;
    if (b.path === "SKILL.md") return 1;
    return a.path.localeCompare(b.path);
  });

  const skillMdContent = skillMdFile
    ? (fileEntries.find((f) => f.path === skillMdFile.path)?.content ?? null)
    : null;
  const skillMd = skillMdContent ? parseSkillMd(skillMdContent) : null;

  return (
    <div>
      <Link href="/dashboard/skills" className="text-sm text-gray-500 hover:underline">
        ← My Skills
      </Link>
      <div className="mt-4">
        <SkillViewer
          skill={{
            name: skill.name,
            displayName: skill.displayName,
            description: skill.description,
            visibility: skill.visibility,
            ownerUsername: skill.owner.username,
            installCount: skill._count.installations,
          }}
          versions={skill.versions.map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            publishedAt: v.publishedAt,
          }))}
          selectedVersion={preferredVersion.version}
          skillMd={skillMd}
          files={fileEntries}
        />
      </div>
    </div>
  );
}
