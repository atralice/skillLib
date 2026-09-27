import { homedir } from "node:os";
import { join } from "node:path";

/** The user's home folder; reads $HOME each time so tests (and odd setups) can redirect it. */
export function userHome(): string {
  return process.env.HOME || homedir();
}

/** Where skilllib keeps its state. Override with SKILLLIB_HOME. */
export function skilllibHome(): string {
  return process.env.SKILLLIB_HOME ?? join(userHome(), ".skilllib");
}

/** The skill library: one folder per skill. */
export function libraryDir(): string {
  return join(skilllibHome(), "library");
}

/** Claude Code's config dir, honoring CLAUDE_CONFIG_DIR like Claude Code does. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(userHome(), ".claude");
}

/** Where skilllib installs project skills; the folder Claude Code reads. */
export const PROJECT_SKILLS_DIR = ".claude/skills";
/** The cross-agent folder (Codex, Cursor, Amp, `npx skills`). Repos often commit their own skills here. */
export const AGENTS_SKILLS_DIR = ".agents/skills";
export const MANIFEST_FILE = "skilllib.json";
/** Marks the skill skilllib installs for agents, so it's reported as skilllib's own and not a global to clean up. */
export const OWN_SKILL_MARKER = ".managed-by-skilllib";
