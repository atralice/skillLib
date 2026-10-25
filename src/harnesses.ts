import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, codexHome, codexSystemDir, grokDir, PROJECT_SKILLS_DIR, realPath, userHome } from "./paths.js";

/**
 * Agents beyond the five skilllib started with. Directories are the ones each
 * agent actually reads (its docs, or the skills CLI agent list when the docs
 * say the same thing). A shared folder (.agents/skills, .claude/skills) is
 * listed whenever the agent reads it, so an install doesn't also write that
 * agent's private folder.
 */
const EXTRAS = [
  { id: "github-copilot", name: "GitHub Copilot", short: "Cp", icon: "◐", color: "#E8E8E8", project: [".agents/skills", ".claude/skills", ".github/skills"], global: [".agents/skills", ".claude/skills", ".copilot/skills"], detect: [".copilot"], bin: "copilot" },
  { id: "gemini-cli", name: "Gemini CLI", short: "Ge", icon: "✦", color: "#8AB4F8", project: [".agents/skills", ".gemini/skills"], global: [".agents/skills", ".gemini/skills"], detect: [], bin: "gemini" },
  { id: "opencode", name: "OpenCode", short: "Oc", icon: "⌘", color: "#A78BFA", project: [".agents/skills", ".claude/skills", ".opencode/skills"], global: [".agents/skills", ".claude/skills", ".config/opencode/skills"], detect: [".config/opencode", ".opencode"], bin: "opencode" },
  { id: "antigravity", name: "Antigravity", short: "Ag", icon: "▲", color: "#34A853", project: [".agents/skills", ".agent/skills"], global: [".gemini/config/skills", ".gemini/antigravity/skills"], detect: [".gemini/antigravity"], bin: "agy", app: "Antigravity" },
  { id: "antigravity-ide", name: "Antigravity IDE", short: "Ai", icon: "▲", color: "#34A853", project: [".agents/skills", ".agent/skills"], global: [".gemini/antigravity-ide/skills"], detect: [".gemini/antigravity-ide"], app: "Antigravity IDE" },
  { id: "antigravity-cli", name: "Antigravity CLI", short: "Ac", icon: "▲", color: "#34A853", project: [".agents/skills", ".agent/skills"], global: [".gemini/antigravity-cli/skills"], detect: [".gemini/antigravity-cli"], bin: "agy" },
  { id: "windsurf", name: "Windsurf", short: "Ws", icon: "≋", color: "#0EA5E9", project: [".windsurf/skills"], global: [".codeium/windsurf/skills"], detect: [".codeium/windsurf"], bin: "windsurf", app: "Windsurf" },
  { id: "devin", name: "Devin", short: "Dv", icon: "Δ", color: "#7C6AF7", project: [".agents/skills", ".devin/skills", ".windsurf/skills"], global: [".agents/skills", ".config/devin/skills"], detect: [".config/devin"], bin: "devin" },
  { id: "cline", name: "Cline", short: "Cl", icon: "▣", color: "#22C55E", project: [".agents/skills"], global: [".agents/skills"], detect: [".cline"], bin: "cline" },
  { id: "amp", name: "Amp", short: "Am", icon: "⚡", color: "#F5C16C", project: [".agents/skills"], global: [".config/agents/skills"], detect: [".config/amp"], bin: "amp" },
  { id: "droid", name: "Factory Droid", short: "Dr", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills", ".factory/skills"], detect: [".factory"], bin: "droid" },
  { id: "openclaw", name: "OpenClaw", short: "Ow", icon: "·", color: "#8A93A6", project: ["skills"], global: [".openclaw/skills"], detect: [".openclaw", ".clawdbot", ".moltbot"], bin: "openclaw" },
  { id: "continue", name: "Continue", short: "Cn", icon: "·", color: "#8A93A6", project: [".continue/skills"], global: [".continue/skills"], detect: [".continue"] },
  { id: "augment", name: "Augment", short: "Au", icon: "·", color: "#8A93A6", project: [".augment/skills"], global: [".augment/skills"], detect: [".augment"] },
  { id: "junie", name: "Junie", short: "Ju", icon: "·", color: "#8A93A6", project: [".junie/skills"], global: [".junie/skills"], detect: [".junie"], bin: "junie" },
  { id: "roo", name: "Roo Code", short: "Ro", icon: "·", color: "#8A93A6", project: [".roo/skills"], global: [".roo/skills"], detect: [".roo"] },
  { id: "goose", name: "Goose", short: "Gs", icon: "·", color: "#8A93A6", project: [".goose/skills"], global: [".config/goose/skills"], detect: [".config/goose"], bin: "goose" },
  { id: "openhands", name: "OpenHands", short: "Oh", icon: "·", color: "#8A93A6", project: [".openhands/skills"], global: [".openhands/skills"], detect: [".openhands"] },
  { id: "crush", name: "Crush", short: "Cr", icon: "·", color: "#8A93A6", project: [".crush/skills"], global: [".config/crush/skills"], detect: [".config/crush"], bin: "crush" },
  { id: "pi", name: "Pi", short: "Pi", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills", ".pi/agent/skills"], detect: [".pi/agent"], bin: "pi" },
  { id: "kimi-code-cli", name: "Kimi Code CLI", short: "Ki", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".kimi"], bin: "kimi" },
  { id: "kilo", name: "Kilo Code", short: "Kl", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".kilo/skills", ".kilocode/skills"], detect: [".kilo", ".kilocode"] },
  { id: "kiro-cli", name: "Kiro CLI", short: "Kr", icon: "·", color: "#8A93A6", project: [".kiro/skills"], global: [".kiro/skills"], detect: [".kiro"], bin: "kiro" },
  { id: "qwen-code", name: "Qwen Code", short: "Qw", icon: "·", color: "#8A93A6", project: [".qwen/skills"], global: [".qwen/skills"], detect: [".qwen"], bin: "qwen" },
  { id: "warp", name: "Warp", short: "Wp", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".warp"], app: "Warp" },
  { id: "replit", name: "Replit", short: "Rp", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".config/agents/skills"], detect: [] },
  { id: "trae", name: "Trae", short: "Tr", icon: "·", color: "#8A93A6", project: [".trae/skills"], global: [".trae/skills"], detect: [".trae"], app: "Trae" },
  { id: "mux", name: "Mux", short: "Mx", icon: "·", color: "#8A93A6", project: [".mux/skills"], global: [".mux/skills"], detect: [".mux"] },
  { id: "mistral-vibe", name: "Mistral Vibe", short: "Mv", icon: "·", color: "#8A93A6", project: [".vibe/skills"], global: [".vibe/skills"], detect: [".vibe"], bin: "vibe" },
  { id: "qoder", name: "Qoder", short: "Qd", icon: "·", color: "#8A93A6", project: [".qoder/skills"], global: [".qoder/skills"], detect: [".qoder"] },
  { id: "zencoder", name: "Zencoder", short: "Ze", icon: "·", color: "#8A93A6", project: [".zencoder/skills"], global: [".zencoder/skills"], detect: [".zencoder"] },
  { id: "neovate", name: "Neovate", short: "Nv", icon: "·", color: "#8A93A6", project: [".neovate/skills"], global: [".neovate/skills"], detect: [".neovate"] },
  { id: "adal", name: "AdaL", short: "Ad", icon: "·", color: "#8A93A6", project: [".adal/skills"], global: [".adal/skills"], detect: [".adal"] },
  { id: "bob", name: "IBM Bob", short: "Bb", icon: "·", color: "#8A93A6", project: [".bob/skills"], global: [".bob/skills"], detect: [".bob"] },
  { id: "aider-desk", name: "AiderDesk", short: "Adk", icon: "·", color: "#8A93A6", project: [".aider-desk/skills"], global: [".aider-desk/skills"], detect: [".aider-desk"] },
  { id: "codebuddy", name: "CodeBuddy", short: "Cb", icon: "·", color: "#8A93A6", project: [".codebuddy/skills"], global: [".codebuddy/skills"], detect: [".codebuddy"] },
  { id: "command-code", name: "Command Code", short: "Cm", icon: "·", color: "#8A93A6", project: [".commandcode/skills"], global: [".commandcode/skills"], detect: [".commandcode"] },
  { id: "cortex", name: "Cortex Code", short: "Ct", icon: "·", color: "#8A93A6", project: [".cortex/skills"], global: [".snowflake/cortex/skills"], detect: [".snowflake/cortex"] },
  { id: "hermes-agent", name: "Hermes Agent", short: "He", icon: "·", color: "#8A93A6", project: [".hermes/skills"], global: [".hermes/skills"], detect: [".hermes"] },
  { id: "iflow-cli", name: "iFlow CLI", short: "If", icon: "·", color: "#8A93A6", project: [".iflow/skills"], global: [".iflow/skills"], detect: [".iflow"] },
  { id: "kode", name: "Kode", short: "Kd", icon: "·", color: "#8A93A6", project: [".kode/skills"], global: [".kode/skills"], detect: [".kode"] },
  { id: "mcpjam", name: "MCPJam", short: "Mj", icon: "·", color: "#8A93A6", project: [".mcpjam/skills"], global: [".mcpjam/skills"], detect: [".mcpjam"] },
  { id: "minimax-code", name: "MiniMax Code", short: "Mm", icon: "·", color: "#8A93A6", project: [".minimax/skills"], global: [".minimax/skills"], detect: [".minimax"] },
  { id: "pochi", name: "Pochi", short: "Po", icon: "·", color: "#8A93A6", project: [".pochi/skills"], global: [".pochi/skills"], detect: [".pochi"] },
  { id: "rovodev", name: "Rovo Dev", short: "Rv", icon: "·", color: "#8A93A6", project: [".rovodev/skills"], global: [".rovodev/skills"], detect: [".rovodev"] },
  { id: "tabnine-cli", name: "Tabnine CLI", short: "Tn", icon: "·", color: "#8A93A6", project: [".tabnine/agent/skills"], global: [".tabnine/agent/skills"], detect: [".tabnine"] },
  { id: "zcode", name: "ZCode", short: "Zc", icon: "·", color: "#8A93A6", project: [".zcode/skills"], global: [".zcode/skills"], detect: [".zcode"], app: "ZCode" },
  { id: "autohand-code", name: "Autohand Code", short: "Ah", icon: "·", color: "#8A93A6", project: [".autohand/skills"], global: [".autohand/skills"], detect: [".autohand"] },
  { id: "codearts-agent", name: "CodeArts Agent", short: "Ca", icon: "·", color: "#8A93A6", project: [".codeartsdoer/skills"], global: [".codeartsdoer/skills"], detect: [".codeartsdoer"] },
  { id: "codemaker", name: "CodeMaker", short: "Mk", icon: "·", color: "#8A93A6", project: [".codemaker/skills"], global: [".codemaker/skills"], detect: [".codemaker"] },
  { id: "codestudio", name: "CodeStudio", short: "Cs", icon: "·", color: "#8A93A6", project: [".codestudio/skills"], global: [".codestudio/skills"], detect: [".codestudio"] },
  { id: "deepagents", name: "Deep Agents", short: "Da", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".deepagents/agent/skills"], detect: [".deepagents"] },
  { id: "dexto", name: "Dexto", short: "Dx", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".dexto"] },
  { id: "firebender", name: "Firebender", short: "Fb", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".firebender/skills"], detect: [".firebender"] },
  { id: "forgecode", name: "ForgeCode", short: "Fc", icon: "·", color: "#8A93A6", project: [".forge/skills"], global: [".forge/skills"], detect: [".forge"] },
  { id: "fx", name: "fx", short: "Fx", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".fx"] },
  { id: "inference-sh", name: "inference.sh", short: "In", icon: "·", color: "#8A93A6", project: [".inferencesh/skills"], global: [".inferencesh/skills"], detect: [".inferencesh"] },
  { id: "jazz", name: "Jazz", short: "Jz", icon: "·", color: "#8A93A6", project: [".jazz/skills"], global: [".jazz/skills"], detect: [".jazz"] },
  { id: "kimchi", name: "Kimchi", short: "Kc", icon: "·", color: "#8A93A6", project: [".kimchi/skills"], global: [".config/kimchi/harness/skills"], detect: [".config/kimchi"] },
  { id: "lingma", name: "Lingma", short: "Lg", icon: "·", color: "#8A93A6", project: [".lingma/skills"], global: [".lingma/skills"], detect: [".lingma"] },
  { id: "loaf", name: "Loaf", short: "Lf", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".loaf"] },
  { id: "moxby", name: "Moxby", short: "Mb", icon: "·", color: "#8A93A6", project: [".moxby/skills"], global: [".moxby/skills"], detect: [".moxby"] },
  { id: "ona", name: "Ona", short: "On", icon: "·", color: "#8A93A6", project: [".ona/skills"], global: [".ona/skills"], detect: [".ona"] },
  { id: "posit-assistant", name: "Posit Assistant", short: "Pa", icon: "·", color: "#8A93A6", project: [".posit/assistant/skills"], global: [".posit/assistant/skills"], detect: [".posit"] },
  { id: "reasonix", name: "Reasonix", short: "Rx", icon: "·", color: "#8A93A6", project: [".reasonix/skills"], global: [".reasonix/skills"], detect: [".reasonix"] },
  { id: "sarvam-code", name: "Sarvam Code", short: "Sv", icon: "·", color: "#8A93A6", project: [".agents/skills"], global: [".agents/skills"], detect: [".sarvam"] },
  { id: "terramind", name: "Terramind", short: "Tm", icon: "·", color: "#8A93A6", project: [".terramind/skills"], global: [".terramind/skills"], detect: [".terramind"] },
  { id: "tinycloud", name: "TinyCloud", short: "Ty", icon: "·", color: "#8A93A6", project: [".tinycloud/skills"], global: [".tinycloud/skills"], detect: [".tinycloud"] },
] as const;

