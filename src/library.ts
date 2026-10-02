import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, GROK_SKILLS_DIR, isRepoSkillLocation, libraryDir, PROJECT_SKILLS_DIR, skilllibHome } from "./paths.js";
import { ALL_PROJECT_DIRS, harness, installDirs, type HarnessId } from "./harnesses.js";
import { enabledHarnesses, readConfig, setKeepGlobal } from "./config.js";
import { knownProjects, readManifest, writeManifest, type Dependency } from "./project.js";
import { globalSkillDirs, libraryOrigins, originFor, projectSkillsLock, recordOrigin } from "./sources.js";
import { copySkill, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";
import { tildify } from "./output.js";
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
  | "repo skill, differs from library"
  | "from npx skills";

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
  /** Where `npx skills add` got it (from the project's skills-lock.json), e.g. "genmedia-labs/skills". */
  source?: string;
};

export function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function isLink(path: string): boolean {
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
export function linkDir(target: string, link: string) {
  if (process.platform === "win32") symlinkSync(target, link, "junction");
  else symlinkSync(relative(dirname(link), target), link);
}

export function entryExists(path: string): boolean {
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
  // .grok/skills is the team's folder. Adopting it would make add overwrite it and remove delete it.
  const untracked = ALL_PROJECT_DIRS.find((d) => d !== GROK_SKILLS_DIR && existsSync(join(root, d, name, "SKILL.md")) && !isLink(join(root, d, name)));
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
 * harness loads (.claude, .agents, .cursor, .codex, .grok skills); a link into
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
  const lock = projectSkillsLock(root);
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
    const source = lock[name]?.source;
    unmanaged.push({
      name,
      managed: false,
      state: unmanagedState(name, real, isRepoSkillLocation(location), source),
      version: null,
      latest: latestVersion(name)?.version ?? null,
      location,
      path: real,
      visibility: visibilityOf(root, name, enabled),
      ...(source ? { source } : {}),
    });
  }

  return [...managed, ...unmanaged].sort((a, b) => a.name.localeCompare(b.name));
}

/** A skill skilllib doesn't manage, compared with the library. `committed`: it's in a folder repos commit (.agents/skills or .grok/skills). */
function unmanagedState(name: string, real: string, committed: boolean, source: string | undefined): SkillState {
  if (source) return "from npx skills";
  const latest = latestVersion(name);
  const local = treeHash(real);
  const sameAsLibrary = latest !== null && (latest.hash === local || versionForHash(name, local ?? "") !== null);
  if (committed) return latest === null ? "repo skill" : sameAsLibrary ? "repo skill, in library" : "repo skill, differs from library";
  return latest === null ? "local only" : sameAsLibrary ? "untracked copy of library skill" : "untracked, differs from library";
}

/** Nested skill folders and who reads them (Zed reads only the worktree root). */
const NESTED_READERS: [string, HarnessId[]][] = [
  [PROJECT_SKILLS_DIR, ["claude-code", "cursor", "grok"]],
  [AGENTS_SKILLS_DIR, ["codex", "cursor", "grok"]],
  [".cursor/skills", ["cursor", "grok"]],
  [".codex/skills", ["codex", "cursor"]],
  // Cursor reads nested .grok/skills too, but skilllib doesn't count it: that folder stays Grok's.
  [".grok/skills", ["grok"]],
];

/** Folders never searched for nested skills: dependencies and build output. */
const NESTED_SKIP = new Set(["node_modules", "dist", "build", "out", "vendor", "target", "coverage"]);

/**
 * Skill folders below a repo's root, as monorepos have (packages/web/.claude/skills).
 * Claude Code loads <folder>/.claude/skills when you work on files in <folder>;
 * Cursor does the same with .agents, .cursor, .claude and .codex skills; Codex loads
 * <folder>/.agents/skills and <folder>/.codex/skills when it starts there (it walks up to the repo root). They're reported apart from projectStatus: they aren't repo-wide,
 * so linking, tracking or tidying them into the root folders would change who loads them.
 * A nested git repo is a project of its own and isn't searched.
 */
