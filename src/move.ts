import { basename } from "node:path";
import { addSkill, blindWithoutGlobal, importSkill, inTheWaySaid, unloadGlobal, visibilityOf, type Change } from "./library.js";
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
    allowBlind = false,
  }: {
    group?: string;
    allowTracked?: boolean;
    label?: (root: string) => string;
    /** Move even if git kept a link out and an agent can't see the skill in a repo (the app asks next). */
    allowBlind?: boolean;
  } = {},
): GlobalMove[] {
  const byName = new Map<string, GlobalSkill[]>();
  for (const m of skills) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  return [...byName].map(([name, copies]): GlobalMove => {
    if (new Set(copies.map((m) => treeHash(m.path))).size > 1)
      return { name, moved: false, reason: `your global copies of ${name} differ; nothing moved (keep one first: skilllib tidy --global)`, changes: [] };
    // Your library already has a different skill by that name: moving this one would swap in the other.
    // Only agents that load a global copy can lose it (Codex never reads ~/.claude/skills). In a repo you're not moving it
    // to that holds it, one that only ever saw the global copy would lose it: checked before anything changes.
    const readers = new Set(copies.flatMap((m) => m.harnesses));
    const elsewhere = blindWithoutGlobal(name, readers, knownProjects().filter((p) => !roots.some((r) => realPath(r) === realPath(p))));
    if (elsewhere.length)
      return {
        name,
        moved: false,
        reason: `${elsewhere.map((b) => `${harness(b.id).name} in ${label(b.root)}`).join(", ")} only ${elsewhere.length === 1 ? "sees" : "see"} the global copy; nothing moved (make the repo's copy reach ${elsewhere.length === 1 ? "it" : "them"} first: skilllib doctor says what's in the way)`,
        changes: [],
      };
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
    // there: keep the global copy until that's sorted. Checked in every repo, whatever add said.
    const blindAt = (root: string) => visibilityOf(root, name).filter((v) => v.paths === 0 && readers.has(v.id));
    const blindIn = changes.filter(([root]) => blindAt(root).length);
    const blind = blindIn.flatMap(([root]) => blindAt(root).map((v) => `${harness(v.id).name} in ${label(root)}`));
    if (blind.length && (!allowBlind || blindIn.some(([, c]) => c.inTheWay?.length))) {
      const inTheWay = blindIn.flatMap(([root, c]) => (c.inTheWay?.length ? [`in ${label(root)}, ${inTheWaySaid(root, c.inTheWay)}`] : []));
      // --allow-tracked helps where git tracks the folder; where git doesn't share the copy, only committing it does.
      const next = inTheWay.length
        ? `clear the way (${inTheWay.join("; ")}), then run skilllib link there`
        : blindIn.some(([, c]) => c.uncommitted?.length)
          ? "commit the skill's copy in the repo, then run skilllib link --allow-tracked there"
          : "re-run with --allow-tracked";
      const cause = inTheWay.length ? "something is in the way of its link" : "git tracks the folder its link goes in";
      return { name, moved: false, reason: `added, but ${blind.join(", ")} couldn't see it (${cause}), so it still loads globally; ${next}`, changes };
    }
    const failed = copies.map((m) => unloadGlobal(m.path, m.links)).find((r) => !r.ok);
    return failed && !failed.ok ? { name, moved: false, reason: failed.reason, changes } : { name, moved: true, changes };
  });
}
