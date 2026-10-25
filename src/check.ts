import { join } from "node:path";
import type { SkillState } from "./library.js";
import { libraryDir } from "./paths.js";
import { isSkillDir, treeHash } from "./skills.js";

/** Who can take a skill out of the prompt. Built-ins ship with the agent. */
export type CheckLever = "yours" | "plugin" | "built-in" | "claude.ai" | "system" | "skilllib" | "repo";

/** One skill a check read. Nothing here is stored. */
export type CheckRow = {
  name: string;
  where: "global" | "repo";
  description: string;
  /** Rough tokens of the name and description: what sits in every prompt where this skill loads. */
  everyPrompt: number;
  uses: number;
  lastUsed: string | null;
  projects: string[];
  fresh: string;
  path: string;
  lever: CheckLever;
  /** Plugin id, or Cursor / Codex / Grok for a built-in. */
  via?: string;
  /** A global skill that is also pinned in this repo. Counted once, as global. */
  alsoInRepo?: boolean;
  keptGlobal?: boolean;
};

/**
 * Tokens of the name and description, which agents keep in every prompt.
 * ponytail: chars/4. A real tokenizer if this number starts deciding anything.
 */
export function promptTokens(name: string, description: string): number {
  return Math.max(1, Math.ceil((name.length + 1 + description.length) / 4));
}

/** How a repo skill compares to the library, in the words a check shows. */
export function freshLabel(state: SkillState, version: number | null, latest: number | null): string {
  if (state === "update available") return `v${version} → v${latest}`;
  if (state === "edited locally, update available") return `edited here, library has v${latest}`;
  if (state === "edited locally") return "edited here";
  if (state === "out of sync") return "not the pinned version";
  if (state === "folder missing") return "folder missing";
  if (state === "ok" || state === "repo skill, in library" || state === "untracked copy of library skill") return "current";
  if (state === "untracked, differs from library" || state === "repo skill, differs from library") return "differs from your library";
  return "not in your library";
}

/** A global copy against the library folder. Does not record a version. */
export function libraryFresh(path: string, name: string): string {
  const lib = join(libraryDir(), name);
  if (!isSkillDir(lib)) return "not in your library";
  const here = treeHash(path);
  return here && here === treeHash(lib) ? "matches your library" : "differs from your library";
}

const settled = new Set(["current", "matches your library", "vendor", "skilllib"]);

/** Unused first, then anything that isn't current, then the ones that cost the most. */
export function byWeight(rows: CheckRow[]): CheckRow[] {
  const rank = (r: CheckRow) => (r.uses === 0 ? 0 : 1) * 2 + (settled.has(r.fresh) ? 1 : 0);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.everyPrompt - a.everyPrompt || a.name.localeCompare(b.name));
}

export function tokenSum(rows: CheckRow[], where?: CheckRow["where"]): number {
  return rows.filter((r) => !where || r.where === where).reduce((n, r) => n + r.everyPrompt, 0);
}

/** ~7,200 above 100 tokens, the number itself below that. */
export function rough(n: number): string {
  const rounded = n >= 100 ? Math.round(n / 100) * 100 : n;
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A few lines: the cost, whether that's heavy, and the only cuts that are real.
 * Plugins and claude.ai skills can be turned off. Built-ins ship with the agent.
 */
export function checkBrief(rows: CheckRow[], ctx: { days: number; repo: string | null }): string[] {
  const global = rows.filter((r) => r.where === "global");
  const repo = rows.filter((r) => r.where === "repo");
  const globalTokens = tokenSum(global);
  const unused = rows.filter((r) => r.uses === 0);
  const unusedGlobal = global.filter((r) => r.uses === 0 && r.lever !== "skilllib");
  const unusedTokens = tokenSum(unusedGlobal);
  const n = (count: number) => `${count} skill${count === 1 ? "" : "s"}`;
  const lines = [
    `${n(rows.length)}. ~${rough(globalTokens)} tokens of names and descriptions in every prompt${ctx.repo ? `, plus ~${rough(tokenSum(repo))} from this repo` : ""}.`,
    `${unused.length} had no Claude Code use in ${ctx.days} days. A zero is a hint: Cursor and Codex aren't in these transcripts.`,
  ];
  if (!globalTokens) return [...lines, "Nothing global is loading."];
  lines.push(
    unusedTokens * 2 >= globalTokens
      ? "Heavy. More than half of every prompt's skill list had no use."
      : unusedTokens * 4 >= globalTokens
        ? "Mixed. A good share of every prompt is skills with no use."
        : "Fine. Most of what loads has been used.",
  );

  const plugins = Object.entries(Object.groupBy(global.filter((r) => r.lever === "plugin"), (r) => r.via ?? r.name))
    .map(([id, skills = []]) => ({
      id,
      tokens: tokenSum(skills),
      idle: tokenSum(skills.filter((s) => s.uses === 0)),
      skills: skills.length,
      used: skills.filter((s) => s.uses > 0).length,
    }))
    .filter((p) => p.idle > 0 && p.idle * 2 >= p.tokens)
    .sort((a, b) => b.tokens - a.tokens);
  const yours = unusedGlobal.filter((r) => r.lever === "yours");
  const synced = unusedGlobal.filter((r) => r.lever === "claude.ai");
  const drop = plugins.reduce((n, p) => n + p.tokens, 0) + tokenSum(yours) + tokenSum(synced);
  if (drop > 0) lines.push(`You can drop ~${rough(drop)} tokens.`);
  for (const p of plugins.slice(0, 3)) {
    lines.push(
      p.used
        ? `~${rough(p.tokens)} is ${p.id} (${p.skills} skills, ${p.used} used). Turning the plugin off drops all of it, including ${p.used === 1 ? "that one" : "those"}.`
        : `~${rough(p.tokens)} is ${p.id} (${p.skills} skills, no use). Turn the plugin off.`,
    );
  }
  if (plugins.length > 3) lines.push(`${plugins.length - 3} more plugins are in the same spot.`);
  if (plugins.length) lines.push("Claude Code plugins turn off from skilllib. Cursor plugins turn off in Cursor.");
  if (yours.length) {
    const names = yours.sort((a, b) => b.everyPrompt - a.everyPrompt).slice(0, 5).map((r) => r.name);
    const more = yours.length > 5 ? `, and ${yours.length - 5} more` : "";
    lines.push(`~${rough(tokenSum(yours))} are your own global skills with no use (${names.join(", ")}${more}). Move them into the repos that need them, or delete them.`);
  }
  if (synced.length) lines.push(`~${rough(tokenSum(synced))} are claude.ai skills with no use. Turn them off on claude.ai.`);

  const builtins = unusedGlobal.filter((r) => r.lever === "built-in");
  if (builtins.length) {
    const who = [...new Set(builtins.map((r) => r.via ?? "the agent"))].join(", ");
    lines.push(`~${rough(tokenSum(builtins))} are ${who} built-ins with no use. They ship with the agent. skilllib can't unload them.`);
  }
  return lines;
}
