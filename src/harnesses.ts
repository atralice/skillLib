import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, codexHome, codexSystemDir, grokDir, PROJECT_SKILLS_DIR, userHome } from "./paths.js";

export type HarnessId = "claude-code" | "cursor" | "codex" | "zed" | "grok";

export type Harness = {
  id: HarnessId;
  name: string;
  /** Two-letter tag, for plain-text output. */
  short: string;
  /** Brand-ish glyph and color for the TUI (terminals can't show real logos). */
  icon: string;
  color: string;
  /** Project folders (relative to the project root) this harness loads skills from. */
  projectDirs: string[];
  /** Global folders it loads skills from, in every project. */
  globalDirs: () => string[];
  installed: () => boolean;
};

const home = userHome;

/**
 * Where each harness reads skills, from their docs (September 2026):
 * - Claude Code: .claude/skills, ~/.claude/skills (verified: it ignores .agents/skills)
 * - Cursor (cursor.com/docs/context/skills): .agents, .cursor, and for compatibility
 *   .claude, .codex and .grok skill folders, in the project and in your home folder.
 *   skilllib still doesn't link or tidy .grok/skills for Cursor: that folder is where a
 *   team commits Grok skills, and Grok is its own harness. Verified in Cursor's app
 *   bundle (3.22, October 2026): it finds every SKILL.md in those folders up to 10
 *   levels deep (skipping dot folders), so it also loads the claude.ai skills in
 *   ~/.claude/skills/synced. The same skill in several folders loads once, from the
 *   first of .cursor, .claude, .codex, .grok, .agents (CURSOR_PICKS). Its third-party
 *   setting (on by default) gates .claude/.codex/.grok and also imports enabled
 *   Claude Code plugins.
 * - Codex (learn.chatgpt.com/docs/build-skills, and codex-rs/ext/skills/src/host_roots.rs):
 *   .agents/skills from the working folder up to the repo root, .codex/skills, ~/.agents/skills,
 *   /etc/codex/skills, and $CODEX_HOME/skills (~/.codex/skills). The docs dropped that last one,
 *   but Codex still reads it ("deprecated, kept for backward compatibility") and its
 *   skill-installer writes there. Its bundled skills live in ~/.codex/skills/.system.
 * - Zed (zed.dev/docs/ai/skills): <worktree>/.agents/skills and ~/.agents/skills only
 * - Grok (user guide, Skills; checked with `grok inspect` on 1.0.41): .grok/skills and
 *   .agents/skills from the working folder up to the repo root, plus ~/.grok/skills
 *   (GROK_HOME) and ~/.agents/skills. By default it also reads .claude/skills,
 *   ~/.claude/skills, .cursor/skills and ~/.cursor/skills. Same name once: a project
 *   folder beats a home folder, and inside each the order is .grok, .agents, .claude,
 *   .cursor. It does not read .codex/skills, and it ignores CLAUDE_CONFIG_DIR.
 *   compat.codex.skills does not enable .codex discovery. Bundled skills live in
 *   ~/.grok/bundled/skills.
 */
