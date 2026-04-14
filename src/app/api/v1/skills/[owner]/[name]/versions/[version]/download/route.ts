import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { apiSuccess, notFound } from "@/lib/api/apiResponse";

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
      files: { select: { path: true, content: true, size: true } },
    },
  });
  if (!skillVersion) return notFound("Version not found");

  return apiSuccess({
    skill: { name: skill.name, owner },
    version: skillVersion.version,
    status: skillVersion.status,
    files: skillVersion.files,
  });
}
