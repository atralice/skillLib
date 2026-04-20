-- CreateTable
CREATE TABLE "SkillGrant" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillGrant_userId_idx" ON "SkillGrant"("userId");

-- CreateIndex
CREATE INDEX "SkillGrant_teamId_idx" ON "SkillGrant"("teamId");

-- CreateIndex
CREATE INDEX "SkillGrant_skillId_idx" ON "SkillGrant"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillGrant_skillId_userId_key" ON "SkillGrant"("skillId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillGrant_skillId_teamId_key" ON "SkillGrant"("skillId", "teamId");

-- AddForeignKey
ALTER TABLE "SkillGrant" ADD CONSTRAINT "SkillGrant_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillGrant" ADD CONSTRAINT "SkillGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillGrant" ADD CONSTRAINT "SkillGrant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillGrant" ADD CONSTRAINT "SkillGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
