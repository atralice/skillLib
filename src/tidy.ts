import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { enabledHarnesses } from "./config.js";
import { gitInfo, isShared, relativeTo, type GitInfo } from "./git.js";
import { ALL_PROJECT_DIRS, CURSOR_PICKS, harness, installDirs, type HarnessId } from "./harnesses.js";
import { entryExists, isLink, linkDir, notWritable, stash } from "./library.js";
import { AGENTS_SKILLS_DIR, GROK_SKILLS_DIR, grokDir, MANIFEST_FILE, PROJECT_SKILLS_DIR, realPath, realpathOrNull, userHome } from "./paths.js";
import { tildify } from "./output.js";
import { readManifest, writeManifest } from "./project.js";
import { globalDirAs, globalSkillDirs, projectSkillsLock } from "./sources.js";
import { treeHash, isDir } from "./skills.js";

/**
 * One change tidy makes, always to a single path:
 * - link:    point a wrong or broken link at the real copy
 * - unlink:  remove a link no agent you use needs
 * - replace: swap an identical (or, if you chose, a differing) real copy for a link
 * - remove:  drop an identical (or, if you chose, a differing) real copy no agent you use needs
 * `differs`: the copy's content isn't the kept one's (a `keep` choice), so the step says so.
 * Real copies that go away are stashed in ~/.skilllib/tidy-backup, restorable with skilllib restore.
 */
export type TidyStep =
  | { kind: "link"; path: string; target: string }
  | { kind: "unlink"; path: string }
  | { kind: "replace"; path: string; target: string; differs?: true }
  | { kind: "remove"; path: string; differs?: true };

/** What tidy would do for one skill. `root` is null for the global folders. */
export type TidyPlan = { name: string; root: string | null; primary: string; steps: TidyStep[] };

/**
 * Same-name real copies whose content differs: tidy can't pick one for you.
 * `managed` is the folder skilllib.json pins; only that copy can win.
 */
export type Conflict = {
  name: string;
  root: string | null;
  copies: { dir: string; path: string; runs: HarnessId[] }[];
  managed?: string;
};

/** skipped: skills tidy leaves alone; `differs` when that leaves your agents running different content (doctor reports it). */
export type TidyReport = { plans: TidyPlan[]; conflicts: Conflict[]; skipped: { name: string; reason: string; differs?: boolean }[] };

type Entry = { dir: string; path: string; link: boolean; real: string | null; hash: string | null };

function entriesOf(dirs: string[], name: string): Entry[] {
  return dirs.flatMap((dir): Entry[] => {
    const path = join(dir, name);
    if (!entryExists(path)) return [];
    const link = isLink(path);
    const real = realpathOrNull(path);
    const skill = existsSync(join(path, "SKILL.md"));
    if (!link && !skill) return []; // some other folder; never touched
    return [{ dir, path, link, real, hash: null }];
  });
}

/** The real copies, each real folder once: one reached two ways (a skills folder that's a link to another) is one copy (#54). */
function uniqueReals(entries: Entry[]): Entry[] {
  return entries.filter((e, i, all) => !e.link && all.findIndex((o) => !o.link && o.real === e.real) === i);
}

/** Hashes real copies only when there's more than one to compare: hashing reads every file. */
function hashReals(reals: Entry[]) {
  if (reals.length > 1) for (const r of reals) r.hash = treeHash(r.path);
}

function namesIn(dirs: string[]): string[] {
  const names = new Set<string>();
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir)) if (!name.startsWith(".") && name !== "synced") names.add(name);
  }
  return [...names].sort();
}

/** Project folders tidy may rewrite. `.grok/skills` is discovered for status, and never changed. */
const PROJECT_TIDY_DIRS = ALL_PROJECT_DIRS.filter((d) => d !== GROK_SKILLS_DIR);
/** The repo's own skill folders tidy works in: not one that links out of the repo (.agents/skills -> ~/.agents/skills holds your global skills). */
export const repoTidyDirs = (root: string) => PROJECT_TIDY_DIRS.filter((d) => notWritable(root, d) === null);

/** Global folders tidy may rewrite. `~/.grok/skills` is Grok's own folder. */
function globalTidyDirs(): string[] {
  const own = realPath(join(grokDir(), "skills"));
  return globalSkillDirs().filter((d) => realPath(d) !== own);
}