/** The agents settings and first run show before “More agents”. */
export const FEATURED_HARNESSES: HarnessId[] = ["claude-code", "cursor", "codex", "zed", "grok"];

type ExtraId = (typeof EXTRAS)[number]["id"];

export type HarnessId = "claude-code" | "cursor" | "codex" | "zed" | "grok" | ExtraId;

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
  ...EXTRAS.map(
    (e): Harness => ({
      id: e.id,
      name: e.name,
      short: e.short,
      icon: e.icon,
      color: e.color,
      projectDirs: [...e.project],
      globalDirs: () => e.global.map((g) => join(home(), g)),
      installed: () =>
        e.detect.some((d) => existsSync(join(home(), d))) || ("bin" in e && e.bin ? onPath(e.bin) : false) || ("app" in e && e.app ? hasApp(e.app) : false),
    }),
  ),
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

/**
 * OpenClaw's project folder is `skills/` at the repo root, which is also where
 * people author skills. Scan and tidy it only when OpenClaw is enabled.
 */
export function projectDirsInUse(enabled: HarnessId[]): string[] {
  return ALL_PROJECT_DIRS.filter((d) => d !== "skills" || enabled.includes("openclaw"));
}

/** The smallest set of `universe` that reaches every id. Ties go to `pref` (lower wins). */
function cover(enabled: HarnessId[], universe: string[], reads: (id: HarnessId) => string[], pref: (dir: string) => number): string[] {
  const left = new Set(enabled);
  const chosen: string[] = [];
  while (left.size) {
    let best: string | null = null;
    let bestCount = 0;
    let bestPref = Infinity;
    for (const dir of universe) {
      if (chosen.includes(dir)) continue;
      const count = [...left].filter((id) => reads(id).includes(dir)).length;
      if (count === 0) continue;
      const p = pref(dir);
      if (count > bestCount || (count === bestCount && (p < bestPref || (p === bestPref && (best === null || dir < best))))) {
        best = dir;
        bestCount = count;
        bestPref = p;
      }
    }
    if (!best) break;
    chosen.push(best);
    for (const id of [...left]) if (reads(id).includes(best)) left.delete(id);
  }
  return chosen;
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
  const reads = (id: HarnessId) => harness(id).projectDirs;
  const rest = keep ? enabled.filter((id) => !reads(id).includes(keep)) : enabled;
  const chosen = [...new Set([...(keep ? [keep] : []), ...cover(rest, ALL_PROJECT_DIRS, reads, preference)])];
  const primary = keep ?? [...chosen].sort((a, b) => preference(a) - preference(b) || a.localeCompare(b))[0]!;
  return [primary, ...chosen.filter((d) => d !== primary).sort((a, b) => preference(a) - preference(b) || a.localeCompare(b))];
}

