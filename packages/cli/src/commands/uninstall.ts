import { rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getToken } from "../lib/config.js";
import { get, del } from "../lib/client.js";
import { success, error, info } from "../lib/output.js";

type InstallationItem = {
  skill: { id: string; name: string; owner: string };
};

export async function uninstall(args: string[]) {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const ref = args[0];
  if (!ref) {
    error("Usage: skilllib uninstall @owner/name");
    process.exit(1);
  }

  const parsed = ref.match(/^@([^/]+)\/(.+)$/);
  if (!parsed) {
    error(`Invalid skill reference: ${ref}`);
    process.exit(1);
  }

  const [, owner, name] = parsed;

  // Find installation to get skillId
  const { data: installations } = await get<InstallationItem[]>("/installations");
  const installation = installations.find(
    (i) => i.skill.owner === owner && i.skill.name === name,
  );

  if (installation) {
    await del(`/installations/${installation.skill.id}`);
  }

  // Remove local files
  const skillDir = join(process.cwd(), ".claude", "skills", name!);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
  }

  // Remove from skilllib.json
  const configPath = join(process.cwd(), "skilllib.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.skills) {
      delete config.skills[`@${owner}/${name}`];
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    }
  }

  success(`Uninstalled @${owner}/${name}`);
}
