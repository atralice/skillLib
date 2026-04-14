import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, apiListSuccess, unauthorized, validationError, conflict } from "@/lib/api/apiResponse";
import { CreateSkillSchema } from "@/lib/api/schemas/skill";
import { SearchSkillsSchema } from "@/lib/api/schemas/skill";

export async function POST(request: NextRequest) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  if (!user.username) {
    return validationError("You must set a username before publishing skills");
  }

  const body = await request.json();
  const parsed = CreateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid input", parsed.error.flatten());
  }

  const existing = await prisma.skill.findUnique({
    where: { ownerId_name: { ownerId: user.id, name: parsed.data.name } },
  });
  if (existing) {
    return conflict(`Skill "${parsed.data.name}" already exists`);
  }

  const skill = await prisma.skill.create({
    data: {
      name: parsed.data.name,
      displayName: parsed.data.displayName,
      description: parsed.data.description ?? "",
      visibility: parsed.data.visibility ?? "public",
      ownerId: user.id,
    },
  });

  return apiSuccess(skill, 201);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = SearchSkillsSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return validationError("Invalid search params", parsed.error.flatten());
  }

  const { q, page, perPage } = parsed.data;
  const skip = (page - 1) * perPage;

  const where = {
    visibility: "public" as const,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { displayName: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [skills, total] = await Promise.all([
    prisma.skill.findMany({
      where,
      include: {
        owner: { select: { username: true } },
        _count: { select: { installations: true, versions: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
    prisma.skill.count({ where }),
  ]);

  return apiListSuccess(skills, { page, perPage, total });
}
