import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, unauthorized, validationError, notFound } from "@/lib/api/apiResponse";
import { InstallSkillSchema } from "@/lib/api/schemas/installation";

export async function GET(request: NextRequest) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  const installations = await prisma.installation.findMany({
    where: { userId: user.id },
    include: {
      skill: {
        include: {
          owner: { select: { username: true } },
        },
      },
      skillVersion: {
        select: { version: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess(
    installations.map((i) => ({
      id: i.id,
      skill: {
        id: i.skill.id,
        name: i.skill.name,
        displayName: i.skill.displayName,
        owner: i.skill.owner.username,
      },
      version: i.skillVersion.version,
      versionStatus: i.skillVersion.status,
      versionConstraint: i.versionConstraint,
      installedAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
  );
}

export async function POST(request: NextRequest) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = InstallSkillSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid input", parsed.error.flatten());
  }

  const { owner, name, versionConstraint } = parsed.data;

  const ownerUser = await prisma.user.findUnique({
    where: { username: owner },
    select: { id: true },
  });
  if (!ownerUser) return notFound("User not found");

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: ownerUser.id, name } },
  });
  if (!skill) return notFound("Skill not found");

  // Resolve to latest published version
  const latestVersion = await prisma.skillVersion.findFirst({
    where: { skillId: skill.id, status: "published" },
    orderBy: { createdAt: "desc" },
  });
  if (!latestVersion) return notFound("No published version found");

  const installation = await prisma.installation.upsert({
    where: { userId_skillId: { userId: user.id, skillId: skill.id } },
    create: {
      userId: user.id,
      skillId: skill.id,
      skillVersionId: latestVersion.id,
      versionConstraint,
    },
    update: {
      skillVersionId: latestVersion.id,
      versionConstraint,
    },
  });

  return apiSuccess(
    {
      id: installation.id,
      skillId: skill.id,
      version: latestVersion.version,
      versionConstraint: installation.versionConstraint,
    },
    201,
  );
}
