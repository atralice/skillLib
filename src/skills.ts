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
  // A byte-order mark (Notepad) before the frontmatter isn't content.
  const match = readFileSync(skillMd, "utf-8").replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fallback;
  try {
    const fm = parseYaml(match[1]!) as { name?: unknown; description?: unknown } | null;
    return {
      name: typeof fm?.name === "string" && fm.name ? fm.name : fallback.name,
      description: typeof fm?.description === "string" ? fm.description.trim() : "",
    };
  } catch {
    // Not valid YAML (an unquoted ": " in a description, often): read the two lines the way agents do.
    const line = (key: string) => match[1]!.match(new RegExp(`^${key}:[ \t]*(.*)$`, "m"))?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
    return { name: line("name") || fallback.name, description: line("description") };
  }
}

export function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

function listFiles(dir: string, seen = new Set<string>()): string[] {
  // A folder reached twice (a link back up, `self -> .`) is read once: no loop.
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  return readdirSync(dir)
    .filter((entry) => !IGNORED.has(entry))
    .flatMap((entry) => {
      const full = join(dir, entry);
      // A link to nothing has no content: skip it rather than fail on the whole skill.
      const st = statSync(full, { throwIfNoEntry: false });
      return !st ? [] : st.isDirectory() ? listFiles(full, seen) : [full];
    });
}

/**
 * Content hash of a skill folder: covers every file's path and bytes, so it
 * changes on any edit, addition, or deletion. Null if the folder is missing (or a file is where it goes).
 */
export function treeHash(dir: string): string | null {
  if (!isDir(dir)) return null;
  const hash = createHash("sha256");
  const files = listFiles(dir)
    .map((f) => ({ path: relative(dir, f).split(sep).join("/"), full: f }))
    // A fixed locale: hashes are shared in skilllib.json, so they mustn't depend on the machine's language.
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
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
  // Resolve first: if `from` is gone, this throws before `to` is deleted.
  const source = realpathSync(from);
  rmSync(to, { recursive: true, force: true });
  // existsSync: a link to nothing (dereferenced, there's nothing to copy) is left out.
  // A link back to the skill or above it (`self -> .`) would copy forever: it's left out.
  const loops = (src: string) => src !== source && ((r) => r === source || source.startsWith(r + sep))(realpathSync(src));
  cpSync(source, to, { recursive: true, dereference: true, filter: (src) => !IGNORED.has(basename(src)) && existsSync(src) && !loops(src) });
}

/** A folder (not a file someone left where a skills folder goes). */
export function isDir(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false; // a file above it in the path (Bun throws ENOTDIR here; Node returns undefined)
  }
}

/** Skill folders directly inside `dir` (folders containing SKILL.md). */
export function skillDirsIn(dir: string): string[] {
  if (!isDir(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && isSkillDir(join(dir, d.name)))
    .map((d) => join(dir, d.name))
    .sort();
}
