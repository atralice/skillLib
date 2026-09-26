import { homedir } from "node:os";
import { join } from "node:path";

/** Where skilllib keeps its state. Override with SKILLLIB_HOME. */
export function skilllibHome(): string {
  return process.env.SKILLLIB_HOME ?? join(homedir(), ".skilllib");
}

/** The skill library: one folder per skill. */
export function libraryDir(): string {
  return join(skilllibHome(), "library");
}

/** Claude Code's config dir, honoring CLAUDE_CONFIG_DIR like Claude Code does. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

export const PROJECT_SKILLS_DIR = join(".claude", "skills");
export const MANIFEST_FILE = "skilllib.json";
