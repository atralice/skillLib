import { existsSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import semver from "semver";
import { getToken } from "../lib/config.js";
import { post, get, ApiRequestError } from "../lib/client.js";
import { parseSkillMd, collectSkillFiles } from "../lib/skillParser.js";
import { success, error, info, warn } from "../lib/output.js";

type SkillResponse = {
  id: string;
  name: string;
  versions: { version: string }[];
};

type PublishResponse = {
  version: string;
  files: { path: string; size: number }[];
};

export async function publish(args: string[]) {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const dir = resolve(args[0] ?? ".");
  const skillMdPath = resolve(dir, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    error(`No SKILL.md found in ${dir}`);
    process.exit(1);
  }

  const skillMdContent = readFileSync(skillMdPath, "utf-8");
  const { frontmatter } = parseSkillMd(skillMdContent);

  const skillName = frontmatter.name ?? basename(dir);
  const description = (frontmatter.description as string) ?? "";

  // Get current user
  const { data: user } = await post<{ username: string | null }>("/auth/whoami");
  if (!user.username) {
    error("You must set a username in the web app before publishing");
    process.exit(1);
  }

  // Try to get existing skill to find latest version
  let latestVersion: string | null = null;
  try {
    const { data: skill } = await get<SkillResponse>(`/skills/${user.username}/${skillName}`);
    if (skill.versions.length > 0) {
      latestVersion = skill.versions[0]!.version;
    }
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.code !== "NOT_FOUND") {
      throw err;
    }
    // Skill doesn't exist yet — we'll create it below
  }

  // Determine version
  let version = args[1];
  if (!version) {
    const rl = createInterface({ input: stdin, output: stdout });
    const suggested = latestVersion ? semver.inc(latestVersion, "patch") : "1.0.0";
    version = await rl.question(
      `Version${latestVersion ? ` (current: ${latestVersion})` : ""} [${suggested}]: `,
    );
    rl.close();
    if (!version) version = suggested!;
  }

  if (!semver.valid(version)) {
    error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  // Create skill if it doesn't exist
  if (!latestVersion) {
    info(`Creating skill @${user.username}/${skillName}...`);
    try {
      await post("/skills", {
        name: skillName,
        displayName: frontmatter.name ?? skillName,
        description,
      });
    } catch (err) {
      if (!(err instanceof ApiRequestError) || err.code !== "CONFLICT") {
        throw err;
      }
      // Already exists — that's fine
    }
  }

  // Collect files
  const files = collectSkillFiles(dir);
  info(`Publishing @${user.username}/${skillName}@${version} (${files.length} files)...`);

  // Publish
  const { data: published } = await post<PublishResponse>(
    `/skills/${user.username}/${skillName}/versions`,
    {
      version,
      changelog: "",
      files: files.map((f) => ({ path: f.path, content: f.content })),
    },
  );

  success(`Published @${user.username}/${skillName}@${published.version}`);
  for (const file of published.files) {
    info(`  ${file.path} (${file.size} bytes)`);
  }
}