export function nestedSkills(root: string, { depth = 3, enabled = enabledHarnesses() }: { depth?: number; enabled?: HarnessId[] } = {}): ProjectSkill[] {
  const found: ProjectSkill[] = [];
  const walk = (dir: string, left: number) => {
    let subs: string[] = [];
    try {
      subs = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !NESTED_SKIP.has(d.name))
        .map((d) => join(dir, d.name));
    } catch {
      return;
    }
    for (const sub of subs) {
      if (existsSync(join(sub, ".git"))) continue;
      for (const [skillsDir, readers] of NESTED_READERS) {
        const location = relative(root, join(sub, skillsDir)).split(sep).join("/");
        for (const path of skillDirsIn(join(sub, skillsDir))) {
          // A link to a skill elsewhere in the repo is that skill, already reported.
          if (isLink(path) && (realpathOrNull(path) ?? "").startsWith((realpathOrNull(root) ?? root) + sep)) continue;
          const name = basename(path);
          found.push({
            name,
            managed: false,
            state: unmanagedState(name, path, isRepoSkillLocation(skillsDir), undefined),
            version: null,
            latest: latestVersion(name)?.version ?? null,
            location,
            path,
            visibility: enabled.map((id) => ({ id, paths: readers.includes(id) ? 1 : 0 })),
          });
        }
      }
      if (left > 1) walk(sub, left - 1);
    }
  };
  walk(root, depth);
  return found.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
}

/**
 * Whether teammates get a skill's real copy through git: it's committed, or new
 * in a folder the repo commits (so it goes in with that folder). A copy in a
 * folder git doesn't track, or a gitignored one, stays on this machine.
 */
export function sharedByGit(root: string, location: string, name: string): boolean {
  const copy = `${location}/${name}`;
  if (isGitTracked(root, copy)) return true;
  if (!isGitTracked(root, location)) return false;
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", copy], { cwd: root, stdio: "ignore" });
    return false; // exit 0: ignored
  } catch {
    return true;
  }
}

/**
 * created: folders that got a link · blocked: folders git tracks, skipped without
 * your consent · uncommitted: folders git tracks, skipped because git doesn't share
 * the real copy (a committed link to it would be broken for teammates).
 */
export type LinkResult = { created: string[]; blocked: string[]; uncommitted: string[] };

/**
 * Adds relative symlinks so every enabled harness loads a skill whose real
 * copy lives at `location`. Folders git tracks are skipped unless `allowTracked`,
 * and always when git doesn't share the real copy. `dryRun`: what it would do, changing nothing.
 */
export function linkEverywhere(root: string, name: string, location: string, { allowTracked = false, dryRun = false } = {}): LinkResult {
  const enabled = enabledHarnesses();
  const result: LinkResult = { created: [], blocked: [], uncommitted: [] };
  let shared: boolean | undefined;
  for (const id of enabled) {
    if (visibilityOf(root, name, [id])[0]!.paths > 0) continue;
    const dir = harness(id).projectDirs[0]!;
    const link = join(root, dir, name);
    // Agents can share a folder (Codex and Zed both read .agents/skills): one entry each.
    if (entryExists(link) || Object.values(result).some((dirs) => dirs.includes(dir))) continue;
    if (isGitTracked(root, dir)) {
      if (!(shared ??= sharedByGit(root, location, name))) {
        if (!result.uncommitted.includes(dir)) result.uncommitted.push(dir);
        continue;
      }
      if (!allowTracked && !readConfig().agentsDirOk?.includes(root)) {
        // Codex and Zed share .agents/skills: one folder, listed once.
        if (!result.blocked.includes(dir)) result.blocked.push(dir);
        continue;
      }
    }
    if (!dryRun) {
      mkdirSync(join(root, dir), { recursive: true });
      linkDir(join(root, location, name), link);
    }
    result.created.push(dir);
  }
  return result;
}

/**
 * Removes symlinks to this skill in the project's harness folders. Never touches a real folder.
 * A link in .grok/skills stays unless it already dangles, or it points at `removing` (the copy
 * about to go away). Leaving that link would make Grok load a path that no longer exists.
 */
export function unlinkEverywhere(root: string, name: string, removing?: string): string[] {
  const gone = removing ? realpathOrNull(removing) : null;
  return ALL_PROJECT_DIRS.filter((dir) => {
    const link = join(root, dir, name);
    if (!isLink(link)) return false;
    if (dir === GROK_SKILLS_DIR) {
      const target = realpathOrNull(link);
      if (target !== null && target !== gone) return false;
    }
    unlinkSync(link);
    return true;
  });
}