/**
 * Which copies each agent runs when several folders hold one. Codex doesn't merge
 * same-name skills, so it runs every copy it reads; Cursor runs one, in its own
 * order (CURSOR_PICKS); the others read a single folder.
 */
function runsFrom(id: HarnessId, dirsWithCopy: string[], readsOf: (id: HarnessId) => string[]): string[] {
  const reads = readsOf(id).filter((d) => dirsWithCopy.includes(d));
  if (id === "codex") return reads;
  const pick = (d: string) => CURSOR_PICKS.indexOf(basename(dirname(d)));
  return id === "cursor" ? [...reads].sort((a, b) => pick(a) - pick(b)).slice(0, 1) : reads.slice(0, 1);
}

function conflictOf(name: string, root: string | null, reals: Entry[], enabled: HarnessId[], readsOf: (id: HarnessId) => string[]): Conflict {
  const dirs = reals.map((r) => r.dir);
  return {
    name,
    root,
    copies: reals.map((r) => ({ dir: r.dir, path: r.path, runs: enabled.filter((id) => runsFrom(id, dirs, readsOf).includes(r.dir)) })),
  };
}

/**
 * Tidies one project's skill folders: one real copy per skill, plus only the
 * links your agents need. It removes and repoints, never adds: making a skill
 * reach more agents is linkAll's job. A real copy never moves (skilllib.json is shared,
 * and teammates may use other agents), and links skilllib.json records are
 * kept for the same reason. `keep` resolves a conflict: name → the folder
 * (absolute, as in Conflict.copies) whose copy wins.
 */
export function planProjectTidy(root: string, { keep = {}, enabled = enabledHarnesses() }: { keep?: Record<string, string>; enabled?: HarnessId[] } = {}): TidyReport {
  const report: TidyReport = { plans: [], conflicts: [], skipped: [] };
  const { skills } = readManifest(root);
  const abs = (dir: string) => join(root, dir);
  const rel = (dir: string) => relativeTo(root, dir);
  const readsOf = (id: HarnessId) => harness(id).projectDirs.map(abs);
  let git: GitInfo | null | undefined; // looked up once, only if needed
  const skillsLock = projectSkillsLock(root);

  const dirs = repoTidyDirs(root).map(abs);
  const realRoot = realpathOrNull(root) ?? root;
  for (const name of namesIn(dirs)) {
    const entries = entriesOf(dirs, name);
    const external = entries.find((e) => e.link && e.real && !(e.real + sep).startsWith(realRoot + sep));
    if (external) {
      const differs = entries.some((e) => e !== external && e.real && existsSync(join(e.real, "SKILL.md")) && treeHash(e.real) !== treeHash(external.real!));
      report.skipped.push({ name, reason: `${rel(external.path)} links outside the repo`, ...(differs ? { differs } : {}) });
      continue;
    }
    // One real folder reached two ways (a skills folder that's a link to another) is one copy, as in planGlobalTidy (#54).
    const reals = uniqueReals(entries);
    if (reals.length === 0) continue;
    hashReals(reals);

    const dep = skills[name];
    const chosen = keep[name];
    let primary: Entry | undefined;
    if (dep) {
      primary = reals.find((r) => rel(r.dir) === (dep.dir ?? PROJECT_SKILLS_DIR));
      if (!primary) continue; // folder missing: sync's job
    } else if (chosen && reals.some((r) => r.dir === chosen)) {
      primary = reals.find((r) => r.dir === chosen);
    } else {
      // The copy teammates get (committed); then, for a skill `npx skills` installed, its own
      // real copy in .agents/skills (its symlink layout); else the folder your agents need most.
      if (git === undefined) git = gitInfo(root);
      const planned = installDirs(enabled).map(abs);
      const fromSkillsSh = name in skillsLock;
      const rank = (e: Entry) =>
        (isShared(git?.of(rel(e.path))) ? 0 : 1000) +
        (fromSkillsSh && e.dir === abs(AGENTS_SKILLS_DIR) ? 0 : 100) +
        (planned.includes(e.dir) ? planned.indexOf(e.dir) : 50);
      primary = [...reals].sort((a, b) => rank(a) - rank(b))[0];
    }
    if (!primary) continue;
    if (chosen !== primary.dir && reals.some((r) => r.hash !== primary!.hash)) {
      report.conflicts.push({ ...conflictOf(name, root, reals, enabled, readsOf), ...(dep ? { managed: primary.dir } : {}) });
      continue;
    }

    // A link to other content (another copy, another skill) isn't an extra link: repointing it would change
    // what that agent runs, with nothing backed up. That's a decision, so tidy leaves this skill alone.
    const elsewhere = entries.find((e) => e.link && e.real && e.real !== primary.real && existsSync(join(e.real, "SKILL.md")) && treeHash(e.real) !== treeHash(primary.path));
    if (elsewhere) {
      report.skipped.push({ name, reason: `${rel(elsewhere.path)} links to a different copy`, differs: true });
      continue;
    }
    const wanted = new Set([...installDirs(enabled, rel(primary.dir)), ...(dep?.links ?? [])].map(abs));
    const steps: TidyStep[] = [];
    for (const e of entries) {
      // The primary itself, or the same real folder reached through a linked skills folder.
      if (e === primary || (!e.link && e.real === primary.real)) continue;
      const needed = wanted.has(e.dir);
      if (e.link) {
        if (e.real === primary.real) {
          // A link the repo commits for its own skill is the team's: a teammate's agent may need it.
          if (!needed && !dep && isShared((git ??= gitInfo(root))?.of(rel(e.path)))) continue;
          if (!needed) steps.push({ kind: "unlink", path: e.path });
        } else steps.push(needed ? { kind: "link", path: e.path, target: primary.path } : { kind: "unlink", path: e.path });
      } else {
        const differs = e.hash !== primary.hash ? { differs: true as const } : {};
        // A real copy the repo commits is the team's: never removed (a teammate's agent may read that folder), unless
        // you chose which copy to keep (doctor's "Keep the … copy, and change what git tracks", tidy --keep).
        if (!needed && !chosen && isShared((git ??= gitInfo(root))?.of(rel(e.path)))) continue;
        steps.push(needed ? { kind: "replace", path: e.path, target: primary.path, ...differs } : { kind: "remove", path: e.path, ...differs });
      }
    }
    if (steps.length) report.plans.push({ name, root, primary: primary.path, steps });
  }
  return report;
}

