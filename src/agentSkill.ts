import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enabledHarnesses } from "./config.js";
import { harness, type HarnessId } from "./harnesses.js";
import { linkDir } from "./library.js";
import { claudeDir, OWN_SKILL_MARKER, userHome } from "./paths.js";

/**
 * The `skilllib` skill: tells agents how to answer "which skills can you use
 * here?" and similar questions with the CLI. Unlike other skills it's
 * installed globally, since it's about every repo. It ships in the package
 * (skills/skilllib) and is refreshed when skilllib is upgraded.
 */
export const AGENT_SKILL_NAME = "skilllib";

/** SKILL.md as shipped: ../skills from src/ (dev) and from dist/ (published). */
function shippedSkill(): string {
  return readFileSync(new URL("../skills/skilllib/SKILL.md", import.meta.url), "utf-8");
}

/**
 * Global folders it goes in: ~/.claude/skills for Claude Code and Cursor,
 * ~/.agents/skills for Codex and Zed. With both, the second is a link, so
 * Cursor (which reads both) sees one skill. Returns [real copy, ...links].
 */
export function agentSkillDirs(enabled: HarnessId[] = enabledHarnesses()): string[] {
  const claudeSkills = join(claudeDir(), "skills");
  const agentsSkills = join(userHome(), ".agents", "skills");
  const needsClaude = enabled.some((id) => harness(id).globalDirs().includes(claudeSkills));
  const needsAgents = enabled.some((id) => !harness(id).globalDirs().includes(claudeSkills));
  return [...(needsClaude ? [claudeSkills] : []), ...(needsAgents ? [agentsSkills] : [])].map((d) => join(d, AGENT_SKILL_NAME));
}

function isOurs(dir: string): boolean {
  return existsSync(join(dir, OWN_SKILL_MARKER));
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export type AgentSkillState = "installed" | "outdated" | "missing";

/** Whether every agent you use has the current skilllib skill. */
export function agentSkillState(enabled: HarnessId[] = enabledHarnesses()): AgentSkillState {
  const [primary, ...links] = agentSkillDirs(enabled);
  if (!primary || !isOurs(primary) || links.some((l) => !existsSync(join(l, "SKILL.md")))) return "missing";
  return readFileSync(join(primary, "SKILL.md"), "utf-8") === shippedSkill() ? "installed" : "outdated";
}

/**
 * Installs (or refreshes) the skill for every agent you use. A folder with the
 * same name that skilllib didn't put there is left alone.
 */
export function installAgentSkill(enabled: HarnessId[] = enabledHarnesses()): { ok: true; dirs: string[] } | { ok: false; reason: string } {
  const [primary, ...links] = agentSkillDirs(enabled);
  if (!primary) return { ok: false, reason: "no agents chosen yet (skilllib harnesses <id>...)" };
  const foreign = [primary, ...links].find((d) => entryExists(d) && !isOurs(d));
  if (foreign) return { ok: false, reason: `${foreign} already exists and isn't skilllib's` };
  mkdirSync(primary, { recursive: true });
  writeFileSync(join(primary, "SKILL.md"), shippedSkill());
  writeFileSync(join(primary, OWN_SKILL_MARKER), "Installed by skilllib. `skilllib agent-skill remove` removes it.\n");
  for (const link of links) {
    if (entryExists(link)) continue;
    mkdirSync(join(link, ".."), { recursive: true });
    linkDir(primary, link);
  }
  return { ok: true, dirs: [primary, ...links] };
}

/** Removes the skill from every folder skilllib put it in. */
export function removeAgentSkill(): string[] {
  const all = agentSkillDirs(["claude-code", "codex"]);
  // Decide before deleting: once the real copy is gone, links no longer show the marker.
  const removed = all.filter((d) => entryExists(d) && isOurs(d));
  for (const d of removed) {
    if (lstatSync(d).isSymbolicLink()) unlinkSync(d);
    else rmSync(d, { recursive: true, force: true });
  }
  return removed;
}

/** Keeps an installed skill in step with the CLI after an upgrade; never installs it on its own. */
export function refreshAgentSkill() {
  try {
    if (agentSkillState() === "outdated") installAgentSkill();
  } catch {
    // Best effort: a stale skill is better than a failed command.
  }
}
