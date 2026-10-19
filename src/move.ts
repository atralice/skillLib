import { basename } from "node:path";
import { addSkill, importSkill, unloadGlobal, visibilityOf, type Change } from "./library.js";
import { harness } from "./harnesses.js";
import { treeHash } from "./skills.js";
import { recordOrigin, type SourcedSkill } from "./sources.js";

type GlobalSkill = Pick<SourcedSkill, "name" | "path" | "links">;

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
    if (importSkill(copies[0]!.path).status === "exists")
      return { name, moved: false, reason: `your library has a different ${name}; nothing moved (update your library from this copy first)`, changes: [] };
    if (group) recordOrigin(name, `group: ${group}`);
    const changes = roots.map((root) => [root, addSkill(root, name, { allowTracked })] as [string, Change]);
    const skipped = changes.filter(([, c]) => c.action === "skipped");
    // add's own hints (--force) aren't move's: say what to do instead.
    const why = (reason = "") => reason.replace(/ \(use --force to replace it\)$/, ": move or remove it there first");
    if (skipped.length) return { name, moved: false, reason: `not added to ${skipped.map(([r, c]) => `${label(r)} (${why(c.reason)})`).join(", ")}, so it still loads globally`, changes };
    // A link kept out (git tracks the folder, or something is in the way), so an agent you use couldn't see it
    // there: keep the global copy until that's sorted. Checked in every repo, whatever add said.
    const blindIn = changes.filter(([root]) => visibilityOf(root, name).some((v) => v.paths === 0));
    const blind = blindIn.flatMap(([root]) => visibilityOf(root, name).flatMap((v) => (v.paths === 0 ? [`${harness(v.id).name} in ${label(root)}`] : [])));
    if (blind.length && (!allowBlind || blindIn.some(([, c]) => c.inTheWay?.length))) {
      const inTheWay = blindIn.flatMap(([root, c]) => (c.inTheWay ?? []).map((p) => `${p} in ${label(root)}`));
      // --allow-tracked helps where git tracks the folder; where git doesn't share the copy, only committing it does.
      const next = inTheWay.length
        ? `move ${inTheWay.join(", ")} out of the way, then run skilllib link there`
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
