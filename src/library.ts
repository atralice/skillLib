import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, libraryDir, PROJECT_SKILLS_DIR, skilllibHome } from "./paths.js";
import { ALL_PROJECT_DIRS, harness, installDirs, type HarnessId } from "./harnesses.js";
import { enabledHarnesses, readConfig, setKeepGlobal } from "./config.js";
import { knownProjects, readManifest, writeManifest, type Dependency } from "./project.js";
import { globalSkillDirs, originFor, recordOrigin } from "./sources.js";
import { copySkill, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";
import { forgetLatest, getVersion, latestVersion, versionDir, versionForHash } from "./versions.js";

export type LibrarySkill = { name: string; description: string; dir: string };

export function librarySkills(): LibrarySkill[] {
  return skillDirsIn(libraryDir()).map((dir) => ({
    name: basename(dir),
    description: readSkillInfo(dir).description,
    dir,
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
  | "local only"
  | "repo skill"
  | "repo skill, in library"
  | "repo skill, differs from library";

/** Which of your harnesses load a skill, and through how many paths (2+ may mean it's listed twice). */
export type Visibility = { id: HarnessId; paths: number }[];

export type ProjectSkill = {
  name: string;
  managed: boolean;
  state: SkillState;
  /** Installed version (managed skills). */
  version: number | null;
  /** Newest library version, if the skill is in the library. */
  latest: number | null;
  /** Project folder holding the real copy, e.g. ".claude/skills" or ".agents/skills". */
  location: string;
  path: string;
  visibility: Visibility;
};

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Links `link` to the folder `target`: a relative symlink on macOS/Linux (so
 * the repo can be moved), a directory junction on Windows (no admin rights or
 * Developer Mode needed; junctions need an absolute target).
 */
function linkDir(target: string, link: string) {
  if (process.platform === "win32") symlinkSync(target, link, "junction");
  else symlinkSync(relative(dirname(link), target), link);
}

function entryExists(path: string): boolean {
  return isLink(path) || existsSync(path);
}

/** Which enabled harnesses load `name` in this project, and via how many folder entries. */
export function visibilityOf(root: string, name: string, enabled: HarnessId[] = enabledHarnesses()): Visibility {
  return enabled.map((id) => ({
    id,
    paths: harness(id).projectDirs.filter((dir) => existsSync(join(root, dir, name, "SKILL.md"))).length,
  }));
}

/**
 * [real-copy folder, ...link folders] for a skill. An existing install keeps
 * its folder (switching harnesses never moves it), and so does an untracked
 * real copy being adopted, so tracking never leaves two copies. Links are
 * recorded ones plus any your current harnesses need; adding one moves nothing.
 */
function dependencyDirs(root: string, name: string, dep: Dependency | undefined): string[] {
  const wanted = installDirs(enabledHarnesses());
  const untracked = ALL_PROJECT_DIRS.find((d) => existsSync(join(root, d, name, "SKILL.md")) && !isLink(join(root, d, name)));
  const primary = dep ? (dep.dir ?? PROJECT_SKILLS_DIR) : (untracked ?? wanted[0]!);
  return [primary, ...new Set([...(dep?.links ?? []), ...wanted.filter((d) => d !== primary)])];
}

/** True when git tracks files under `dir` in `root` (so writing there shows up in git status). */
export function isGitTracked(root: string, dir: string): boolean {
  try {
    const out = execFileSync("git", ["ls-files", "--", dir], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Every skill in a project, managed or not. Reads every folder a supported
 * harness loads (.claude, .agents, .cursor, .codex skills); a link into
 * another of those folders is the same skill and reported once.
 */
export function projectStatus(root: string): ProjectSkill[] {
  const { skills } = readManifest(root);
  const enabled = enabledHarnesses();

  const managed = Object.entries(skills).map(([name, dep]): ProjectSkill => {
    const location = dep.dir ?? PROJECT_SKILLS_DIR;
    const path = join(root, location, name);
    const local = treeHash(path);
    const latest = latestVersion(name);
    const edited = local !== dep.hash;
    const behind = latest !== null && latest.hash !== dep.hash && latest.version > dep.version;
    const state: SkillState =
      local === null
        ? "folder missing"
        : latest === null
          ? "not in library"
          : local === latest.hash
            ? "ok"
            : edited && behind
              ? "edited locally, update available"
              : edited
                ? "edited locally"
                : behind
                  ? "update available"
                  : "ok";
    return {
      name,
      managed: true,
      state,
      version: dep.version || null,
      latest: latest?.version ?? null,
      location,
      path,
      visibility: visibilityOf(root, name, enabled),
    };
  });

  // Unmanaged skills: group entries by name, keep the real folder (links point at it).
  const seen = new Set(Object.keys(skills));
  const unmanaged: ProjectSkill[] = [];
  const byName = new Map<string, string[]>();
  for (const dir of ALL_PROJECT_DIRS) {
    for (const path of skillDirsIn(join(root, dir))) {
      const name = basename(path);
      if (seen.has(name)) continue;
      byName.set(name, [...(byName.get(name) ?? []), path]);
    }
  }
  for (const [name, paths] of byName) {
    const real = paths.find((p) => !isLink(p)) ?? paths[0]!;
    const location = relative(root, join(real, "..")).split(sep).join("/");
    const latest = latestVersion(name);
    const local = treeHash(real);
    const sameAsLibrary = latest !== null && (latest.hash === local || versionForHash(name, local ?? "") !== null);
    const committed = location === AGENTS_SKILLS_DIR;
    const state: SkillState = committed
      ? latest === null
        ? "repo skill"
        : sameAsLibrary
          ? "repo skill, in library"
          : "repo skill, differs from library"
      : latest === null
        ? "local only"
        : sameAsLibrary
          ? "untracked copy of library skill"
          : "untracked, differs from library";
    unmanaged.push({
      name,
      managed: false,
      state,
      version: null,
      latest: latest?.version ?? null,
      location,
      path: real,
      visibility: visibilityOf(root, name, enabled),
    });
  }

  return [...managed, ...unmanaged].sort((a, b) => a.name.localeCompare(b.name));
}

export type LinkResult = { created: string[]; blocked: string[] };

/**
 * Adds relative symlinks so every enabled harness loads a skill whose real
 * copy lives at `location`. Folders git tracks are skipped unless `allowTracked`.
 */
export function linkEverywhere(root: string, name: string, location: string, { allowTracked = false } = {}): LinkResult {
  const enabled = enabledHarnesses();
  const result: LinkResult = { created: [], blocked: [] };
  for (const id of enabled) {
    if (visibilityOf(root, name, [id])[0]!.paths > 0) continue;
    const dir = harness(id).projectDirs[0]!;
    const link = join(root, dir, name);
    if (entryExists(link)) continue;
    if (!allowTracked && isGitTracked(root, dir) && !readConfig().agentsDirOk?.includes(root)) {
      result.blocked.push(dir);
      continue;
    }
    mkdirSync(join(root, dir), { recursive: true });
    linkDir(join(root, location, name), link);
    result.created.push(dir);
  }
  return result;
}

/** Removes every symlink to this skill in the project's harness folders. Never touches real folders. */
export function unlinkEverywhere(root: string, name: string): string[] {
  return ALL_PROJECT_DIRS.filter((dir) => {
    const link = join(root, dir, name);
    if (!isLink(link)) return false;
    unlinkSync(link);
    return true;
  });
}

/** Adds links so every enabled harness loads a managed skill, and records them in skilllib.json. */
export function relinkDependency(root: string, name: string, { allowTracked = false } = {}): LinkResult {
  const manifest = readManifest(root);
  const dep = manifest.skills[name];
  if (!dep) return { created: [], blocked: [] };
  const result = linkEverywhere(root, name, dep.dir ?? PROJECT_SKILLS_DIR, { allowTracked });
  if (result.created.length) {
    manifest.skills[name] = { ...dep, links: [...new Set([...(dep.links ?? []), ...result.created])] };
    writeManifest(root, manifest);
  }
  return result;
}

/**
 * Makes every skill in the project usable by every enabled harness by adding
 * the missing links (the repo's own skills included; nothing is copied or moved).
 */
export function linkAll(root: string, { allowTracked = false } = {}): { linked: { name: string; into: string[] }[]; blocked: string[] } {
  const linked: { name: string; into: string[] }[] = [];
  const blocked = new Set<string>();
  for (const skill of projectStatus(root)) {
    if (!skill.visibility.some((v) => v.paths === 0) || skill.state === "folder missing") continue;
    const res = skill.managed ? relinkDependency(root, skill.name, { allowTracked }) : linkEverywhere(root, skill.name, skill.location, { allowTracked });
    if (res.created.length) linked.push({ name: skill.name, into: res.created });
    for (const dir of res.blocked) blocked.add(dir);
  }
  return { linked, blocked: [...blocked] };
}

export type Change = {
  name: string;
  action: "installed" | "updated" | "removed" | "skipped";
  reason?: string;
  from?: number;
  to?: number;
  /** Harness folders a link couldn't be written to because git tracks them. */
  blocked?: string[];
};

/**
 * Installs a library skill version (default: the newest) into the project and
 * records it as a dependency. The real copy goes in the first folder your
 * harnesses need (see installDirs); the others get links. Existing installs
 * keep their recorded folders. Refuses to clobber local edits unless forced.
 */
export function addSkill(
  root: string,
  name: string,
  { force = false, version, allowTracked = false }: { force?: boolean; version?: number; allowTracked?: boolean } = {},
): Change {
  const target = version === undefined ? latestVersion(name) : getVersion(name, version);
  if (!target) return { name, action: "skipped", reason: version === undefined ? "not in the library" : `version ${version} doesn't exist` };

  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  const [primary = PROJECT_SKILLS_DIR, ...linkDirs] = dependencyDirs(root, name, recorded);
  const to = join(root, primary, name);
  const local = isLink(to) && !recorded ? null : treeHash(to);
  const knownContent = local !== null && (local === recorded?.hash || versionForHash(name, local) !== null);

  if (local !== null && local !== target.hash && !knownContent && !force) {
    return {
      name,
      action: "skipped",
      reason: recorded
        ? "has local edits (use --force to overwrite, or save them to the library first)"
        : `${primary}/${name} already exists with different content (use --force to replace it)`,
    };
  }

  if (local !== target.hash || isLink(to)) {
    mkdirSync(join(root, primary), { recursive: true });
    if (isLink(to)) unlinkSync(to);
    copySkill(versionDir(name, target.version), to);
  }

  const links: string[] = [];
  const blocked: string[] = [];
  for (const dir of linkDirs) {
    const link = join(root, dir, name);
    if (isLink(link) && realpathOrNull(link) === realpathOrNull(to)) {
      links.push(dir);
      continue;
    }
    if (entryExists(link)) continue;
    if (!allowTracked && !recorded?.links?.includes(dir) && isGitTracked(root, dir) && !readConfig().agentsDirOk?.includes(root)) {
      blocked.push(dir);
      continue;
    }
    mkdirSync(join(root, dir), { recursive: true });
    linkDir(to, link);
    links.push(dir);
  }

  manifest.skills[name] = {
    version: target.version,
    hash: target.hash,
    ...(primary !== PROJECT_SKILLS_DIR ? { dir: primary } : {}),
    ...(links.length ? { links } : {}),
  };
  writeManifest(root, manifest);
  return {
    name,
    action: recorded || local !== null ? "updated" : "installed",
    ...(recorded ? { from: recorded.version } : {}),
    to: target.version,
    ...(blocked.length ? { blocked } : {}),
  };
}

export function removeSkill(root: string, name: string, { force = false } = {}): Change {
  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  if (!recorded) return { name, action: "skipped", reason: "not managed by skilllib in this project" };

  const dir = join(root, recorded.dir ?? PROJECT_SKILLS_DIR, name);
  const local = treeHash(dir);
  if (local !== null && local !== recorded.hash && !versionForHash(name, local) && !force) {
    return { name, action: "skipped", reason: "has local edits (use --force to delete anyway)" };
  }
  for (const linkDir of recorded.links ?? []) {
    const link = join(root, linkDir, name);
    if (isLink(link)) unlinkSync(link);
  }
  rmSync(dir, { recursive: true, force: true });
  delete manifest.skills[name];
  writeManifest(root, manifest);
  return { name, action: "removed" };
}

/**
 * Installs exactly the versions skilllib.json records (like `npm ci`):
 * restores missing folders and reverts nothing that was edited.
 */
export function syncProject(root: string, { force = false } = {}): Change[] {
  const { skills } = readManifest(root);
  return Object.entries(skills).flatMap(([name, dep]): Change[] => {
    const local = treeHash(join(root, dep.dir ?? PROJECT_SKILLS_DIR, name));
    const linksOk = (dep.links ?? []).every((d) => existsSync(join(root, d, name, "SKILL.md")));
    if (local === dep.hash && linksOk) return [];
    const pinned = dep.version > 0 && getVersion(name, dep.version) ? dep.version : undefined;
    if (local !== null && local !== dep.hash && !force) return [{ name, action: "skipped", reason: "has local edits (use --force to reset them)" }];
    const change = addSkill(root, name, { force: true, version: pinned });
    return change.action === "skipped" ? [change] : [{ ...change, action: local === null ? "installed" : "updated" }];
  });
}

/** Moves skills (default: all) to the newest library version, keeping local edits unless forced. */
export function updateProject(root: string, names?: string[], { force = false } = {}): Change[] {
  const { skills } = readManifest(root);
  return Object.keys(skills)
    .filter((name) => !names || names.includes(name))
    .flatMap((name): Change[] => {
      const latest = latestVersion(name);
      if (!latest) return [{ name, action: "skipped", reason: "no longer in the library" }];
      const dep = skills[name]!;
      const local = treeHash(join(root, dep.dir ?? PROJECT_SKILLS_DIR, name));
      if (dep.hash === latest.hash && local === latest.hash) return [];
      const change = addSkill(root, name, { force });
      return change.action === "skipped" || change.from !== change.to || local !== latest.hash ? [change] : [];
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
  const origin = originFor(dir);
  copySkill(dir, to);
  recordOrigin(name, origin);
  forgetLatest(name);
  latestVersion(name);
  return { name, status: existing === null ? "added" : "updated" };
}

function backupIndexFile(bucket: string): string {
  return join(skilllibHome(), bucket, "index.json");
}

function readBackupIndex(bucket: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(backupIndexFile(bucket), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Moves `dir` into ~/.skilllib/<bucket>/ instead of deleting it, remembering
 * where it came from so it can be restored there. Returns the new path.
 */
function stash(dir: string, bucket: string): string {
  // Unique even when several entries move in the same millisecond (a skill and its links).
  let at = Date.now();
  const entryAt = (ms: number) => `${basename(dir)}-${new Date(ms).toISOString().replace(/[:.]/g, "-")}`;
  while (entryExists(join(skilllibHome(), bucket, entryAt(at)))) at++;
  const entry = entryAt(at);
  const target = join(skilllibHome(), bucket, entry);
  mkdirSync(join(skilllibHome(), bucket), { recursive: true });
  renameSync(dir, target);
  writeFileSync(backupIndexFile(bucket), JSON.stringify({ ...readBackupIndex(bucket), [entry]: dir }, null, 2) + "\n");
  return target;
}

export function projectsUsing(name: string): string[] {
  return knownProjects().filter((p) => name in readManifest(p).skills);
}

/** Removes a skill from the library by moving it to ~/.skilllib/trash. Refuses while projects still use it. */
export function deleteLibrarySkill(name: string): { ok: true; movedTo: string } | { ok: false; reason: string } {
  const using = projectsUsing(name);
  if (using.length > 0) return { ok: false, reason: `still installed in ${using.map((p) => basename(p)).join(", ")}` };
  const dir = librarySkillDir(name);
  if (!existsSync(dir)) return { ok: false, reason: "not in the library" };
  forgetLatest(name);
  return { ok: true, movedTo: stash(dir, "trash") };
}

/**
 * Deletes one of your global skills without keeping a copy in Your skills.
 * Like everything skilllib removes, it goes to ~/.skilllib/global-backup and
 * can be restored from Health.
 */
export function deleteGlobal(path: string, links: string[] = []) {
  return unloadGlobal(path, links, { requireLibrary: false });
}

/**
 * Stops a global skill loading everywhere by moving it (and any global links
 * pointing at it, so none break) into ~/.skilllib/global-backup. A skill must
 * be in the library first, unless it's a broken link that loads nothing.
 * Once no global copy of it is left, it's no longer marked as kept global.
 */
export function unloadGlobal(
  path: string,
  links: string[] = [],
  { requireLibrary = true }: { requireLibrary?: boolean } = {},
): { ok: true; movedTo: string } | { ok: false; reason: string } {
  const name = basename(path);
  if (!entryExists(path) || name === "synced") return { ok: false, reason: "not a global skill" };
  const broken = !existsSync(join(path, "SKILL.md"));
  if (requireLibrary && !broken && latestVersion(name) === null) return { ok: false, reason: "import it into the library first" };
  for (const link of links) if (isLink(link)) stash(link, "global-backup");
  const movedTo = stash(path, "global-backup");
  if (!globalSkillDirs().some((d) => entryExists(join(d, name)))) setKeepGlobal([name], false);
  return { ok: true, movedTo };
}

/** Creates a new library skill with a starter SKILL.md. */
export function createSkill(name: string, description: string): { ok: true; dir: string } | { ok: false; reason: string } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { ok: false, reason: "use lowercase letters, digits and dashes" };
  const dir = librarySkillDir(name);
  if (existsSync(dir)) return { ok: false, reason: `${name} already exists` };
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description || "Describe when Claude should use this skill."}\n---\n\n# ${name}\n\nInstructions for Claude go here.\n`,
  );
  forgetLatest(name);
  return { ok: true, dir };
}

export type Backup = { name: string; kind: "trash" | "global-backup"; path: string; movedAt: string; from: string };

/** Everything skilllib moved out of the way, newest first. */
export function listBackups(): Backup[] {
  return (["trash", "global-backup"] as const)
    .flatMap((kind) => {
      const dir = join(skilllibHome(), kind);
      if (!existsSync(dir)) return [];
      const index = readBackupIndex(kind);
      return readdirSync(dir).flatMap((entry): Backup[] => {
        const match = entry.match(/^(.*)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}Z$/);
        if (!match) return [];
        const name = match[1]!;
        const from = index[entry] ?? (kind === "trash" ? librarySkillDir(name) : join(claudeDir(), "skills", name));
        return [{ name, kind, path: join(dir, entry), movedAt: `${match[2]} ${match[3]}:${match[4]}`, from }];
      });
    })
    .sort((a, b) => b.movedAt.localeCompare(a.movedAt));
}

/** Puts a backup back where it came from: trash → library, global-backup → ~/.claude/skills. */
export function restoreBackup(backup: Backup): { ok: true; to: string } | { ok: false; reason: string } {
  const to = backup.from;
  let taken = existsSync(to);
  try {
    taken = taken || lstatSync(to) !== null;
  } catch {
    // nothing there
  }
  if (taken) return { ok: false, reason: `${backup.name} already exists there` };
  mkdirSync(join(to, ".."), { recursive: true });
  renameSync(backup.path, to);
  forgetLatest(backup.name);
  return { ok: true, to };
}
