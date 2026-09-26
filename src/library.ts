import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { libraryDir } from "./paths.js";
import { projectSkillsDir, readManifest, writeManifest } from "./project.js";
import { copySkill, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";

export type LibrarySkill = { name: string; description: string; dir: string; hash: string };

export function librarySkills(): LibrarySkill[] {
  return skillDirsIn(libraryDir()).map((dir) => ({
    name: basename(dir),
    description: readSkillInfo(dir).description,
    dir,
    hash: treeHash(dir) ?? "",
  }));
}

export function librarySkillDir(name: string): string {
  return join(libraryDir(), name);
}

export type SkillState =
  | "ok"
  | "update available"
  | "edited locally"
  | "edited locally, update available"
  | "folder missing"
  | "not in library"
  | "untracked copy of library skill"
  | "untracked, differs from library"
  | "local only";

export type ProjectSkill = { name: string; managed: boolean; state: SkillState };

/** Every skill in a project's .claude/skills, managed or not, with how it compares to the library. */
export function projectStatus(root: string): ProjectSkill[] {
  const { skills } = readManifest(root);
  const skillsDir = projectSkillsDir(root);

  const managed = Object.entries(skills).map(([name, recorded]): ProjectSkill => {
    const local = treeHash(join(skillsDir, name));
    const lib = treeHash(librarySkillDir(name));
    const edited = local !== recorded;
    const updated = lib !== recorded;
    const state: SkillState =
      local === null
        ? "folder missing"
        : lib === null
          ? "not in library"
          : local === lib
            ? "ok"
            : edited && updated
              ? "edited locally, update available"
              : edited
                ? "edited locally"
                : "update available";
    return { name, managed: true, state };
  });

  const unmanaged = skillDirsIn(skillsDir)
    .map((dir) => basename(dir))
    .filter((name) => !(name in skills))
    .map((name): ProjectSkill => {
      const lib = treeHash(librarySkillDir(name));
      const state: SkillState =
        lib === null
          ? "local only"
          : lib === treeHash(join(skillsDir, name))
            ? "untracked copy of library skill"
            : "untracked, differs from library";
      return { name, managed: false, state };
    });

  return [...managed, ...unmanaged].sort((a, b) => a.name.localeCompare(b.name));
}

export type Change = { name: string; action: "installed" | "updated" | "removed" | "skipped"; reason?: string };

/** Copies a library skill into the project and records it. Refuses to clobber a folder with other content unless forced. */
export function addSkill(root: string, name: string, { force = false } = {}): Change {
  const from = librarySkillDir(name);
  const hash = treeHash(from);
  if (!hash) return { name, action: "skipped", reason: "not in the library" };

  const manifest = readManifest(root);
  const to = join(projectSkillsDir(root), name);
  const local = treeHash(to);
  const recorded = manifest.skills[name];

  if (local !== null && local !== hash && local !== recorded && !force) {
    return {
      name,
      action: "skipped",
      reason: recorded
        ? "has local edits (use --force to overwrite, or `skilllib import` to keep them)"
        : `.claude/skills/${name} already exists with different content (use --force to replace it)`,
    };
  }

  if (local !== hash) {
    mkdirSync(projectSkillsDir(root), { recursive: true });
    copySkill(from, to);
  }
  manifest.skills[name] = hash;
  writeManifest(root, manifest);
  return { name, action: recorded || local !== null ? "updated" : "installed" };
}

export function removeSkill(root: string, name: string, { force = false } = {}): Change {
  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  if (!recorded) return { name, action: "skipped", reason: "not managed by skilllib in this project" };

  const dir = join(projectSkillsDir(root), name);
  const local = treeHash(dir);
  if (local !== null && local !== recorded && local !== treeHash(librarySkillDir(name)) && !force) {
    return { name, action: "skipped", reason: "has local edits (use --force to delete anyway)" };
  }
  rmSync(dir, { recursive: true, force: true });
  delete manifest.skills[name];
  writeManifest(root, manifest);
  return { name, action: "removed" };
}

/** Brings every managed skill in the project up to date with the library, keeping local edits unless forced. */
export function syncProject(root: string, { force = false } = {}): Change[] {
  const { skills } = readManifest(root);
  return Object.keys(skills).flatMap((name): Change[] => {
    const lib = treeHash(librarySkillDir(name));
    if (lib === null) return [{ name, action: "skipped", reason: "no longer in the library" }];
    const before = treeHash(join(projectSkillsDir(root), name));
    if (before === lib) {
      if (skills[name] !== lib) addSkill(root, name);
      return [];
    }
    const change = addSkill(root, name, { force });
    return change.action === "skipped" ? [change] : [{ name, action: before === null ? "installed" : "updated" }];
  });
}

/**
 * Copies a skill folder into the library (new skill, or new content for an
 * existing one). Existing library skills are only overwritten with --force.
 */
export function importSkill(dir: string, { force = false } = {}): { name: string; status: "added" | "updated" | "unchanged" | "exists" } {
  const name = basename(dir);
  const to = librarySkillDir(name);
  const existing = treeHash(to);
  const incoming = treeHash(dir);
  if (existing === incoming) return { name, status: "unchanged" };
  if (existing !== null && !force) return { name, status: "exists" };
  mkdirSync(libraryDir(), { recursive: true });
  copySkill(dir, to);
  return { name, status: existing === null ? "added" : "updated" };
}

export function libraryExists(): boolean {
  return existsSync(libraryDir());
}