/** Lower is better: the shared global folders, then an agent's own. */
function globalPreference(dir: string): number {
  const agents = realPath(join(userHome(), ".agents", "skills"));
  const claude = realPath(join(claudeDir(), "skills"));
  const real = realPath(dir);
  if (real === agents) return 0;
  if (real === claude) return 1;
  return 2;
}

/**
 * Global folders to write so every enabled harness can see one skill.
 * The real copy goes in ~/.claude/skills when any enabled harness reads it
 * (Claude Code doesn't read ~/.agents/skills), otherwise ~/.agents/skills, and
 * the rest are links. Returns parent folders, not the skill itself.
 */
export function globalInstallDirs(enabled: HarnessId[]): string[] {
  if (enabled.length === 0) return [];
  const reads = (id: HarnessId) => harness(id).globalDirs();
  const chosen = cover(enabled, [...new Set(enabled.flatMap(reads))], reads, globalPreference);
  const claude = join(claudeDir(), "skills");
  const agents = join(userHome(), ".agents", "skills");
  const primary = chosen.find((d) => realPath(d) === realPath(claude)) ?? chosen.find((d) => realPath(d) === realPath(agents)) ?? chosen[0];
  if (!primary) return [];
  const dirs = [primary, ...chosen.filter((d) => realPath(d) !== realPath(primary))];
  return dirs.filter((d, i) => dirs.findIndex((o) => realPath(o) === realPath(d)) === i);
}
