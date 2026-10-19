import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MANIFEST_FILE, readState, realPath, skilllibHome, userHome, writeState } from "./paths.js";
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

export function readManifest(root: string): Manifest {
  const path = join(root, MANIFEST_FILE);
  if (!existsSync(path)) return { skills: {} };
  let data: { skills?: Record<string, unknown> };
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`${path} isn't valid JSON (a merge conflict?): fix it, then run skilllib again`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} isn't a skilllib.json (it should hold an object with "skills")`);
  const skills = Object.fromEntries(
    Object.entries(data.skills ?? {}).flatMap(([name, value]): [string, Dependency][] => {
      // Registry-era refs ("@owner/name": "^1.0.0") don't map to the library, and a name that isn't one folder
      // name (".", "..", a path) can't be a skill: reading on would copy outside the skill's folder.
      if (name.startsWith("@") || !name || name === "." || name === ".." || /[\\/]/.test(name)) return [];
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
  // A fixed locale: the file is shared, so its order must not depend on whose machine wrote it.
  const skills = Object.fromEntries(Object.entries(manifest.skills).sort(([a], [b]) => a.localeCompare(b, "en")));
  writeState(join(root, MANIFEST_FILE), { ...manifest, skills });
}

// ─── Known projects ─────────────────────────────────────

function projectsFile(): string {
  return join(skilllibHome(), "projects.json");
}

/** Projects skilllib has seen (via add/sync/scan) that still exist on disk. */
export function knownProjects(): string[] {
  const path = projectsFile();
  if (!existsSync(path)) return [];
  const list = readState<string[]>(path) ?? [];
  return onePerFolder(list.filter((p) => existsSync(p) && isProjectCandidate(p) && !isAgentWorktree(p)));
}

/**
 * A Claude Code agent worktree (<repo>/.claude/worktrees/<name>): a checkout of its repo,
 * not a project of its own. Agents create them constantly; remembering each would flood
 * projects and doctor.
 */
function isAgentWorktree(path: string): boolean {
  return /[\\/]\.claude[\\/]worktrees[\\/]/.test(path);
}

/**
 * One path per real folder: a repo reached through a symlinked folder (a projects folder on another
 * drive, macOS /var → /private/var) is otherwise recorded twice, by scan and by commands run in it (#52).
 * Keeps the path you know, the one through the symlink.
 */
function onePerFolder(paths: string[]): string[] {
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
  const incoming = roots.map((r) => resolve(r)).filter((r) => isProjectCandidate(r) && !isAgentWorktree(r));
  const all = onePerFolder([...knownProjects(), ...incoming]).sort();
  writeState(projectsFile(), all);
}

/** Repos whose skilllib.json can be read, and the ones that can't (a merge conflict): those are reported, not fatal. */
export function readableRoots(roots: string[]): { readable: string[]; unreadable: { root: string; reason: string }[] } {
  const unreadable: { root: string; reason: string }[] = [];
  const readable = roots.filter((root) => {
    try {
      readManifest(root);
      return true;
    } catch (err) {
      unreadable.push({ root, reason: (err as Error).message });
      return false;
    }
  });
  return { readable, unreadable };
}

/**
 * A repo's pins, for code that looks across every repo (who uses a skill): a skilllib.json that can't be read
 * (a merge conflict) counts as none, so one repo never breaks the others. doctor reports it (manifest:).
 */
export function pinsIn(root: string): Manifest["skills"] {
  try {
    return readManifest(root).skills;
  } catch {
    return {};
  }
}
