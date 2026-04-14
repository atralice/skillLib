import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, notFound, forbidden, validationError } from "@/lib/api/apiResponse";

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
      files: { select: { path: true, size: true } },
    },
  });
  if (!skillVersion) return notFound("Version not found");

  return apiSuccess({
    id: skillVersion.id,
    version: skillVersion.version,
    status: skillVersion.status,
    changelog: skillVersion.changelog,
    publishedAt: skillVersion.publishedAt,
    files: skillVersion.files,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string; version: string }> },
) {
  const user = await authenticateApiKey(request);
  if (!user) return forbidden();

  const { owner, name, version } = await params;

  if (user.username !== owner) {
    return forbidden("You can only modify your own skills");
  }

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: user.id, name } },
  });
  if (!skill) return notFound("Skill not found");

  const skillVersion = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version } },
  });
  if (!skillVersion) return notFound("Version not found");

  const body = await request.json();
  const status = body.status;

  if (status !== "yanked" && status !== "published") {
    return validationError("Status must be 'yanked' or 'published'");
  }

  if (skillVersion.status === "draft") {
    return validationError("Cannot yank a draft version");
  }

  const updated = await prisma.skillVersion.update({
    where: { id: skillVersion.id },
    data: { status },
  });

  return apiSuccess({ id: updated.id, version: updated.version, status: updated.status });
}
