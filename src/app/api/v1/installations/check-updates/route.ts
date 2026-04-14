import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authenticateApiKey } from "@/lib/api/authenticateApiKey";
import { apiSuccess, unauthorized, validationError } from "@/lib/api/apiResponse";
import { CheckUpdatesSchema } from "@/lib/api/schemas/installation";

export async function POST(request: NextRequest) {
  const user = await authenticateApiKey(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const parsed = CheckUpdatesSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid input", parsed.error.flatten());
  }

  const updates = await Promise.all(
    parsed.data.installations.map(async (inst) => {
      const latestVersion = await prisma.skillVersion.findFirst({
        where: { skillId: inst.skillId, status: "published" },
        orderBy: { createdAt: "desc" },
        select: { version: true },
      });

      if (!latestVersion || latestVersion.version === inst.currentVersion) {
        return null;
      }

      return {
        skillId: inst.skillId,
        currentVersion: inst.currentVersion,
        latestVersion: latestVersion.version,
      };
    }),
  );

  return apiSuccess(updates.filter(Boolean));
}
