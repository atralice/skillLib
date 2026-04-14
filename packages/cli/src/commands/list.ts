import { getToken } from "../lib/config.js";
import { get } from "../lib/client.js";
import { info, error, table } from "../lib/output.js";

type InstallationItem = {
  skill: { name: string; owner: string };
  version: string;
  versionConstraint: string;
};

export async function list() {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const { data: installations } = await get<InstallationItem[]>("/installations");

  if (installations.length === 0) {
    info("No installed skills");
    return;
  }

  table(
    installations.map((i) => ({
      Skill: `@${i.skill.owner}/${i.skill.name}`,
      Version: i.version,
      Constraint: i.versionConstraint,
    })),
  );
}
