import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { claudeDir, codexHome, grokDir, MANIFEST_FILE, PROJECT_SKILLS_DIR, readState, realPath, skilllibHome, userHome, writeState } from "./paths.js";
import { versionForHash } from "./versions.js";
import { ALL_PROJECT_DIRS } from "./harnesses.js";

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
  /** In your personal pins (~/.skilllib/pins), not the repo's skilllib.json. Never written to a file. */
  personal?: boolean;
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

/** A pins file (skilllib.json, or one of your personal ones), checked as sync and remove need it. */
function readPins(path: string): Manifest {
  if (!existsSync(path)) return { skills: {} };
  let data: { skills?: Record<string, unknown> };
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`${path} isn't valid JSON (a merge conflict?): fix it, then run skilllib again`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || (data.skills !== undefined && (typeof data.skills !== "object" || data.skills === null || Array.isArray(data.skills))))
    throw new Error(`${path} isn't a skilllib.json (it should hold an object with "skills": { name: pin })`);
  const skills = Object.fromEntries(
    Object.entries(data.skills ?? {}).flatMap(([name, value]): [string, Dependency][] => {
      // Registry-era refs ("@owner/name": "^1.0.0") don't map to the library, and a name that isn't one folder
      // name (".", "..", a path) can't be a skill: reading on would copy outside the skill's folder.
      if (name.startsWith("@") || !name || name === "." || name === ".." || /[\\/]/.test(name)) return [];
      // 0.3 manifests stored just the hash.
      if (typeof value === "string") return [[name, { version: versionForHash(name, value)?.version ?? 0, hash: value }]];
      if (value && typeof value === "object" && "hash" in value) {
        const dep = value as Partial<Dependency>;
        // dir and links name the repo's own skill folders: anything else (a "../" path, "") would make sync and
        // remove write or delete outside the repo. A skilllib.json that says so is wrong: say so, don't guess.
        const folders = [...(typeof dep.dir === "string" ? [dep.dir] : []), ...(Array.isArray(dep.links) ? dep.links.map(String) : [])];
        const bad = folders.find((d) => !(ALL_PROJECT_DIRS as readonly string[]).includes(d));
        if (bad !== undefined) throw new Error(`${path} isn't a valid skilllib.json: ${name}'s folder "${bad}" isn't a skill folder (${ALL_PROJECT_DIRS.join(", ")})`);
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
      throw new Error(`${path} isn't a valid skilllib.json: ${name}'s pin has no hash`);
    }),
  );
  return { ...data, skills };
}

/**
 * The project's pins: its skilllib.json, and your personal pins for it (marked `personal`). A skill in both is
 * the repo's: skilllib.json wins, and doctor reports the personal one (personalShadowed).
 */
export function readManifest(root: string): Manifest {
  const shared = readPins(join(root, MANIFEST_FILE));
  const file = personalPinsFile(root);
  const personal = file ? readPins(file).skills : {};
  const mine = Object.fromEntries(Object.entries(personal).map(([name, dep]) => [name, { ...dep, personal: true }]));
  return { ...shared, skills: { ...mine, ...shared.skills } };
}

/** Pins in a fixed order: a fixed locale, so the order doesn't depend on whose machine wrote the file. */
const sorted = (skills: Manifest["skills"]) => Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b, "en")));

/**
 * Writes a project's pins back where each came from: personal ones to your pins file, the rest to skilllib.json
 * (created only when it has some). A personal pin the repo's skilllib.json hides stays as it was. The installed
 * copies of personal skills are kept out of git (see excludePersonal).
 */
export function writeManifest(root: string, manifest: Manifest) {
  const shared = Object.fromEntries(Object.entries(manifest.skills).filter(([, d]) => !d.personal));
  const mine = Object.fromEntries(Object.entries(manifest.skills).flatMap(([name, d]) => (d.personal ? [[name, withoutMark(d)]] : [])));
  const path = join(root, MANIFEST_FILE);
  const onDisk = readPins(path).skills;
  if (existsSync(path) || Object.keys(shared).length) writeChanged(path, { ...manifest, skills: sorted(shared) });
  const file = personalPinsFile(root);
  if (!file) {
    if (Object.keys(mine).length) throw new Error(`${root} isn't the top folder of a git repo, so it can't have personal pins`);
    return;
  }
  // Hidden by a pin skilllib.json already had: kept. One that just moved there (add --shared) goes.
  for (const [name, dep] of Object.entries(readPins(file).skills)) if (onDisk[name] && manifest.skills[name] && !manifest.skills[name]!.personal) mine[name] = dep;
  if (Object.keys(mine).length) writeChanged(file, { ...personalKey(root), skills: sorted(mine) });
  else rmSync(file, { force: true });
  excludePersonal(root, mine);
}

/** writeState, unless the file already holds this: a personal change never touches skilllib.json, not even its spacing. */
function writeChanged(path: string, data: { skills: Manifest["skills"] }) {
  try {
    if (JSON.stringify(JSON.parse(readFileSync(path, "utf-8"))) === JSON.stringify(data)) return;
  } catch {
    // Missing, or not JSON: written.
  }
  writeState(path, data);
}

function withoutMark(dep: Dependency): Dependency {
  const { personal: _, ...rest } = dep;
  return rest;
}

/** Whether a project has any pins: a skilllib.json, or personal ones. */
export function hasPins(root: string): boolean {
  if (existsSync(join(root, MANIFEST_FILE))) return true;
  const file = personalPinsFile(root);
  return !!file && existsSync(file);
}

// ─── Personal pins ──────────────────────────────────────

