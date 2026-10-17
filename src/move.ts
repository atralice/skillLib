import { basename } from "node:path";
import { addSkill, importSkill, unloadGlobal, type Change } from "./library.js";
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
  { group, allowTracked = false, label = basename }: { group?: string; allowTracked?: boolean; label?: (root: string) => string } = {},
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
    if (skipped.length) return { name, moved: false, reason: `not added to ${skipped.map(([r, c]) => `${label(r)} (${c.reason})`).join(", ")}, so it still loads globally`, changes };
    const failed = copies.map((m) => unloadGlobal(m.path, m.links)).find((r) => !r.ok);
    return failed && !failed.ok ? { name, moved: false, reason: failed.reason, changes } : { name, moved: true, changes };
  });
}
