import { basename } from "node:path";
import { addSkill, importSkill, unloadGlobal, type Change } from "./library.js";
import { recordOrigin, type SourcedSkill } from "./sources.js";

type GlobalSkill = Pick<SourcedSkill, "name" | "path" | "links">;

/** What moving one global skill into repos did. `changes` is empty when it never got that far. */
export type GlobalMove = { name: string; moved: boolean; reason?: string; changes: [root: string, change: Change][] };

/**
 * Moves global skills into the repos that need them: each goes into your library (unless it's already
 * there), is added to every repo, and only then stops loading globally (restorable from the backups).
 * A skill a repo couldn't take keeps loading globally, so no agent loses it.
 */
export function moveGlobalSkills(
  skills: GlobalSkill[],
  roots: string[],
  { group, allowTracked = false }: { group?: string; allowTracked?: boolean } = {},
): GlobalMove[] {
  return skills.map((m): GlobalMove => {
    // Your library already has a different skill by that name: moving this one would swap in the other.
    if (importSkill(m.path).status === "exists")
      return { name: m.name, moved: false, reason: `your library has a different ${m.name}; nothing moved (update your library from this copy first)`, changes: [] };
    if (group) recordOrigin(m.name, `group: ${group}`);
    const changes = roots.map((root) => [root, addSkill(root, m.name, { allowTracked })] as [string, Change]);
    const skipped = changes.filter(([, c]) => c.action === "skipped");
    if (skipped.length) return { name: m.name, moved: false, reason: `not added to ${skipped.map(([r, c]) => `${basename(r)} (${c.reason})`).join(", ")}, so it still loads globally`, changes };
    const r = unloadGlobal(m.path, m.links);
    return r.ok ? { name: m.name, moved: true, changes } : { name: m.name, moved: false, reason: r.reason, changes };
  });
}
