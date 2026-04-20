"use server";

import createServerAction from "@/lib/serverActions/createServerAction";
import { serverActionError } from "@/lib/serverActions/serverActionError";
import prisma from "@/lib/prisma";
import { GrantSkillAccessSchema } from "./grantSkillAccessSchema";
import type { GrantSkillAccessInput } from "./grantSkillAccessSchema";

const grantSkillAccessServerAction = createServerAction(
  async (input: GrantSkillAccessInput, { user }) => {
    const skill = await prisma.skill.findUnique({ where: { id: input.skillId } });
    if (!skill) {
      throw new Error("Skill not found");
    }
    if (skill.ownerId !== user.id) {
      throw new Error("Only the skill owner can grant access");
    }

    if (input.username) {
      const target = await prisma.user.findUnique({
        where: { username: input.username },
      });
      if (!target) {
        return serverActionError({
          fieldErrors: { username: ["No user with that username"] },
        });
      }
      if (target.id === user.id) {
        return serverActionError({
          fieldErrors: { username: ["You already own this skill"] },
        });
      }

      const existing = await prisma.skillGrant.findUnique({
        where: { skillId_userId: { skillId: input.skillId, userId: target.id } },
      });
      if (existing) {
        return serverActionError({
          fieldErrors: { username: ["User already has access"] },
        });
      }

      await prisma.skillGrant.create({
        data: {
          skillId: input.skillId,
          userId: target.id,
          grantedById: user.id,
        },
      });
      return { success: true };
    }

    if (input.teamId) {
      const team = await prisma.team.findUnique({ where: { id: input.teamId } });
      if (!team) {
        return serverActionError({
          fieldErrors: { teamId: ["Team not found"] },
        });
      }

      const existing = await prisma.skillGrant.findUnique({
        where: { skillId_teamId: { skillId: input.skillId, teamId: input.teamId } },
      });
      if (existing) {
        return serverActionError({
          fieldErrors: { teamId: ["Team already has access"] },
        });
      }

      await prisma.skillGrant.create({
        data: {
          skillId: input.skillId,
          teamId: input.teamId,
          grantedById: user.id,
        },
      });
      return { success: true };
    }

    throw new Error("Must provide username or teamId");
  },
  {
    filterInput: (input) => GrantSkillAccessSchema.parse(input),
    authorize: async () => true,
  },
);

export default grantSkillAccessServerAction;
