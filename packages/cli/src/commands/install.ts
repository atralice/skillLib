import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { getToken } from "../lib/config.js";
import { post, get } from "../lib/client.js";
import { success, error, info } from "../lib/output.js";

type DownloadResponse = {
  skill: { name: string; owner: string };
  version: string;
  files: {
    path: string;
    size: number;
    sha256: string;
    contentType: string;
    url: string;
  }[];
};

type VersionInfo = {
  version: string;
};

function parseSkillRef(ref: string): { owner: string; name: string; version?: string } {
  // @owner/name@version or @owner/name
  const atVersionMatch = ref.match(/^@([^/]+)\/([^@]+)(?:@(.+))?$/);
  if (atVersionMatch) {
    return {
      owner: atVersionMatch[1]!,
      name: atVersionMatch[2]!,
      version: atVersionMatch[3],
    };
  }
  error(`Invalid skill reference: ${ref}. Use @owner/name or @owner/name@version`);
  process.exit(1);
}

export async function install(args: string[]) {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const ref = args[0];
  if (!ref) {
    // Install from skilllib.json
    return installFromConfig();
  }

  const { owner, name, version } = parseSkillRef(ref);
  const save = args.includes("--save");

  await installSkill(owner, name, version, save);
}

async function installSkill(
  owner: string,
  name: string,
  version: string | undefined,
  save: boolean,
) {
  // Resolve version
  let resolvedVersion = version;
  if (!resolvedVersion) {
    const { data: skill } = await get<{ versions: VersionInfo[] }>(`/skills/${owner}/${name}`);
    if (skill.versions.length === 0) {
      error("No published versions found");
      process.exit(1);
    }
    resolvedVersion = skill.versions[0]!.version;
  }

  info(`Installing @${owner}/${name}@${resolvedVersion}...`);

  // Download files
  const { data } = await get<DownloadResponse>(
    `/skills/${owner}/${name}/versions/${resolvedVersion}/download`,
  );

  // Write to .claude/skills/<name>/
  const skillDir = join(process.cwd(), ".claude", "skills", name);
  mkdirSync(skillDir, { recursive: true });

  for (const file of data.files) {
    const filePath = join(skillDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });

    const res = await fetch(file.url);
    if (!res.ok) {
      error(`Failed to download ${file.path}: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const actualSha = createHash("sha256").update(buf).digest("hex");
    if (actualSha !== file.sha256) {
      error(`Hash mismatch for ${file.path}: expected ${file.sha256}, got ${actualSha}`);
      process.exit(1);
    }

    writeFileSync(filePath, buf);
  }

  // Record installation on server
  await post("/installations", {
    owner,
    name,
    versionConstraint: version ? version : `^${resolvedVersion}`,
  });

  // Save to skilllib.json if requested
  if (save) {
    saveToConfig(owner, name, version ? version : `^${resolvedVersion}`);
  }

  success(`Installed @${owner}/${name}@${resolvedVersion} → .claude/skills/${name}/`);
}

async function installFromConfig() {
  const configPath = join(process.cwd(), "skilllib.json");
  if (!existsSync(configPath)) {
    error("No skill reference provided and no skilllib.json found. Run: skilllib init");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const skills = config.skills as Record<string, string> | undefined;
  if (!skills || Object.keys(skills).length === 0) {
    info("No skills in skilllib.json");
    return;
  }

  for (const [ref, _constraint] of Object.entries(skills)) {
    const parsed = ref.match(/^@([^/]+)\/(.+)$/);
    if (!parsed) {
      error(`Invalid skill reference in skilllib.json: ${ref}`);
      continue;
    }
    await installSkill(parsed[1]!, parsed[2]!, undefined, false);
  }
}

function saveToConfig(owner: string, name: string, constraint: string) {
  const configPath = join(process.cwd(), "skilllib.json");
  let config: { skills: Record<string, string> } = { skills: {} };
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  }
  config.skills[`@${owner}/${name}`] = constraint;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  info("  Updated skilllib.json");
}
