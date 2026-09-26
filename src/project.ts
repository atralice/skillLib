import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MANIFEST_FILE, PROJECT_SKILLS_DIR, skilllibHome } from "./paths.js";

/**
 * skilllib.json: the library skills this project uses, each with the hash of
 * the copy that was installed. Comparing that hash with the project folder
 * shows local edits; comparing it with the library shows available updates.
 */
export type Manifest = { skills: Record<string, string> };

/** Nearest ancestor with skilllib.json, else the git root, else `from`. */
export function findProjectRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  let gitRoot: string | null = null;
  while (true) {
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
    if (!gitRoot && existsSync(join(dir, ".git"))) gitRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) return gitRoot ?? resolve(from);
    dir = parent;
  }
}

export function projectSkillsDir(root: string): string {
  return join(root, PROJECT_SKILLS_DIR);
}

export function readManifest(root: string): Manifest {
  const path = join(root, MANIFEST_FILE);
  if (!existsSync(path)) return { skills: {} };
  const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<Manifest>;
  // Older skilllib.json files listed "@owner/name" refs with version ranges; they don't map to the library.
  const skills = Object.fromEntries(Object.entries(data.skills ?? {}).filter(([name]) => !name.startsWith("@")));
  return { ...data, skills };
}

export function writeManifest(root: string, manifest: Manifest) {
  const skills = Object.fromEntries(Object.entries(manifest.skills).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, MANIFEST_FILE), JSON.stringify({ ...manifest, skills }, null, 2) + "\n");
}

// ─── Known projects ─────────────────────────────────────

function projectsFile(): string {
  return join(skilllibHome(), "projects.json");
}

/** Projects skilllib has seen (via add/sync/scan) that still exist on disk. */
export function knownProjects(): string[] {
  const path = projectsFile();
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, "utf-8")) as string[];
  return list.filter((p) => existsSync(p) && isProjectCandidate(p));
}

/**
 * Your home directory holds ~/.claude/skills (the global skills), which looks
 * like a project but isn't one; every session would otherwise count as "in" it.
 */
export function isProjectCandidate(root: string): boolean {
  return resolve(root) !== homedir();
}

export function rememberProjects(roots: string[]) {
  const incoming = roots.map((r) => resolve(r)).filter(isProjectCandidate);
  const all = [...new Set([...knownProjects(), ...incoming])].sort();
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(projectsFile(), JSON.stringify(all, null, 2) + "\n");
}
