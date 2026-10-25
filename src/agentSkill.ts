import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enabledHarnesses } from "./config.js";
import { globalInstallDirs, HARNESSES, type HarnessId } from "./harnesses.js";
import { entryExists, isLink, linkDir } from "./library.js";
import { OWN_SKILL_MARKER } from "./paths.js";
import { tildify } from "./output.js";

/**
 * The `skilllib` skill: tells agents how to answer "which skills can you use
 * here?" and similar questions with the CLI. Unlike other skills it's
 * installed globally, since it's about every repo. It ships in the package
 * (skills/skilllib) and is refreshed when skilllib is upgraded.
 */
const AGENT_SKILL_NAME = "skilllib";

/** SKILL.md as shipped: ../skills from src/ (dev) and from dist/ (published). */
function shippedSkill(): string {
  return readFileSync(new URL("../skills/skilllib/SKILL.md", import.meta.url), "utf-8");
}

/**
 * Global folders the skilllib skill goes in: one real copy, then a link for
 * every other folder an enabled harness needs. Claude Code's folder is the
 * real copy when any enabled harness reads it. Returns [real copy, ...links].
 */
export function agentSkillDirs(enabled: HarnessId[] = enabledHarnesses()): string[] {
  return globalInstallDirs(enabled).map((d) => join(d, AGENT_SKILL_NAME));
}

function isOurs(dir: string): boolean {
  return existsSync(join(dir, OWN_SKILL_MARKER));
}

/** A link left pointing at nothing, e.g. after the real copy was deleted: safe to replace or remove. */
function isDangling(path: string): boolean {
  return entryExists(path) && lstatSync(path).isSymbolicLink() && !existsSync(path);
}

export type AgentSkillState = "installed" | "outdated" | "missing";

/** Whether every agent you use has the current skilllib skill. */
export function agentSkillState(enabled: HarnessId[] = enabledHarnesses()): AgentSkillState {
  const [primary, ...links] = agentSkillDirs(enabled);
  if (!primary || !isOurs(primary) || links.some((l) => !existsSync(join(l, "SKILL.md")))) return "missing";
  // Every copy an agent reads, not just the first (a real copy can be where a link would be).
  return [primary, ...links].every((d) => readFileSync(join(d, "SKILL.md"), "utf-8") === shippedSkill()) ? "installed" : "outdated";
}

/**
 * Installs (or refreshes) the skill for every agent you use. A folder with the
 * same name that skilllib didn't put there is left alone.
 */
export function installAgentSkill(enabled: HarnessId[] = enabledHarnesses()): { ok: true; dirs: string[] } | { ok: false; reason: string } {
  const [primary, ...links] = agentSkillDirs(enabled);
  if (!primary) return { ok: false, reason: "no agents chosen yet (skilllib harnesses <id>...)" };
  const foreign = [primary, ...links].find((d) => entryExists(d) && !isOurs(d) && !isDangling(d));
  if (foreign) return { ok: false, reason: `${tildify(foreign)} already exists and isn't skilllib's` };
  for (const d of [primary, ...links]) if (isDangling(d)) unlinkSync(d);
  mkdirSync(primary, { recursive: true });
  writeFileSync(join(primary, "SKILL.md"), shippedSkill());
  writeFileSync(join(primary, OWN_SKILL_MARKER), "Installed by skilllib. `skilllib agent-skill remove` removes it.\n");
  for (const link of links) {
    // A real copy of ours where a link belongs (installed before that agent was enabled): make it the link.
    if (entryExists(link) && !isLink(link) && isOurs(link)) rmSync(link, { recursive: true, force: true });
    if (entryExists(link)) continue;
    mkdirSync(join(link, ".."), { recursive: true });
    linkDir(primary, link);
  }
  return { ok: true, dirs: [primary, ...links] };
}

/** Removes the skill from every global folder skilllib might have put it in. */
export function removeAgentSkill(): string[] {
  const all = [...new Set(HARNESSES.flatMap((h) => h.globalDirs().map((d) => join(d, AGENT_SKILL_NAME))))];
  // Decide before deleting: once the real copy is gone, links no longer show the marker.
  const removed = all.filter((d) => entryExists(d) && (isOurs(d) || isDangling(d)));
  for (const d of removed) {
    // Two of these can be one folder (~/.claude/skills a link to ~/.agents/skills): the second is already gone.
    if (!entryExists(d)) continue;
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
