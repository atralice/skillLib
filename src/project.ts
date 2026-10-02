import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AGENTS_SKILLS_DIR, MANIFEST_FILE, PROJECT_SKILLS_DIR, realPath, skilllibHome, userHome } from "./paths.js";
import { versionForHash } from "./versions.js";

/**
 * skilllib.json: the library skills this project depends on, each with the
 * version installed and that version's content hash. Comparing the hash with
 * the project folder shows local edits; comparing the version with the
 * library's newest shows available updates.
 */
export type Dependency = {
  version: number;
  hash: string;
  /** Folder with the real copy; default ".claude/skills". */
  dir?: string;
  /** Other harness folders holding a link to it (e.g. ".agents/skills" for Codex). */
  links?: string[];
};
export type Manifest = { skills: Record<string, Dependency> };

/**
 * Nearest ancestor with skilllib.json, up to the git root; else the git root,
 * else `from`. The search stops at the git root (a .git folder, or the .git
 * file of a worktree or submodule): a skilllib.json above it belongs to
 * another checkout.
 */
export function findProjectRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, MANIFEST_FILE)) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

/**
 * The project you're in: the root findProjectRoot finds, but only a repo (or a
 * folder with skilllib.json) that isn't your home folder. Null otherwise:
 * outside a repo, the skill folders around you are the global ones.
 */
export function projectHere(from: string = process.cwd()): string | null {
  const root = findProjectRoot(from);
  return isProjectCandidate(root) && (existsSync(join(root, ".git")) || existsSync(join(root, MANIFEST_FILE))) ? root : null;
}

export function projectSkillsDir(root: string): string {
  return join(root, PROJECT_SKILLS_DIR);
}

export function agentsSkillsDir(root: string): string {
  return join(root, AGENTS_SKILLS_DIR);
}

export function readManifest(root: string): Manifest {
  const path = join(root, MANIFEST_FILE);
  if (!existsSync(path)) return { skills: {} };
  const data = JSON.parse(readFileSync(path, "utf-8")) as { skills?: Record<string, unknown> };
  const skills = Object.fromEntries(
    Object.entries(data.skills ?? {}).flatMap(([name, value]): [string, Dependency][] => {
      // Registry-era refs ("@owner/name": "^1.0.0") don't map to the library.
      if (name.startsWith("@")) return [];
      // 0.3 manifests stored just the hash.
      if (typeof value === "string") return [[name, { version: versionForHash(name, value)?.version ?? 0, hash: value }]];
      if (value && typeof value === "object" && "hash" in value) {
        const dep = value as Partial<Dependency>;
        return [
          [
            name,
            {
              version: Number(dep.version ?? 0),
              hash: String(dep.hash),
              ...(typeof dep.dir === "string" ? { dir: dep.dir } : {}),
              ...(Array.isArray(dep.links) ? { links: dep.links.map(String) } : {}),
            },
          ],
        ];
      }
      return [];
    }),
  );
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
  return onePerFolder(list.filter((p) => existsSync(p) && isProjectCandidate(p)));
}

/**
 * One path per real folder: a repo reached through a symlinked folder (a projects folder on another
 * drive, macOS /var → /private/var) is otherwise recorded twice, by scan and by commands run in it (#52).
 * Keeps the path you know, the one through the symlink.
 */
export function onePerFolder(paths: string[]): string[] {
  const byReal = new Map<string, string>();
  for (const p of paths) {
    const real = realPath(p);
    const seen = byReal.get(real);
    if (seen === undefined || (seen === real && p !== real)) byReal.set(real, p);
  }
  return [...new Set(byReal.values())];
}

/**
 * Your home directory holds ~/.claude/skills (the global skills), which looks
 * like a project but isn't one; every session would otherwise count as "in" it.
 */
export function isProjectCandidate(root: string): boolean {
  // Real paths: the folder you're in comes back without symlinks, while $HOME may go through one (#51).
  return realPath(root) !== realPath(userHome());
}

export function rememberProjects(roots: string[]) {
  const incoming = roots.map((r) => resolve(r)).filter(isProjectCandidate);
  const all = onePerFolder([...knownProjects(), ...incoming]).sort();
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(projectsFile(), JSON.stringify(all, null, 2) + "\n");
}
