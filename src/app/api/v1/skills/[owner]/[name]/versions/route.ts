import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import {
  apiSuccess,
  unauthorized,
  validationError,
  notFound,
  forbidden,
  conflict,
} from "@/lib/api/apiResponse";
import { PublishVersionSchema } from "@/lib/api/schemas/skillVersion";
import { ensureBucket, putBlob } from "@/lib/blob";
import { contentTypeForPath } from "@/lib/mime";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  const { owner, name } = await params;

  if (user.username !== owner) {
    return forbidden("You can only publish to your own skills");
  }

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: user.id, name } },
  });
  if (!skill) return notFound("Skill not found. Create it first via POST /api/v1/skills");

  const body = await request.json();
  const parsed = PublishVersionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid input", parsed.error.flatten());
  }

  const { version, changelog, files } = parsed.data;

  const existingVersion = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version } },
  });
  if (existingVersion) {
    return conflict(`Version ${version} already exists`);
  }

  await ensureBucket();

  const uploadedFiles = await Promise.all(
    files.map(async (f) => {
      const contentType = contentTypeForPath(f.path);
      const { sha256, size } = await putBlob(f.content, contentType);
      return { path: f.path, sha256, size, contentType };
    }),
  );

  const skillVersion = await prisma.skillVersion.create({
    data: {
      skillId: skill.id,
      version,
      status: "published",
      changelog: changelog ?? "",
      publishedAt: new Date(),
      files: {
        create: uploadedFiles,
      },
    },
    include: {
      files: { select: { path: true, size: true, sha256: true, contentType: true } },
    },
  });

  return apiSuccess(
    {
      id: skillVersion.id,
      version: skillVersion.version,
      status: skillVersion.status,
      changelog: skillVersion.changelog,
      publishedAt: skillVersion.publishedAt,
      files: skillVersion.files,
    },
    201,
  );
}
