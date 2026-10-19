import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { AGENTS_SKILLS_DIR, claudeDir, GROK_SKILLS_DIR, isRepoSkillLocation, libraryDir, PROJECT_SKILLS_DIR, readState, realpathOrNull, skilllibHome, writeState } from "./paths.js";
import { ALL_PROJECT_DIRS, harness, installDirs, type HarnessId } from "./harnesses.js";
import { enabledHarnesses, readConfig, setKeepGlobal } from "./config.js";
import { knownProjects, pinsIn, readManifest, writeManifest, type Dependency } from "./project.js";
import { globalSkillDirs, libraryOrigins, originFor, projectSkillsLock, recordOrigin } from "./sources.js";
import { copySkill, isDir, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";
import { localStamp, tildify } from "./output.js";
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
  /** The copy is another version from your library than the one skilllib.json pins (after a pull, say): sync installs the pinned one. */
  | "out of sync"
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

export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The part of a repo skill folder's path (which may not exist yet) that stops skilllib writing there, or null
 * when it can. Walked from the top, every part that exists must be a folder inside the repo: not a file, a link
 * to nothing, or a link out of the repo (`.claude` -> ~/.claude names `.claude`, the link, not what's under it).
 */
export function notWritable(root: string, dir: string): string | null {
  const top = realpathOrNull(root) ?? root;
  let p = root;
  for (const part of dir.split("/")) {
    p = join(p, part);
    if (!entryExists(p)) return null; // the rest can be made
    const real = realpathOrNull(p);
    if (!isDir(p) || real === null || (real !== top && !real.startsWith(top + sep))) return relative(root, p).split(sep).join("/");
  }
  return null;
}

/** Whether notWritable stopped at a folder that links out of the repo (a setup of yours), not a file or a broken link. */
export const linksOut = (root: string, path: string) => isLink(join(root, path)) && isDir(join(root, path));

/** Why notWritable stopped at `path`, in words a person can act on. */
export function blockerSaid(root: string, path: string): string {
  const full = join(root, path);
  if (!isLink(full)) return `${path} is a file, not a folder`;
  const real = realpathOrNull(full);
  return real === null ? `${path} is a link to nothing` : linksOut(root, path) ? `${path} links out of the repo (to ${tildify(real)})` : `${path} links to a file`;
}

/** Whether `path` (anything in a repo) really is in the repo: a link out of it isn't. */
const inRepo = (root: string, path: string) => {
  const real = realpathOrNull(path);
  const top = realpathOrNull(root) ?? root;
  return real !== null && (real === top || real.startsWith(top + sep));
};

/** What's in the way of links (LinkResult/Change `inTheWay`), as a person reads it. */
export function inTheWaySaid(root: string, paths: string[]): string {
  // A skill's own place (.claude/skills/foo) holds something else; otherwise it's a skills folder notWritable named.
  return paths.map((p) => (ALL_PROJECT_DIRS.includes(posix.dirname(p)) ? `${p} is taken (another copy, or a file)` : blockerSaid(root, p))).join("; ");
}

const writableDir = (root: string, dir: string) => notWritable(root, dir) === null;
/** The first of these repo skill folders skilllib can't write into, named as notWritable names it. */
const firstStuck = (root: string, dirs: string[]) => dirs.map((d) => notWritable(root, d)).find((p) => p !== null) ?? null;
/** A file (not a folder or a link) where a skill's folder goes: never replaced, it may be yours. */
const fileAt = (path: string) => entryExists(path) && !isLink(path) && !isDir(path);

/** Whether a pinned skill is already as skilllib.json records it: its copy as pinned, and each recorded link reaching it. */
function syncDone(root: string, name: string, dep: Dependency): boolean {
  const copy = join(root, dep.dir ?? PROJECT_SKILLS_DIR, name);
  return treeHash(copy) === dep.hash && (dep.links ?? []).every((d) => realpathOrNull(join(root, d, name)) === realpathOrNull(copy));
}

/** A link's place: "ok" (it reaches `to`), "free" (nothing there, or a link to nothing), or "taken" (anything else). */
function slotAt(link: string, to: string): "ok" | "free" | "taken" {
  // A link that doesn't reach a folder (nothing, or a file) is broken for every agent, on every platform.
  if (isLink(link) && !isDir(link)) return "free";
  if (!entryExists(link)) return "free";
  return isLink(link) && realpathOrNull(link) === realpathOrNull(to) ? "ok" : "taken";
}

/**
 * What stops sync putting a pinned skill back as skilllib.json records it, before anything is written (null when
 * nothing does): a skills folder that isn't one in the repo, a file where its folder goes, or something where a
 * recorded link goes. doctor reports these instead of offering a sync that can't succeed.
 */
export function syncBlocker(root: string, name: string, dep: Dependency | undefined = readManifest(root).skills[name]): { said: string; outside: boolean } | null {
  if (!dep) return null;
  const dir = dep.dir ?? PROJECT_SKILLS_DIR;
  // Before "already as pinned": through a folder that links out of the repo, what looks pinned isn't the repo's.
  const stuck = firstStuck(root, [dir, ...(dep.links ?? [])]);
  if (stuck) return { said: blockerSaid(root, stuck), outside: linksOut(root, stuck) };
  if (syncDone(root, name, dep)) return null;
  const copy = join(root, dir, name);
  if (fileAt(copy)) return { said: `${dir}/${name} is a file, not a skill folder`, outside: false };
  // What's at each recorded link's place: a link to nothing (or a file) is put back; a link to a version your
  // library has is pointed back at the pin. A link to other content isn't: repointing it would change what that
  // agent runs, with nothing backed up. Anything that isn't a link is in the way.
  for (const d of dep.links ?? []) {
    const link = join(root, d, name);
    if (!entryExists(link)) continue;
    if (!isLink(link)) return { said: `${d}/${name} is in the way of its link`, outside: false };
    if (!isDir(link) || realpathOrNull(link) === realpathOrNull(copy)) continue;
    const there = treeHash(link);
    if (there !== dep.hash && versionForHash(name, there ?? "") === null) return { said: `${d}/${name} links to a different copy`, outside: false };
  }
  return null;
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
 * Where an agent would lose a skill if its global copy stopped loading: in each of `roots` that holds it, the agents
 * that read the global copy (`readers`) but no copy in the repo (a link git held back, something in the way). Codex
 * never reads ~/.claude/skills, so it loses nothing there. Nested copies load in their package: only the root counts.
 * doctor's "Stop loading it globally" and global move both ask this, of every repo they know.
 */
export function blindWithoutGlobal(name: string, readers: Iterable<HarnessId>, roots: string[]): { root: string; id: HarnessId }[] {
  const read = new Set(readers);
  // A pin (even one whose folder is missing: its agents run the global copy until sync), or anything by that name in a skills folder.
  const holds = (root: string) => {
    try {
      return name in pinsIn(root) || ALL_PROJECT_DIRS.some((d) => entryExists(join(root, d, name)));
    } catch {
      return false; // a skilllib.json that can't be read: its own issue
    }
  };
  // A copy really in the repo: not through a folder or a link that leads out of it (to the global copy itself, say).
  const seesHere = (root: string, id: HarnessId) => harness(id).projectDirs.some((d) => existsSync(join(root, d, name, "SKILL.md")) && inRepo(root, join(root, d, name)));
  // Who runs it now from outside the repo: an agent reading the global copy, or one reaching it through such a link.
  const runsIt = (root: string, id: HarnessId) => read.has(id) || harness(id).projectDirs.some((d) => existsSync(join(root, d, name, "SKILL.md")));
  // One per real folder: a repo named two ways (a link, ~) is still one repo.
  const unique = [...new Map(roots.map((r) => [realpathOrNull(r) ?? r, r])).values()];
  return unique.filter(holds).flatMap((root) => enabledHarnesses().flatMap((id) => (runsIt(root, id) && !seesHere(root, id) ? [{ root, id }] : [])));
}

/**
 * [real-copy folder, ...link folders] for a skill. An existing install keeps
 * its folder (switching harnesses never moves it), and so does an untracked
 * real copy being adopted, so tracking never leaves two copies. Links are
 * recorded ones plus any your current harnesses need; adding one moves nothing.
 */
function dependencyDirs(root: string, name: string, dep: Dependency | undefined): string[] {
  // .grok/skills is the team's folder. Adopting it would make add overwrite it and remove delete it.
  const untracked = ALL_PROJECT_DIRS.find((d) => d !== GROK_SKILLS_DIR && existsSync(join(root, d, name, "SKILL.md")) && !isLink(join(root, d, name)));
  const primary = dep ? (dep.dir ?? PROJECT_SKILLS_DIR) : (untracked ?? installDirs(enabledHarnesses())[0]!);
  // The fewest folders, counted from where the real copy is: no link an agent doesn't need.
  const wanted = installDirs(enabledHarnesses(), primary);
  return [primary, ...new Set([...(dep?.links ?? []), ...wanted.filter((d) => d !== primary)])];
}

/** True when git tracks files under `dir` in `root` (so writing there shows up in git status). */
function isGitTracked(root: string, dir: string): boolean {
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
    // A pinned folder outside the repo (.claude -> ~/.claude) holds someone else's copy (your global one, say), not the
    // repo's: the repo's is missing, and sync can't put it there (syncBlocker says why).
    const local = notWritable(root, location) ? null : treeHash(path);
    const latest = latestVersion(name);
    // Edits are content your library has no version of; another known version is just out of sync.
    const known = local !== null && local !== dep.hash && versionForHash(name, local) !== null;
    const edited = local !== dep.hash && !known;
    // The pin's version in your library, found by its hash: the number in skilllib.json may be another library's.
    const pinned = versionForHash(name, dep.hash)?.version ?? dep.version;
    const behind = latest !== null && latest.hash !== dep.hash && latest.version > pinned;
    const state: SkillState =
      local === null
        ? "folder missing"
        : latest === null
          ? "not in library"
          : local === latest.hash && !known
            ? "ok"
            : known
              ? "out of sync"
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
      version: pinned || null,
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
  // A skills folder that links out of the repo (.claude/skills -> ~/.claude/skills) isn't the repo's: what's in it
  // is someone else's (your global skills, say), so it's never listed, tracked, linked or removed as the repo's.
  for (const dir of ALL_PROJECT_DIRS.filter((d) => writableDir(root, d))) {
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
      for (const [skillsDir] of NESTED_READERS) {
        const location = relative(root, join(sub, skillsDir)).split(sep).join("/");
        // A package's skills folder that links out of the repo (to ~/.claude, say) isn't the repo's, as at the top.
        if (!writableDir(root, location)) continue;
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
            // Its own folder's readers, plus any that reach it through a link in another of the package's folders.
            visibility: ((all) => enabled.map((id) => ({ id, paths: all.includes(id) ? 1 : 0 })))(
              NESTED_READERS.filter(([dir]) => realpathOrNull(join(sub, dir, name)) === realpathOrNull(path)).flatMap(([, r]) => r),
            ),
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
function sharedByGit(root: string, location: string, name: string): boolean {
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
 * the real copy (a committed link to it would be broken for teammates) · inTheWay:
 * what stops a link (a file or other copy where it goes, or a skills folder that isn't one in the repo).
 */
export type LinkResult = { created: string[]; blocked: string[]; uncommitted: string[]; inTheWay: string[] };

/**
 * Adds relative symlinks so every enabled harness loads a skill whose real
 * copy lives at `location`. Folders git tracks are skipped unless `allowTracked`,
 * and always when git doesn't share the real copy. `dryRun`: what it would do, changing nothing.
 */
export function linkEverywhere(root: string, name: string, location: string, { allowTracked = false, dryRun = false } = {}): LinkResult {
  const enabled = enabledHarnesses();
  const result: LinkResult = { created: [], blocked: [], uncommitted: [], inTheWay: [] };
  let shared: boolean | undefined;
  const stuck = (path: string) => void (result.inTheWay.includes(path) || result.inTheWay.push(path));
  for (const id of enabled) {
    if (visibilityOf(root, name, [id])[0]!.paths > 0) continue;
    const dir = harness(id).projectDirs[0]!;
    const link = join(root, dir, name);
    // Agents can share a folder (Codex and Zed both read .agents/skills): one entry each.
    if (Object.values(result).some((dirs) => dirs.includes(dir))) continue;
    const blocker = notWritable(root, dir);
    if (blocker) {
      stuck(blocker);
      continue;
    }
    // This agent can't see the skill, so whatever is there isn't it: a link to nothing is replaced, anything else stays.
    const broken = isLink(link) && !isDir(link);
    if (entryExists(link) && !broken) {
      stuck(`${dir}/${name}`);
      continue;
    }
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
      if (broken) unlinkSync(link);
      mkdirSync(join(root, dir), { recursive: true });
      linkDir(join(root, location, name), link);
    }
    result.created.push(dir);
  }
  return result;
}

/**
 * Removes the links to a skill that point at nothing, in every repo skill folder: run after its copy was
 * moved away (removeUntracked backs it up first). A link to another copy (the team's, say) stays.
 */
export function unlinkEverywhere(root: string, name: string): string[] {
  return ALL_PROJECT_DIRS.filter((dir) => writableDir(root, dir)).filter((dir) => {
    const link = join(root, dir, name);
    if (!isLink(link) || realpathOrNull(link) !== null) return false;
    unlinkSync(link);
    return true;
  });
}

/** Adds links so every enabled harness loads a managed skill, and records them in skilllib.json. */
export function relinkDependency(root: string, name: string, { allowTracked = false } = {}): LinkResult {
  const manifest = readManifest(root);
  const dep = manifest.skills[name];
  if (!dep) return { created: [], blocked: [], uncommitted: [], inTheWay: [] };
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
  { allowTracked = false, names }: { allowTracked?: boolean; names?: string[] } = {},
): { linked: { name: string; into: string[] }[]; blocked: string[]; uncommitted: string[]; inTheWay: string[] } {
  const linked: { name: string; into: string[] }[] = [];
  const blocked = new Set<string>();
  const uncommitted: string[] = [];
  const inTheWay = new Set<string>();
  for (const skill of projectStatus(root)) {
    if ((names && !names.includes(skill.name)) || !skill.visibility.some((v) => v.paths === 0) || skill.state === "folder missing") continue;
    const res = skill.managed ? relinkDependency(root, skill.name, { allowTracked }) : linkEverywhere(root, skill.name, skill.location, { allowTracked });
    if (res.created.length) linked.push({ name: skill.name, into: res.created });
    for (const dir of res.blocked) blocked.add(dir);
    if (res.uncommitted.length) uncommitted.push(skill.name);
    for (const path of res.inTheWay) inTheWay.add(path);
  }
  return { linked, blocked: [...blocked], uncommitted, inTheWay: [...inTheWay] };
}

export type Change = {
  name: string;
  /**
   * reset: back to the version it had; its local edits were overwritten (and backed up, see `backedUp`).
   * relinked: the copy was as pinned; only the links skilllib.json records were put back.
   * unchanged: it was already as asked (same version, same links): nothing was written.
   */
  action: "installed" | "updated" | "reset" | "relinked" | "unchanged" | "removed" | "skipped";
  reason?: string;
  from?: number;
  to?: number;
  /** Harness folders a link couldn't be written to because git tracks them. */
  blocked?: string[];
  /** Harness folders git tracks, left without a link because git doesn't share the real copy (teammates would get a broken link). */
  uncommitted?: string[];
  /** What kept a link out (a file or another copy where it goes): an agent can't use the skill there. */
  inTheWay?: string[];
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
  // A skill's name is one folder name: never ".", "..", empty, or a path.
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) return { name, action: "skipped", reason: "not a skill name" };
  const target = version === undefined ? latestVersion(name) : getVersion(name, version);
  if (!target) return { name, action: "skipped", reason: version === undefined ? "not in the library" : `version ${version} doesn't exist` };

  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  const [primary = PROJECT_SKILLS_DIR, ...wantedLinks] = dependencyDirs(root, name, recorded);
  // A skills folder that's a link out of the repo (to ~/.claude/skills, say) isn't the repo's, and a file there isn't a folder:
  // never write there, and never install for only some of your agents (global move would then unload a skill one still needs).
  const stuck = firstStuck(root, [primary, ...wantedLinks]);
  if (stuck) return { name, action: "skipped", reason: `${blockerSaid(root, stuck)}, so skilllib doesn't install there` };
  const to = join(root, primary, name);
  if (fileAt(to)) return { name, action: "skipped", reason: `${primary}/${name} is a file, not a skill folder: move it first` };
  const local = isLink(to) && !recorded ? null : treeHash(to);
  const knownContent = local !== null && (local === recorded?.hash || versionForHash(name, local) !== null);

  // A copy (or a link) git tracks that skilllib.json doesn't pin is the team's: never replaced or taken over,
  // even when identical (managed, remove could then delete it), even with --force.
  if (!recorded && entryExists(to) && isGitTracked(root, `${primary}/${name}`))
    return { name, action: "skipped", reason: `${primary}/${name} is the repo's own (committed): skilllib doesn't replace it; remove it in the repo first if the library's should win` };
  // An untracked link here to a different copy (a dev folder) is replaced only with --force, like a real copy.
  const linked = local === null && !recorded && isLink(to) ? treeHash(to) : null;
  if (linked !== null && linked !== target.hash && versionForHash(name, linked) === null && !force)
    return { name, action: "skipped", reason: `${primary}/${name} links to a different copy (use --force to replace the link)` };
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
  const copied = local !== target.hash || isLink(to);
  if (copied) {
    mkdirSync(join(root, primary), { recursive: true });
    if (isLink(to)) unlinkSync(to);
    // Content your library has no version of (edits, or a pin from another library) goes to a backup first.
    else if (local !== null && versionForHash(name, local) === null) backedUp = stash(to, "edit-backup");
    copySkill(versionDir(name, target.version), to);
  }

  const links: string[] = [];
  const blocked: string[] = [];
  const uncommitted: string[] = [];
  const inTheWay: string[] = [];
  let shared: boolean | undefined;
  let relinked = false;
  for (const dir of wantedLinks) {
    const link = join(root, dir, name);
    const slot = slotAt(link, to);
    if (slot === "ok") {
      links.push(dir);
      continue;
    }
    // A link to nothing is replaced; anything else there (a file, another copy) is left, and said. A link
    // skilllib.json records stays recorded (the pin is the team's): sync puts it back once the way is clear.
    if (slot === "taken") {
      inTheWay.push(`${dir}/${name}`);
      if (recorded?.links?.includes(dir)) links.push(dir);
      continue;
    }
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
    if (isLink(link)) unlinkSync(link);
    mkdirSync(join(root, dir), { recursive: true });
    linkDir(to, link);
    links.push(dir);
    relinked = true;
  }

  manifest.skills[name] = {
    version: target.version,
    hash: target.hash,
    ...(primary !== PROJECT_SKILLS_DIR ? { dir: primary } : {}),
    ...(links.length ? { links } : {}),
  };
  writeManifest(root, manifest);
  // The version the pin's hash names, as everywhere else: never skilllib.json's raw number.
  const from = recorded ? (versionForHash(name, recorded.hash)?.version ?? recorded.version) : undefined;
  return {
    name,
    action:
      // Nothing of it was there (or only an identical untracked copy, now tracked): installed, not updated.
      !recorded || local === null
        ? "installed"
        : backedUp && from === target.version
          ? "reset"
          : recorded && !copied && from === target.version
            ? // The same version, already there: only links (if any) were written.
              relinked ? "relinked" : "unchanged"
            : "updated",
    ...(from !== undefined ? { from } : {}),
    to: target.version,
    ...(blocked.length ? { blocked } : {}),
    ...(uncommitted.length ? { uncommitted } : {}),
    ...(inTheWay.length ? { inTheWay } : {}),
    ...(backedUp ? { backedUp } : {}),
  };
}

export function removeSkill(root: string, name: string, { force = false } = {}): Change {
  const manifest = readManifest(root);
  const recorded = manifest.skills[name];
  if (!recorded) return { name, action: "skipped", reason: "not managed by skilllib in this project" };

  const stuck = firstStuck(root, [recorded.dir ?? PROJECT_SKILLS_DIR, ...(recorded.links ?? [])]);
  const dir = join(root, recorded.dir ?? PROJECT_SKILLS_DIR, name);
  if (stuck || fileAt(dir)) {
    // Nothing there is skilllib's to touch (a folder outside the repo, a file of yours): only the pin goes, so
    // skilllib.json stops asking for it. Every file stays as it is.
    delete manifest.skills[name];
    writeManifest(root, manifest);
    const why = stuck ? blockerSaid(root, stuck) : `${recorded.dir ?? PROJECT_SKILLS_DIR}/${name} is a file, not a skill folder`;
    return { name, action: "removed", reason: `${why}: only its pin was removed, nothing there was touched` };
  }
  const local = treeHash(dir);
  // Content your library has a version of can be deleted; anything else is kept in a backup.
  const inLibrary = local !== null && versionForHash(name, local) !== null;
  const edited = local !== null && local !== recorded.hash && !inLibrary;
  if (edited && !force)
    return {
      name,
      action: "skipped",
      // A pin from another library isn't an edit of yours: say what it is. Either way --force backs the copy up first.
      reason:
        versionForHash(name, recorded.hash) === null
          ? "doesn't match what skilllib.json pins, and your library has neither (use --force to remove it; it's backed up first)"
          : "has local edits (use --force to delete anyway; they're backed up first)",
    };
  // Only its own links (or ones to nothing): a link there now to another copy (the team's) isn't this skill's.
  for (const linkDir of recorded.links ?? []) {
    const link = join(root, linkDir, name);
    if (isLink(link) && slotAt(link, dir) !== "taken") unlinkSync(link);
  }
  // Forced over local edits, or pinned from another library: the copy goes to ~/.skilllib/edit-backup, as update and sync do.
  const backedUp = local !== null && !inLibrary ? stash(dir, "edit-backup") : undefined;
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
export function syncProject(root: string, { force = false, names }: { force?: boolean; names?: string[] } = {}): Change[] {
  return Object.keys(readManifest(root).skills)
    .filter((name) => !names || names.includes(name))
    .flatMap((name) => syncSkill(root, name, { force }));
}

/** `syncProject` for one skill: nothing when it's already as pinned. */
function syncSkill(root: string, name: string, { force = false } = {}): Change[] {
  const dep = readManifest(root).skills[name];
  if (!dep) return [];
  const copy = join(root, dep.dir ?? PROJECT_SKILLS_DIR, name);
  const local = treeHash(copy);
  // Blocked first (a pin under a folder that links out of the repo can look done through the link), never half done.
  const blocker = syncBlocker(root, name, dep);
  if (blocker) return [{ name, action: "skipped", reason: `${blocker.said}: ${blocker.outside ? "skilllib only installs inside the repo" : "move it, then sync"}` }];
  if (syncDone(root, name, dep)) return [];
  // The real copy is as pinned and only links are gone: put those back, never reinstall content.
  if (local === dep.hash) return [relinkPinned(root, name, dep)];
  // What it would put back first: with no version to install, --force can't help, so it isn't suggested.
  const version = pinnedVersion(name, dep);
  if (typeof version === "string") return [{ name, action: "skipped", reason: version }];
  // Another version your library has isn't an edit: sync puts the pinned one back without --force.
  if (local !== null && local !== dep.hash && versionForHash(name, local) === null && !force) return [{ name, action: "skipped", reason: "has local edits (use --force to reset them)" }];
  // Like `npm ci`: put the pinned content back where skilllib.json says, with its recorded links, and never
  // rewrite skilllib.json (it's shared, often committed). Forced edits go to a backup first.
  const backedUp = local !== null && versionForHash(name, local) === null ? stash(copy, "edit-backup") : undefined;
  mkdirSync(dirname(copy), { recursive: true });
  copySkill(versionDir(name, version), copy);
  const links = relinkPinned(root, name, dep);
  // From the version the copy was (an out-of-sync one), else the pin's own: never skilllib.json's raw number.
  const from = (local !== null ? versionForHash(name, local)?.version : undefined) ?? version;
  return [
    {
      name,
      action: local === null ? "installed" : backedUp ? "reset" : "updated",
      from,
      to: version,
      ...(backedUp ? { backedUp } : {}),
      ...(links.action === "skipped" ? { reason: links.reason } : {}),
    },
  ];
}

/** Puts back the links skilllib.json records for a skill whose real copy is as pinned. */
function relinkPinned(root: string, name: string, dep: Dependency): Change {
  const to = join(root, dep.dir ?? PROJECT_SKILLS_DIR, name);
  for (const dir of dep.links ?? []) {
    const link = join(root, dir, name);
    if (realpathOrNull(link) === realpathOrNull(to)) continue;
    if (isLink(link)) unlinkSync(link); // a link to nothing, a file, or another version (syncBlocker checked)
    else if (entryExists(link)) return { name, action: "skipped", reason: `${dir}/${name} is in the way of its link: move it, then sync` };
    mkdirSync(join(root, dir), { recursive: true });
    linkDir(to, link);
  }
  return { name, action: "relinked", to: versionForHash(name, dep.hash)?.version ?? dep.version };
}

/**
 * The library version a pin means, found by its hash: version numbers are each library's own, so on
 * a teammate's machine the same number can be other content. A string says why there's none here.
 */
function pinnedVersion(name: string, dep: Dependency): number | string {
  if (!latestVersion(name)) return `not in your library (${tildify(libraryDir())}); import it, or set SKILLLIB_HOME to the library that has it`;
  return versionForHash(name, dep.hash)?.version ?? `your library has no copy of the version skilllib.json pins (pinned from another library?); skilllib update ${name} installs your newest`;
}

/**
 * Puts a managed skill back to the version skilllib.json pins. The edited copy goes to
 * ~/.skilllib/edit-backup first, restorable with skilllib restore; nothing moves when the pin can't be met.
 */
export function discardEdits(root: string, name: string): Change {
  const dep = readManifest(root).skills[name];
  if (!dep) return { name, action: "skipped", reason: "not managed by skilllib in this project" };
  const version = pinnedVersion(name, dep);
  if (typeof version === "string") return { name, action: "skipped", reason: version };
  // addSkill backs the edited copy up as it replaces it, and says so (backedUp).
  return addSkill(root, name, { force: true, version });
}

/** Moves skills (default: all) to the newest library version, keeping local edits unless forced. */
export function updateProject(root: string, names?: string[], { force = false, allowTracked = false } = {}): Change[] {
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
      const change = addSkill(root, name, { force, allowTracked });
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
  return readState<Record<string, string>>(backupIndexFile(bucket)) ?? {};
}

/** rename, or copy then delete when `from` and `to` are on different disks (EXDEV). Links stay links. */
function move(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
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
  // The index first: if it can't be read, nothing has moved yet.
  const index = readBackupIndex(bucket);
  mkdirSync(join(skilllibHome(), bucket), { recursive: true });
  move(dir, target);
  writeState(backupIndexFile(bucket), { ...index, [entry]: dir });
  return target;
}

/**
 * Removes a skill folder skilllib doesn't track (an untracked copy) and its links.
 * The folder goes to the trash, restorable from Settings like everything skilllib removes.
 */
export function removeUntracked(root: string, name: string, path: string): string {
  // A copy reached through a skills folder that links out of the repo is someone else's (your global skills, say).
  const stuck = notWritable(root, relative(root, dirname(path)));
  if (stuck) throw new Error(`${stuck} isn't a folder in the repo: skilllib leaves what's in it alone`);
  // The backup first: when the copy is itself a link, removing links first would take it away.
  const to = stash(path, "trash");
  unlinkEverywhere(root, name);
  return to;
}

export function projectsUsing(name: string): string[] {
  return knownProjects().filter((p) => name in pinsIn(p));
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
 * can be restored with skilllib restore.
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
    // JSON strings are valid YAML: a description with ": " or "#" stays one value.
    `---\nname: ${name}\ndescription: ${JSON.stringify(description || "Describe when an agent should use this skill.")}\n---\n\n# ${name}\n\nInstructions for the agent go here.\n`,
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
        // No index entry (an older skilllib, or a lost index): the library (where a trashed repo copy also lands
        // harmlessly: it loads nowhere) and the global folder are safe guesses; other backups aren't restored by guessing.
        const from = index[entry] ?? (kind === "trash" ? librarySkillDir(name) : kind === "global-backup" ? join(claudeDir(), "skills", name) : "");
        return [{ name, kind, path: join(dir, entry), movedAt: localStamp(Date.parse(`${match[2]}T${match[3]}:${match[4]}:${match[5]}Z`)), from }];
      });
    })
    // By the entry's full timestamp (movedAt shows minutes only): `restore <name>` takes the newest.
    .sort((a, b) => b.path.slice(-24).localeCompare(a.path.slice(-24)));
}

/**
 * The backups moved out in one go with `backup` (a global skill and its copy in another agent's folder): the
 * same name and kind, moved within two seconds of each other (entries end in their ISO time). Restored together.
 */
export function movedTogether(backups: Backup[], backup: Backup): Backup[] {
  if (backup.kind === "plugin") return [backup];
  const at = (b: Backup) => Date.parse(b.path.slice(-24).replace(/^(.{13})-(\d\d)-(\d\d)-(\d{3})Z$/, "$1:$2:$3.$4Z"));
  return backups.filter((b) => b.name === backup.name && b.kind === backup.kind && Math.abs(at(b) - at(backup)) <= 2000);
}

/** Where a backup came from, as lists show it: "library (deleted)", or the folder it was in (e.g. "~/Projects/web/.cursor/skills"). */
export function backupFrom(backup: Backup): string {
  if (backup.kind === "plugin") return "Claude Code plugin";
  if (!backup.from) return "unknown";
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
  if (!to) return { ok: false, reason: `skilllib doesn't know where it came from; its files are in ${tildify(backup.path)}` };
  if (backup.kind === "tidy-backup" && isLink(to)) unlinkSync(to);
  if (backup.kind === "edit-backup" && !isLink(to) && versionForHash(backup.name, treeHash(to) ?? "") !== null) rmSync(to, { recursive: true, force: true });
  if (entryExists(to)) return { ok: false, reason: `${backup.name} already exists there` };
  mkdirSync(join(to, ".."), { recursive: true });
  move(backup.path, to);
  forgetLatest(backup.name);
  return { ok: true, to };
}