/** Adds links so every enabled harness loads a managed skill, and records them in skilllib.json. */
export function relinkDependency(root: string, name: string, { allowTracked = false } = {}): LinkResult {
  const manifest = readManifest(root);
  const dep = manifest.skills[name];
  if (!dep) return { created: [], blocked: [], uncommitted: [] };
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
 * `uncommitted`: skills kept out of folders git tracks, since git doesn't share their real copy.
 */
export function linkAll(
  root: string,
  { allowTracked = false } = {},
): { linked: { name: string; into: string[] }[]; blocked: string[]; uncommitted: string[] } {
  const linked: { name: string; into: string[] }[] = [];
  const blocked = new Set<string>();
  const uncommitted: string[] = [];
  for (const skill of projectStatus(root)) {
    if (!skill.visibility.some((v) => v.paths === 0) || skill.state === "folder missing") continue;
    const res = skill.managed ? relinkDependency(root, skill.name, { allowTracked }) : linkEverywhere(root, skill.name, skill.location, { allowTracked });
    if (res.created.length) linked.push({ name: skill.name, into: res.created });
    for (const dir of res.blocked) blocked.add(dir);
    if (res.uncommitted.length) uncommitted.push(skill.name);
  }
  return { linked, blocked: [...blocked], uncommitted };
}

export type Change = {
  name: string;
  /** reset: back to the version it had; its local edits were overwritten (and backed up, see `backedUp`). */
  action: "installed" | "updated" | "reset" | "removed" | "skipped";
  reason?: string;
  from?: number;
  to?: number;
  /** Harness folders a link couldn't be written to because git tracks them. */
  blocked?: string[];
  /** Harness folders git tracks, left without a link because git doesn't share the real copy (teammates would get a broken link). */
  uncommitted?: string[];
  /** Where overwritten local edits went (~/.skilllib/edit-backup/…); `skilllib restore` puts them back. */
  backedUp?: string;
};

/**
 * Installs a library skill version (default: the newest) into the project and
 * records it as a dependency. The real copy goes in the first folder your
 * harnesses need (see installDirs); the others get links. Existing installs
 * keep their recorded folders. Refuses to clobber local edits unless forced;
 * forced, content the library doesn't have goes to ~/.skilllib/edit-backup first.
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

  let backedUp: string | undefined;
  if (local !== target.hash || isLink(to)) {
    mkdirSync(join(root, primary), { recursive: true });
    if (isLink(to)) unlinkSync(to);
    else if (local !== null && !knownContent) backedUp = stash(to, "edit-backup");
    copySkill(versionDir(name, target.version), to);
  }

  const links: string[] = [];
  const blocked: string[] = [];
  const uncommitted: string[] = [];
  let shared: boolean | undefined;
  for (const dir of linkDirs) {
    const link = join(root, dir, name);
    if (isLink(link) && realpathOrNull(link) === realpathOrNull(to)) {
      links.push(dir);
      continue;
    }
    if (entryExists(link)) continue;
    // A new link in a folder git tracks, as linkEverywhere: never when git doesn't share the real copy, else with your consent.
    if (!recorded?.links?.includes(dir) && isGitTracked(root, dir)) {
      if (!(shared ??= sharedByGit(root, primary, name))) {
        uncommitted.push(dir);
        continue;
      }
      if (!allowTracked && !readConfig().agentsDirOk?.includes(root)) {
        blocked.push(dir);
        continue;
      }
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
    action: !recorded && local === null ? "installed" : backedUp && recorded?.version === target.version ? "reset" : "updated",
    ...(recorded ? { from: recorded.version } : {}),
    to: target.version,
    ...(blocked.length ? { blocked } : {}),
    ...(uncommitted.length ? { uncommitted } : {}),
    ...(backedUp ? { backedUp } : {}),
  };
}

export function removeSkill(root: string, name: string, { force = false } = {}): Change {
  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  if (!recorded) return { name, action: "skipped", reason: "not managed by skilllib in this project" };

  const dir = join(root, recorded.dir ?? PROJECT_SKILLS_DIR, name);
  const local = treeHash(dir);
  const edited = local !== null && local !== recorded.hash && !versionForHash(name, local);
  if (edited && !force) return { name, action: "skipped", reason: "has local edits (use --force to delete anyway)" };
  for (const linkDir of recorded.links ?? []) {
    const link = join(root, linkDir, name);
    if (isLink(link)) unlinkSync(link);
  }
  // Forced over local edits: the edited copy goes to ~/.skilllib/edit-backup, as update and sync do.
  const backedUp = edited ? stash(dir, "edit-backup") : undefined;
  if (!backedUp) rmSync(dir, { recursive: true, force: true });
  delete manifest.skills[name];
  writeManifest(root, manifest);
  return { name, action: "removed", ...(backedUp ? { backedUp } : {}) };
}

/**
 * Installs exactly the versions skilllib.json records (like `npm ci`):
 * restores missing folders and reverts nothing that was edited (forced, it
 * resets edited skills; the edits go to ~/.skilllib/edit-backup).
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
    // Only skipped when the library has no version of it: a teammate's skill, or another machine's library.
    if (change.action === "skipped") return [{ ...change, reason: `not in your library (${tildify(libraryDir())}); import it, or set SKILLLIB_HOME to the library that has it` }];
    return [{ ...change, action: local === null ? "installed" : change.action }];
  });
}

/**
 * Puts a managed skill back to the version skilllib.json pins (or the newest,
 * if none is pinned). The edited copy goes to ~/.skilllib/edit-backup first,
 * restorable from Health.
 */
export function discardEdits(root: string, name: string): Change {
  const dep = readManifest(root).skills[name];
  if (!dep) return { name, action: "skipped", reason: "not managed by skilllib in this project" };
  const dir = join(root, dep.dir ?? PROJECT_SKILLS_DIR, name);
  const pinned = dep.version > 0 && getVersion(name, dep.version) ? dep.version : undefined;
  if (existsSync(dir) && !isLink(dir)) stash(dir, "edit-backup");
  return addSkill(root, name, { force: true, version: pinned });
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
      // Already on the newest version: local edits are `sync --force`'s business, not an update's.
      if (dep.hash === latest.hash && local !== null && !force) return [];
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
  // A new version keeps where the skill first came from (saving a repo's edits doesn't make it "from that repo").
  const origin = existing !== null && libraryOrigins()[name] ? null : originFor(dir);
  copySkill(dir, to);
  if (origin) recordOrigin(name, origin);
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
export function stash(dir: string, bucket: string): string {
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

/**
 * Removes a skill folder skilllib doesn't track (an untracked copy) and its links.
 * The folder goes to the trash, restorable from Settings like everything skilllib removes.
 */
export function removeUntracked(root: string, name: string, path: string): string {
  unlinkEverywhere(root, name, path);
  return stash(path, "trash");
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

/**
 * Makes a global skill reach agents that can't see it, with a link in each
 * one's first global folder (~/.claude/skills for Claude Code, ~/.agents/skills
 * for the others). Nothing is copied or moved. A broken link in the way is
 * replaced; a folder already holding a different skill by that name is left
 * alone and reported.
 */
export function linkGlobal(path: string, agents: HarnessId[]): { linked: string[]; skipped: string[] } {
  const name = basename(path);
  const linked: string[] = [];
  const skipped: string[] = [];
  for (const dir of new Set(agents.map((id) => harness(id).globalDirs()[0]!))) {
    const link = join(dir, name);
    if (isLink(link) && realpathOrNull(link) === null) unlinkSync(link);
    else if (entryExists(link)) {
      if (realpathOrNull(link) !== realpathOrNull(path)) skipped.push(link);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    linkDir(path, link);
    linked.push(link);
  }
  return { linked, skipped };
}

/** Creates a new library skill with a starter SKILL.md. */
export function createSkill(name: string, description: string): { ok: true; dir: string } | { ok: false; reason: string } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { ok: false, reason: "use lowercase letters, digits and dashes" };
  const dir = librarySkillDir(name);
  if (existsSync(dir)) return { ok: false, reason: `${name} already exists` };
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description || "Describe when an agent should use this skill."}\n---\n\n# ${name}\n\nInstructions for the agent go here.\n`,
  );
  forgetLatest(name);
  return { ok: true, dir };
}

/**
 * trash: deleted from the library · global-backup: unloaded from global ·
 * tidy-backup: a duplicate copy replaced by a link · edit-backup: a project
 * copy's local edits, discarded · plugin: a Claude Code plugin skilllib removed
 * (path holds its scope; see plugins.ts)
 */
export type Backup = { name: string; kind: "trash" | "global-backup" | "tidy-backup" | "edit-backup" | "plugin"; path: string; movedAt: string; from: string };

/** Everything skilllib moved out of the way, newest first. */
export function listBackups(): Backup[] {
  return (["trash", "global-backup", "tidy-backup", "edit-backup"] as const)
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
    // By the entry's full timestamp (movedAt shows minutes only): `restore <name>` takes the newest.
    .sort((a, b) => b.path.slice(-24).localeCompare(a.path.slice(-24)));
}

/** Where a backup came from, as lists show it: "library (deleted)", or the folder it was in (e.g. "~/Projects/web/.cursor/skills"). */
export function backupFrom(backup: Backup): string {
  if (backup.kind === "plugin") return "Claude Code plugin";
  return backup.from === librarySkillDir(backup.name) ? "library (deleted)" : tildify(dirname(backup.from));
}

/**
 * Puts a backup back where it came from: trash → library, global-backup →
 * ~/.claude/skills, tidy-backup and edit-backup → the folder it was in. A link
 * tidy left in its place is replaced by the original, and so is the library
 * version that replaced discarded edits (it's still in the library).
 */
export function restoreBackup(backup: Backup): { ok: true; to: string } | { ok: false; reason: string } {
  const to = backup.from;
  if (backup.kind === "tidy-backup" && isLink(to)) unlinkSync(to);
  if (backup.kind === "edit-backup" && !isLink(to) && versionForHash(backup.name, treeHash(to) ?? "") !== null) rmSync(to, { recursive: true, force: true });
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
