import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { apiSuccess, notFound } from "@/lib/api/apiResponse";
import { getPresignedDownloadUrl } from "@/lib/blob";

const PRESIGN_EXPIRES_IN_SECONDS = 3600;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> },
) {
  const { owner, name, version } = await params;

  const ownerUser = await prisma.user.findUnique({
    where: { username: owner },
    select: { id: true },
  });
  if (!ownerUser) return notFound("User not found");

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: ownerUser.id, name } },
  });
  if (!skill || skill.visibility === "private") return notFound("Skill not found");

  const skillVersion = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version } },
    include: {
      files: {
        select: { path: true, size: true, sha256: true, contentType: true },
      },
    },
  });
  if (!skillVersion) return notFound("Version not found");

  const files = await Promise.all(
    skillVersion.files.map(async (f) => ({
      path: f.path,
      size: f.size,
      sha256: f.sha256,
      contentType: f.contentType,
      url: await getPresignedDownloadUrl(
        f.sha256,
        f.path.split("/").pop() ?? "file",
        f.contentType,
        PRESIGN_EXPIRES_IN_SECONDS,
      ),
    })),
  );

  return apiSuccess({
    skill: { name: skill.name, owner },
    version: skillVersion.version,
    status: skillVersion.status,
    expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    files,
  });
}
