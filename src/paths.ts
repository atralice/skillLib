import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The user's home folder; reads $HOME each time so tests (and odd setups) can redirect it. */
export function userHome(): string {
  return process.env.HOME || homedir();
}

/** A path with its symlinks resolved (e.g. macOS /var → /private/var), or as given when it doesn't exist. */
export function realPath(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
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

/** Grok's config dir, honoring GROK_HOME like Grok does (it treats an empty one as unset). */
export function grokDir(): string {
  return process.env.GROK_HOME?.trim() || join(userHome(), ".grok");
}

/** Codex's config dir, honoring CODEX_HOME like Codex does (it treats an empty one as unset). */
export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(userHome(), ".codex");
}

/** Codex's machine-wide skill folder. SKILLLIB_CODEX_SYSTEM_DIR redirects it (tests). */
export function codexSystemDir(): string {
  return process.env.SKILLLIB_CODEX_SYSTEM_DIR ?? "/etc/codex/skills";
}

/** Where skilllib installs project skills; the folder Claude Code reads. */
export const PROJECT_SKILLS_DIR = ".claude/skills";
/** The cross-agent folder (Codex, Cursor, Zed, Grok, `npx skills`). Repos often commit their own skills here. */
export const AGENTS_SKILLS_DIR = ".agents/skills";
/** Grok's own project folder. Grok's docs say to commit team skills here. skilllib discovers it and does not rewrite it. */
export const GROK_SKILLS_DIR = ".grok/skills";
export const MANIFEST_FILE = "skilllib.json";

/** Folders a repo owns. skilllib can copy these into the library; it doesn't take them over. */
export function isRepoSkillLocation(location: string): boolean {
  return location === AGENTS_SKILLS_DIR || location === GROK_SKILLS_DIR;
}

/** Marks the skill skilllib installs for agents, so it's reported as skilllib's own and not a global to clean up. */
export const OWN_SKILL_MARKER = ".managed-by-skilllib";
