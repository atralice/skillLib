import { basename } from "node:path";
import { addSkill, blindSaid, blindWithoutGlobal, importSkill, inTheWaySaid, unloadGlobal, type Change } from "./library.js";
import { realPath } from "./paths.js";
import { knownProjects } from "./project.js";
import { harness } from "./harnesses.js";
import { treeHash } from "./skills.js";
import { recordOrigin, type SourcedSkill } from "./sources.js";

type GlobalSkill = Pick<SourcedSkill, "name" | "path" | "links" | "harnesses">;

/** What moving one global skill into repos did. `changes` is empty when it never got that far. */
export type GlobalMove = { name: string; moved: boolean; reason?: string; changes: [root: string, change: Change][] };

/**
 * Moves global skills into the repos that need them: each goes into your library (unless it's already
 * there), is added to every repo, and only then stops loading globally (restorable from the backups).
 * A skill a repo couldn't take keeps loading globally, so no agent loses it. Copies of one skill in
 * several global folders move together; `label` names a repo in the reasons.
 */
export function moveGlobalSkills(
  skills: GlobalSkill[],
  roots: string[],
  {
    group,
    allowTracked = false,
    label = basename,
    allowTrackedHint = "re-run with --allow-tracked",
  }: {
    group?: string;
    allowTracked?: boolean;
    label?: (root: string) => string;
    /** What to say when only --allow-tracked would help (the app asks instead). */
    allowTrackedHint?: string;
  } = {},
): GlobalMove[] {
  const byName = new Map<string, GlobalSkill[]>();
  for (const m of skills) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  return [...byName].map(([name, copies]): GlobalMove => {
    if (new Set(copies.map((m) => treeHash(m.path))).size > 1)
      return { name, moved: false, reason: `your global copies of ${name} differ; nothing moved (keep one first: skilllib tidy --global)`, changes: [] };
    // In a repo you're not moving it to that holds it, an agent that would then lack it (see blindWithoutGlobal):
    // checked before anything changes.
    const elsewhere = blindWithoutGlobal(name, copies, knownProjects().filter((p) => !roots.some((r) => realPath(r) === realPath(p))));
    if (elsewhere.length) return { name, moved: false, reason: `nothing moved: ${blindSaid(name, elsewhere, label)}`, changes: [] };
    // Your library already has a different skill by that name: moving this one would swap in the other.
    const imported = importSkill(copies[0]!.path).status;
    if (imported === "exists")
      return { name, moved: false, reason: `your library has a different ${name}; nothing moved (update your library from this copy first)`, changes: [] };
    if (group) recordOrigin(name, `group: ${group}`);
    const changes = roots.map((root) => [root, addSkill(root, name, { allowTracked })] as [string, Change]);
    const skipped = changes.filter(([, c]) => c.action === "skipped");
    // add's own hints (--force) aren't move's: say what to do instead.
    const why = (reason = "") => reason.replace(/ \(use --force to replace it\)$/, ": move or remove it there first");
    // The library copy stays (it's only a copy), but say so: the move didn't otherwise happen.
    const kept = imported === "added" ? `; it's in Your skills now` : "";
    if (skipped.length) return { name, moved: false, reason: `not added to ${skipped.map(([r, c]) => `${label(r)} (${why(c.reason)})`).join(", ")}, so it still loads globally${kept}`, changes };
    // A link kept out (git tracks the folder, or something is in the way), so an agent you use couldn't see it
    // there: keep the global copy until that's sorted. The same check as for the other repos, said per repo.
    const blindIn = changes.flatMap(([root, c]) => ((b) => (b.length ? [{ root, c, b }] : []))(blindWithoutGlobal(name, copies, [root])));
    if (blindIn.length) {
      const per = blindIn.map(({ root, c, b }) => {
        const who = b.map((x) => harness(x.id).name).join(", ");
        // What would help there: clear the way; commit the copy (git doesn't share it); or allow links where git tracks the folder.
        const next = c.inTheWay?.length
          ? `${inTheWaySaid(root, c.inTheWay)}: clear the way, then run skilllib link there`
          : c.uncommitted?.length
            ? `git tracks ${c.uncommitted.join(", ")} but not the skill's copy: commit it, then run skilllib link --allow-tracked there`
            : c.blocked?.length
              ? `git tracks ${c.blocked.join(", ")}: ${allowTrackedHint}`
              : blindSaid(name, b, label);
        return `${who} in ${label(root)} couldn't see it (${next})`;
      });
      return { name, moved: false, reason: `added, but ${per.join("; ")}, so it still loads globally`, changes };
    }
    const failed = copies.map((m) => unloadGlobal(m.path, m.links)).find((r) => !r.ok);
    return failed && !failed.ok ? { name, moved: false, reason: failed.reason, changes } : { name, moved: true, changes };
  });
}
