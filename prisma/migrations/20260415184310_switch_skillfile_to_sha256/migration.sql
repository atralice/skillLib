/*
  Warnings:

  - You are about to drop the column `content` on the `SkillFile` table. All the data in the column will be lost.
  - Added the required column `sha256` to the `SkillFile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SkillFile" DROP COLUMN "content",
ADD COLUMN     "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "sha256" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "SkillFile_sha256_idx" ON "SkillFile"("sha256");