/** The global folders an agent reads. */
function globalReadsOf(id: HarnessId): string[] {
  return harness(id).globalDirs().map(globalDirAs);
}

/** A "skills-directory plugin": a folder in a skills dir that is really a Claude Code plugin. Never touched. */
function isSkillsDirPlugin(path: string): boolean {
  return existsSync(join(path, ".claude-plugin", "plugin.json"));
}

/**
 * Dedups the global skill folders (~/.claude/skills, ~/.agents/skills, …):
 * identical real copies of one skill become one real copy plus links. The real
 * copy kept is the one in ~/.agents/skills (where `npx skills` installs), so
 * its lock file stays right. Links are never added or removed here: which
 * agents load a global skill is a choice, not a layout problem.
 */
export function planGlobalTidy({ keep = {}, enabled = enabledHarnesses() }: { keep?: Record<string, string>; enabled?: HarnessId[] } = {}): TidyReport {
  const report: TidyReport = { plans: [], conflicts: [], skipped: [] };
  const dirs = globalTidyDirs();
  const agents = join(userHome(), ".agents", "skills");
  for (const name of namesIn(dirs)) {
    const entries = entriesOf(dirs, name);
    if (entries.some((e) => isSkillsDirPlugin(e.path))) {
      report.skipped.push({ name, reason: "a Claude Code plugin kept in a skills folder" });
      continue;
    }
    // Never two "copies" of one real folder: tidying those would replace a skill with a link to itself (#54).
    const reals = uniqueReals(entries);
    if (reals.length < 2) continue;
    hashReals(reals);
    // A `keep` folder with no copy picks nothing: differing copies stay a conflict.
    const kept = reals.find((r) => r.dir === keep[name]);
    const primary = kept ?? reals.find((r) => r.dir === agents) ?? reals[0]!;
    if (!kept && reals.some((r) => r.hash !== primary.hash)) {
      report.conflicts.push(conflictOf(name, null, reals, enabled, globalReadsOf));
      continue;
    }
    const steps = reals
      .filter((r) => r !== primary)
      .map((r): TidyStep => ({ kind: "replace", path: r.path, target: primary.path, ...(r.hash !== primary.hash ? { differs: true as const } : {}) }));
    report.plans.push({ name, root: null, primary: primary.path, steps });
  }
  return report;
}

