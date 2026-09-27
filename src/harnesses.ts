import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, PROJECT_SKILLS_DIR, userHome } from "./paths.js";

export type HarnessId = "claude-code" | "cursor" | "codex" | "zed";

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
 *   .claude and .codex skill folders, in the project and in your home folder
 * - Codex (learn.chatgpt.com/docs/build-skills): .agents/skills from the working
 *   folder up to the repo root, ~/.agents/skills, /etc/codex/skills
 * - Zed (zed.dev/docs/ai/skills): <worktree>/.agents/skills and ~/.agents/skills only
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
    projectDirs: [".agents/skills", ".cursor/skills", ".claude/skills", ".codex/skills"],
    globalDirs: () => [join(home(), ".agents", "skills"), join(home(), ".cursor", "skills"), join(claudeDir(), "skills"), join(home(), ".codex", "skills")],
    installed: () => existsSync(join(home(), ".cursor")) || onPath("cursor-agent") || hasApp("Cursor"),
  },
  {
    id: "codex",
    name: "Codex",
    short: "Cx",
    icon: "◎",
    color: "#10A37F",
    projectDirs: [".agents/skills"],
    globalDirs: () => [join(home(), ".agents", "skills"), "/etc/codex/skills"],
    installed: () => existsSync(join(home(), ".codex")) || onPath("codex") || hasApp("Codex"),
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
];

function onPath(bin: string): boolean {
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

/** Every project skill folder any harness reads. */
export const ALL_PROJECT_DIRS = [...new Set(HARNESSES.flatMap((h) => h.projectDirs))];

/** On a tie, shared folders beat agent-specific ones. */
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
 * Cursor + Codex → .agents/skills; Claude Code + Cursor → .claude/skills;
 * Claude Code + Codex needs both (Claude Code reads only .claude/skills).
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
