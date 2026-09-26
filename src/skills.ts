import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";

const IGNORED = new Set([".DS_Store", ".git", "node_modules"]);

export type SkillInfo = { name: string; description: string };

/** Name and description from SKILL.md frontmatter, falling back to the folder name. */
export function readSkillInfo(dir: string): SkillInfo {
  const skillMd = join(dir, "SKILL.md");
  const fallback = { name: basename(dir), description: "" };
  if (!existsSync(skillMd)) return fallback;
  const match = readFileSync(skillMd, "utf-8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fallback;
  try {
    const fm = parseYaml(match[1]!) as { name?: unknown; description?: unknown } | null;
    return {
      name: typeof fm?.name === "string" && fm.name ? fm.name : fallback.name,
      description: typeof fm?.description === "string" ? fm.description.trim() : "",
    };
  } catch {
    return fallback;
  }
}

export function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => !IGNORED.has(entry))
    .flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
}

/**
 * Content hash of a skill folder: covers every file's path and bytes, so it
 * changes on any edit, addition, or deletion. Null if the folder is missing.
 */
export function treeHash(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const hash = createHash("sha256");
  const files = listFiles(dir)
    .map((f) => ({ path: relative(dir, f).split(sep).join("/"), full: f }))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    hash.update(file.path).update("\0").update(createHash("sha256").update(readFileSync(file.full)).digest("hex")).update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Replaces `to` with a real copy of `from`. Symlinks are followed so the copy
 * never points back at the original: many global skills are symlinks into
 * ~/.agents/skills, and editing a copy must not edit the source.
 */
export function copySkill(from: string, to: string) {
  rmSync(to, { recursive: true, force: true });
  cpSync(realpathSync(from), to, { recursive: true, dereference: true, filter: (src) => !IGNORED.has(basename(src)) });
}

/** Skill folders directly inside `dir` (folders containing SKILL.md). */
export function skillDirsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && isSkillDir(join(dir, d.name)))
    .map((d) => join(dir, d.name))
    .sort();
}