/**
 * Steps that change what git shows: anything touching a committed path.
 * Changing or removing an uncommitted file is fine.
 */
export function gitVisibleSteps(plan: TidyPlan, git: GitInfo | null = plan.root ? gitInfo(plan.root) : null): TidyStep[] {
  if (!plan.root || !git) return [];
  const shared = (rel: string) => isShared(git.of(rel));
  // A managed skill's new link is also written into skilllib.json: when that's committed, git sees it too.
  const dep = readManifest(plan.root).skills[plan.name];
  const recordsLink = (s: TidyStep) => !!dep && (s.kind === "link" || s.kind === "replace") && !dep.links?.includes(relativeTo(plan.root!, dirname(s.path)));
  return plan.steps.filter((s) => shared(relativeTo(plan.root!, s.path)) || (recordsLink(s) && shared(MANIFEST_FILE)));
}

export type TidyResult = { name: string; root: string | null; applied: TidyStep[]; held: TidyStep[] };

/**
 * Applies a plan. With `git: "keep"`, steps git would notice are held back
 * (see gitVisibleSteps) and reported instead. Links skilllib.json should know
 * about are recorded there.
 */
export function applyTidy(plan: TidyPlan, { git = "keep" }: { git?: "keep" | "go" } = {}): TidyResult {
  const held = git === "keep" ? gitVisibleSteps(plan) : [];
  const applied: TidyStep[] = [];
  for (const step of plan.steps) {
    // Planned earlier (Health builds plans on load); skip what changed since.
    if (held.includes(step) || !entryExists(step.path) || ("target" in step && !entryExists(step.target))) continue;
    // Never replace a folder with a link to itself: it would loop, and the skill would be gone.
    if ("target" in step && realpathOrNull(step.path) === realpathOrNull(step.target)) continue;
    if (step.kind === "link" || step.kind === "unlink") {
      if (isLink(step.path)) unlinkSync(step.path);
    } else stash(step.path, "tidy-backup");
    if (step.kind === "link" || step.kind === "replace") {
      mkdirSync(dirname(step.path), { recursive: true });
      linkDir(step.target, step.path);
    }
    applied.push(step);
  }

  // A managed skill's new links go in skilllib.json, so sync keeps them.
  if (plan.root) {
    const manifest = readManifest(plan.root);
    const dep = manifest.skills[plan.name];
    const added = applied
      .filter((s) => s.kind === "link" || s.kind === "replace")
      .map((s) => relativeTo(plan.root!, dirname(s.path)));
    if (dep && added.length) {
      manifest.skills[plan.name] = { ...dep, links: [...new Set([...(dep.links ?? []), ...added])] };
      writeManifest(plan.root, manifest);
    }
  }
  return { name: plan.name, root: plan.root, applied, held };
}

/** Short label for a step, e.g. "link .agents/skills/x" or "~/.claude/skills/x → link". */
export function describeStep(step: TidyStep, root: string | null): string {
  const shown = root ? relativeTo(root, step.path) : tildify(step.path);
  switch (step.kind) {
    case "link":
      return `link ${shown}`;
    case "unlink":
      return `remove extra link ${shown}`;
    case "replace":
      return `${shown}: ${step.differs ? "differing" : "duplicate"} copy → link`;
    case "remove":
      return `remove ${step.differs ? "differing" : "duplicate"} copy ${shown}`;
  }
}

/** ".claude/skills" in a repo, "~/.agents/skills" for a global folder. */
export function folderLabel(root: string | null, dir: string): string {
  return root ? relativeTo(root, dir) : tildify(dir);
}

/**
 * Where a skill is, in a repo's skill folders (or the global ones when `root` is null):
 * every folder holding it, and those holding a real copy (the ones `keep` can pick).
 */
export function foldersOf(root: string | null, name: string): { all: string[]; real: string[] } {
  const entries = entriesOf(root ? repoTidyDirs(root).map((d) => join(root, d)) : globalTidyDirs(), name);
  return { all: entries.map((e) => e.dir), real: entries.filter((e) => !e.link).map((e) => e.dir) };
}

