/** Prompts the TUI copies for an agent: reviewing skills, and writing a new one. */
import { harness } from "../harnesses.js";
import { buildReviewPrompt, type ReviewSkill } from "../review.js";
import { totalUses, type World } from "./world.js";

/** Everything an agent needs to judge these skills, as review.ts expects it. */
export function reviewPrompt(w: World, names: string[], scope: string): string {
  const skills = names.map((name): ReviewSkill => {
    const copies = w.machine.filter((m) => m.name === name);
    const m = copies.find((c) => c.source === "global") ?? copies[0];
    const lib = w.library.find((l) => l.name === name);
    const repos = w.projects.filter((p) => p.skills.some((s) => s.name === name));
    const local = repos[0]?.skills.find((s) => s.name === name);
    return {
      name,
      description: w.descriptions[name] ?? "",
      source: m ? (m.source === "global" ? "my global skills" : `vendor: ${m.source} (${m.where})`) : lib ? "Your skills (skilllib library)" : "a repo's own skill",
      installedHow: m?.origin ?? (m ? m.where : lib ? "created or imported into skilllib" : "committed in the repo"),
      path: m?.path ?? (lib ? w.ops.libraryFile(name).replace(/\/SKILL\.md$/, "") : (local?.path ?? "")),
      links: m?.links ?? [],
      loadedBy: m ? `${m.agents.map((a) => harness(a).name).join(", ") || "none of my agents"} — in every repo` : `repos: ${repos.map((p) => p.name).join(", ") || "none"}`,
      vendor: m && m.source !== "global" ? "turn it off at its source (/plugin in Claude Code, claude.ai settings, or Cursor)" : null,
      usesTotal: w.days ? totalUses(w, name) : null,
      usesByProject: Object.entries(w.usage).flatMap(([p, u]): [string, number][] => (u[name] ? [[p, u[name]]] : [])),
      installedIn: repos.map((p) => p.name),
      otherCopies: copies.filter((c) => c !== m).map((c) => `${c.source} ${c.where}`),
      inYourSkills: lib ? `yes, v${lib.latest}` : null,
      keptGlobal: m?.kept,
    };
  });
  return buildReviewPrompt(skills, {
    scope,
    usageDays: 30,
    harnesses: w.agents.map((a) => harness(a).name),
    projects: w.projects.map((p) => ({ name: p.name, path: p.path })),
  });
}

/** Asks an agent to write a new skill, in a repo or in your library. */
export function writeSkillPrompt(w: World, name: string, repo: string | null): string {
  const p = repo ? w.projects.find((x) => x.name === repo) : undefined;
  const file = p ? `${p.path}/.claude/skills/${name || "<name>"}/SKILL.md` : w.ops.libraryFile(name || "<name>");
  return `Write a new agent skill${name ? ` named "${name}"` : ""}${p ? ` for the repo at ${p.path}` : " for my skill library"}.

Create ${file} with:
- frontmatter: \`name\` (lowercase-with-dashes) and \`description\` saying exactly when an agent should use it
- then short, concrete instructions an agent can follow

${p ? `Look at the repo first (package.json or equivalent, README, and the skills already in .claude/skills and .agents/skills) so the skill fits how it's built, and doesn't repeat an existing one.` : "Keep it general enough to reuse across repos."}
Keep it under 200 lines. ${p ? "skilllib will offer to import it into my library afterwards." : ""}
`;
}