/** Where your personal pins live, one file per repo. Keep it in git with your library to take them to other machines. */
export function personalPinsDir(): string {
  return join(skilllibHome(), "pins");
}

function gitIn(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * A remote's URL as one name for the repo, whichever way it was cloned: git@github.com:a/b.git,
 * https://github.com/a/b and ssh://git@github.com:22/a/b are all github.com/a/b.
 */
export function normalizeRemote(url: string): string {
  let s = url.trim();
  const scp = s.match(/^[^/@:]+@([^/:]+):(?!\/)(.*)$/);
  if (scp) s = `${scp[1]}/${scp[2]}`;
  else s = s.replace(/^[a-z+]+:\/\//i, "").replace(/^[^/@]+@/, "").replace(/^([^/:]+):\d+\//, "$1/");
  return s.replace(/\.git\/?$/, "").replace(/\/+$/, "").toLowerCase();
}

function nativePath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return realPath(p);
  }
}

const keys = new Map<string, { remote: string } | { path: string } | null>();

/**
 * What names a repo across clones, worktrees and machines: its origin remote (else its first). A repo with no
 * remote is named by its folder (the main checkout's, so its worktrees share it), and its pins stay on this
 * machine. Null for anything but the top folder of a git repo: only those can have personal pins.
 */
function personalKey(root: string): { remote: string } | { path: string } | null {
  const real = realPath(root);
  if (keys.has(real)) return keys.get(real)!;
  const prefix = gitIn(root, ["rev-parse", "--show-prefix"]);
  // Not a repo git can read: not kept, since a folder can become one (git init) while the app is open.
  if (prefix === null) return null;
  let key: { remote: string } | { path: string } | null = null;
  if (prefix === "") {
    const remote = gitIn(root, ["remote", "get-url", "origin"]) || ((first) => (first ? gitIn(root, ["remote", "get-url", first]) : null))(gitIn(root, ["remote"])?.split("\n")[0]);
    if (remote) key = { remote: normalizeRemote(remote) };
    else {
      // As the disk spells it (the native realpath): Windows can hand out a short name (RUNNER~1) for one checkout and
      // the long one for its worktree, and the key must be the same for both.
      const common = gitIn(root, ["rev-parse", "--git-common-dir"]);
      const dir = nativePath(common ? resolve(root, common) : root);
      key = { path: basename(dir) === ".git" ? dirname(dir) : dir };
    }
  }
  keys.set(real, key);
  return key;
}

/** Your personal pins file for this repo, or null when it can't have one (see personalKey). It may not exist yet. */
export function personalPinsFile(root: string): string | null {
  const key = personalKey(root);
  if (!key) return null;
  const name = "remote" in key ? key.remote : `local-${basename(key.path)}`;
  const slug = name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const id = createHash("sha1").update("remote" in key ? key.remote : key.path).digest("hex").slice(0, 8);
  return join(personalPinsDir(), `${slug}-${id}.json`);
}

/** Your personal pins for a repo as the file has them, the ones its skilllib.json hides included. */
export function personalPins(root: string): Manifest["skills"] {
  const file = personalPinsFile(root);
  return file ? readPins(file).skills : {};
}

/** Drops a personal pin, leaving its installed copy alone (the repo's skilllib.json pins the same skill). */
export function dropPersonalPin(root: string, name: string) {
  const file = personalPinsFile(root);
  if (!file) return;
  const { [name]: _, ...rest } = readPins(file).skills;
  if (Object.keys(rest).length) writeChanged(file, { ...personalKey(root), skills: sorted(rest) });
  else rmSync(file, { force: true });
  excludePersonal(root);
}

const EXCLUDE_START = "# skilllib: personal skills (kept by skilllib; don't edit)";
const EXCLUDE_END = "# end skilllib";

/**
 * Keeps personal skills' copies and links out of git: one block in the repo's info/exclude (this clone only,
 * shared by its worktrees), rewritten from the pins each time. Nothing is written when it's already right.
 */
export function excludePersonal(root: string, skills: Manifest["skills"] = Object.fromEntries(Object.entries(readManifest(root).skills).filter(([, d]) => d.personal))) {
  const at = gitIn(root, ["rev-parse", "--git-path", "info/exclude"]);
  if (!at) return;
  const file = resolve(root, at);
  const text = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const lines = text.split("\n");
  const start = lines.indexOf(EXCLUDE_START);
  const end = start === -1 ? -1 : lines.indexOf(EXCLUDE_END, start);
  const rest = start === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end === -1 ? lines.length : end + 1)];
  while (rest.length && rest[rest.length - 1] === "") rest.pop();
  // No trailing slash: a link is a file to git, and "x/" only matches folders.
  const paths = Object.entries(skills).flatMap(([name, d]) => [d.dir ?? PROJECT_SKILLS_DIR, ...(d.links ?? [])].map((dir) => `/${dir}/${name}`));
  const block = paths.length ? [EXCLUDE_START, ...[...new Set(paths)].sort(), EXCLUDE_END] : [];
  const next = [...rest, ...(rest.length && block.length ? [""] : []), ...block].join("\n") + (rest.length || block.length ? "\n" : "");
  if (next === text) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
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
  // Real paths: the folder you're in comes back without symlinks, while $HOME may go through one (#51). Nor is a
  // folder of skilllib's or an agent's own (~/.skilllib, ~/.claude...), even when it's a git repo (a library you share).
  const real = realPath(root);
  const own = [userHome(), skilllibHome(), claudeDir(), codexHome(), grokDir(), join(userHome(), ".agents"), join(userHome(), ".cursor")];
  return !own.some((d) => realPath(d) === real);
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
