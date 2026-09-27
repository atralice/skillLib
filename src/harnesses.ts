import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { claudeDir, userHome } from "./paths.js";

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

/**
 * Where skilllib puts a library skill in a project so every enabled harness
 * sees it: the real copy always goes in .claude/skills (Claude Code and Cursor
 * read it, and repos rarely commit it); harnesses that only read
 * .agents/skills (Codex, Zed) get a link there. Returns [real copy, ...links].
 */
export function installDirs(enabled: HarnessId[]): string[] {
  const needsAgents = enabled.some((id) => !harness(id).projectDirs.includes(".claude/skills"));
  return needsAgents ? [".claude/skills", ".agents/skills"] : [".claude/skills"];
}