export const HARNESSES: Harness[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    short: "CC",
    icon: "✻",
    color: "#D97757",
    projectDirs: [".claude/skills"],
    globalDirs: () => [join(claudeDir(), "skills")],
    installed: () => existsSync(claudeDir()) || onPath("claude") || hasApp("Claude"),
  },
  {
    id: "cursor",
    name: "Cursor",
    short: "Cu",
    icon: "⬡",
    color: "#E8E8E8",
    // The first folder is where links for Cursor go (see linkEverywhere). Cursor also reads .grok/skills;
    // skilllib leaves that folder alone (see Grok). A .grok-only skill stays invisible to Cursor here.
    projectDirs: [".agents/skills", ".cursor/skills", ".claude/skills", ".codex/skills"],
    // Cursor ignores CLAUDE_CONFIG_DIR and CODEX_HOME: it always reads these under your home folder.
    globalDirs: () => [".agents", ".cursor", ".claude", ".codex"].map((d) => join(home(), d, "skills")),
    installed: () => existsSync(join(home(), ".cursor")) || onPath("cursor-agent") || hasApp("Cursor"),
  },
  {
    id: "codex",
    name: "Codex",
    short: "Cx",
    icon: "◎",
    color: "#10A37F",
    projectDirs: [".agents/skills", ".codex/skills"],
    globalDirs: () => [join(home(), ".agents", "skills"), join(codexHome(), "skills"), codexSystemDir()],
    installed: () => existsSync(codexHome()) || onPath("codex") || hasApp("Codex"),
  },
  {
    id: "zed",
    name: "Zed",
    short: "Zd",
    icon: "ℤ",
    color: "#4A9EFF",
    projectDirs: [".agents/skills"],
    globalDirs: () => [join(home(), ".agents", "skills")],
    installed: () => existsSync(join(home(), ".config", "zed")) || onPath("zed") || hasApp("Zed"),
  },
  {
    id: "grok",
    name: "Grok",
    short: "Gk",
    icon: "✶",
    color: "#F5C16C",
    // .agents/skills is first so a skill Grok can't already see is linked into the shared folder, not .grok/skills.
    projectDirs: [".agents/skills", ".grok/skills", ".claude/skills", ".cursor/skills"],
    // Grok ignores CLAUDE_CONFIG_DIR: the Claude compat path is always ~/.claude/skills.
    // The first folder is where global links for Grok go, so those links stay out of ~/.grok/skills.
    globalDirs: () => [join(home(), ".agents", "skills"), join(grokDir(), "skills"), join(home(), ".claude", "skills"), join(home(), ".cursor", "skills")],
    installed: () => existsSync(grokDir()) || onPath("grok") || hasApp("Grok"),
  },
];

export function onPath(bin: string): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir && exts.some((ext) => existsSync(join(dir, bin + ext))));
}

function hasApp(name: string): boolean {
  return process.platform === "darwin" && [join("/Applications", `${name}.app`), join(home(), "Applications", `${name}.app`)].some(existsSync);
}

export function harness(id: HarnessId): Harness {
  return HARNESSES.find((h) => h.id === id)!;
}

/** The order Cursor picks a copy in when several of its folders hold the same skill (its app bundle, October 2026). */
export const CURSOR_PICKS = [".cursor", ".claude", ".codex", ".grok", ".agents"];

/** Every project skill folder any harness reads. */
export const ALL_PROJECT_DIRS = [...new Set(HARNESSES.flatMap((h) => h.projectDirs))];

/** On a tie, shared folders beat agent-specific ones. .grok/skills is not one of these: Grok already reads the shared folders. */
const PREFERRED_DIRS = [AGENTS_SKILLS_DIR, PROJECT_SKILLS_DIR];
function preference(dir: string): number {
  const i = PREFERRED_DIRS.indexOf(dir);
  return i === -1 ? PREFERRED_DIRS.length : i;
}

/** Fewer folders first, then preferred ones. */
function cost(dirs: string[]): number {
  return dirs.length * 100 + dirs.reduce((sum, d) => sum + preference(d), 0);
}

/**
 * Where skilllib puts a library skill in a project: the fewest folders that
 * reach every enabled harness, so no folder is written just to be read twice.
 * Cursor, Codex, Zed or Grok → .agents/skills. Claude Code + Cursor or Grok →
 * .claude/skills (they all read it). Claude Code + Codex needs both.
 * Like `npx skills`, the real copy goes in .agents/skills whenever that folder
 * is used (nearly every agent reads it), and Claude Code gets a link. With
 * `keep`, the real copy is already in that folder and only the links are
 * planned. Returns [real copy, ...links].
 */
export function installDirs(enabled: HarnessId[], keep?: string): string[] {
  if (enabled.length === 0) return [keep ?? PROJECT_SKILLS_DIR];
  let best: string[] = [];
  for (let mask = 1; mask < 1 << ALL_PROJECT_DIRS.length; mask++) {
    const dirs = ALL_PROJECT_DIRS.filter((_, i) => mask & (1 << i)).sort((a, b) => preference(a) - preference(b));
    if (keep && !dirs.includes(keep)) continue;
    if (!enabled.every((id) => harness(id).projectDirs.some((d) => dirs.includes(d)))) continue;
    if (best.length === 0 || cost(dirs) < cost(best)) best = dirs;
  }
  const primary = keep ?? best[0]!; // sorted by preference: .agents/skills first
  return [primary, ...best.filter((d) => d !== primary)];
}
