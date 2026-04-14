import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { getToken } from "../lib/config.js";
import { get, post } from "../lib/client.js";
import { success, error, info, warn } from "../lib/output.js";

type InstallationItem = {
  id: string;
  skill: { id: string; name: string; owner: string };
  version: string;
  versionConstraint: string;
};

type UpdateItem = {
  skillId: string;
  currentVersion: string;
  latestVersion: string;
};

type DownloadResponse = {
  skill: { name: string; owner: string };
  version: string;
  files: { path: string; content: string }[];
};

export async function update(args: string[]) {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const { data: installations } = await get<InstallationItem[]>("/installations");

  if (installations.length === 0) {
    info("No installed skills");
    return;
  }

  // Check for updates
  const { data: updates } = await post<UpdateItem[]>("/installations/check-updates", {
    installations: installations.map((i) => ({
      skillId: i.skill.id,
      currentVersion: i.version,
      versionConstraint: i.versionConstraint,
    })),
  });

  if (updates.length === 0) {
    success("All skills are up to date");
    return;
  }

  for (const update of updates) {
    const installation = installations.find((i) => i.skill.id === update.skillId);
    if (!installation) continue;

    const { owner, name } = installation.skill;

    info(`Updating @${owner}/${name} ${update.currentVersion} → ${update.latestVersion}...`);

    const { data } = await get<DownloadResponse>(
      `/skills/${owner}/${name}/versions/${update.latestVersion}/download`,
    );

    const skillDir = join(process.cwd(), ".claude", "skills", name);
    mkdirSync(skillDir, { recursive: true });

    for (const file of data.files) {
      const filePath = join(skillDir, file.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content);
    }

    // Update installation record
    await post("/installations", {
      owner,
      name,
      versionConstraint: installation.versionConstraint,
    });

    success(`Updated @${owner}/${name} to ${update.latestVersion}`);
  }
}
