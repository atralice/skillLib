import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { apiSuccess, notFound } from "@/lib/api/apiResponse";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params;

  const ownerUser = await prisma.user.findUnique({
    where: { username: owner },
    select: { id: true },
  });
  if (!ownerUser) return notFound("User not found");

  const skill = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: ownerUser.id, name } },
    include: {
      owner: { select: { username: true, firstName: true, lastName: true } },
      versions: {
        where: { status: { not: "draft" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          changelog: true,
          publishedAt: true,
          createdAt: true,
        },
      },
      _count: { select: { installations: true } },
    },
  });

  if (!skill) return notFound("Skill not found");
  if (skill.visibility === "private") return notFound("Skill not found");

  return apiSuccess(skill);
}
