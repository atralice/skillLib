import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { enabledHarnesses } from "./config.js";
import { gitInfo, relativeTo, type GitInfo } from "./git.js";
import { ALL_PROJECT_DIRS, HARNESSES, installDirs, type HarnessId } from "./harnesses.js";
import { entryExists, isLink, linkDir, realpathOrNull, stash } from "./library.js";
import { AGENTS_SKILLS_DIR, PROJECT_SKILLS_DIR, userHome } from "./paths.js";
import { readManifest, writeManifest } from "./project.js";
import { globalSkillDirs, projectSkillsLock } from "./sources.js";
import { treeHash } from "./skills.js";

/**
 * One change tidy makes, always to a single path:
 * - link:    point a wrong or broken link at the real copy
 * - unlink:  remove a link no agent you use needs
 * - replace: swap an identical (or, if you chose, a differing) real copy for a link
 * - remove:  drop an identical real copy no agent you use needs
 * Real copies that go away are stashed in ~/.skilllib/tidy-backup, restorable from Health.
 */
export type TidyStep =
  | { kind: "link"; path: string; target: string }
  | { kind: "unlink"; path: string }
  | { kind: "replace"; path: string; target: string }
  | { kind: "remove"; path: string };

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

export type TidyReport = { plans: TidyPlan[]; conflicts: Conflict[]; skipped: { name: string; reason: string }[] };

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

/** Hashes real copies only when there's more than one to compare: hashing reads every file. */
function hashReals(reals: Entry[]) {
  if (reals.length > 1) for (const r of reals) r.hash = treeHash(r.path);
}

function namesIn(dirs: string[]): string[] {
  const names = new Set<string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (!name.startsWith(".") && name !== "synced") names.add(name);
  }
  return [...names].sort();
}

/**
 * Which copy each agent runs when several folders hold one. Claude Code,
 * Codex and Zed read one folder each; Cursor reads several and, in our
 * test (September 2026), ran the .claude/skills copy over .agents/skills.
 */
function runsFrom(id: HarnessId, dirsWithCopy: string[], readsOf: (id: HarnessId) => string[]): string | undefined {
  const reads = readsOf(id).filter((d) => dirsWithCopy.includes(d));
  return reads.find((d) => d.endsWith(join(".claude", "skills"))) ?? reads[0];
}

function conflictOf(name: string, root: string | null, reals: Entry[], enabled: HarnessId[], readsOf: (id: HarnessId) => string[]): Conflict {
  const dirs = reals.map((r) => r.dir);
  return {
    name,
    root,
    copies: reals.map((r) => ({ dir: r.dir, path: r.path, runs: enabled.filter((id) => runsFrom(id, dirs, readsOf) === r.dir) })),
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
  const readsOf = (id: HarnessId) => HARNESSES.find((h) => h.id === id)!.projectDirs.map(abs);
  let git: GitInfo | null | undefined; // looked up once, only if needed
  const skillsLock = projectSkillsLock(root);

  for (const name of namesIn(ALL_PROJECT_DIRS.map(abs))) {
    const entries = entriesOf(ALL_PROJECT_DIRS.map(abs), name);
    const external = entries.find((e) => e.link && e.real && !(e.real + sep).startsWith(realpathOrNull(root)! + sep));
    if (external) {
      report.skipped.push({ name, reason: `${rel(external.path)} links outside the repo` });
      continue;
    }
    const reals = entries.filter((e) => !e.link);
    if (reals.length === 0) continue;
    hashReals(reals);

    const dep = skills[name];
    const chosen = keep[name];
    let primary: Entry | undefined;
    if (dep) {
      primary = reals.find((r) => rel(r.dir) === (dep.dir ?? PROJECT_SKILLS_DIR));
      if (!primary) continue; // folder missing: sync's job
    } else if (chosen) {
      primary = reals.find((r) => r.dir === chosen);
    } else {
      // The copy teammates get (committed); then, for a skill `npx skills` installed, its own
      // real copy in .agents/skills (its symlink layout); else the folder your agents need most.
      if (git === undefined) git = gitInfo(root);
      const planned = installDirs(enabled).map(abs);
      const fromSkillsSh = name in skillsLock;
      const rank = (e: Entry) =>
        (git && ["committed", "changed"].includes(git.of(rel(e.path))) ? 0 : 1000) +
        (fromSkillsSh && e.dir === abs(AGENTS_SKILLS_DIR) ? 0 : 100) +
        (planned.includes(e.dir) ? planned.indexOf(e.dir) : 50);
      primary = [...reals].sort((a, b) => rank(a) - rank(b))[0];
    }
    if (!primary) continue;
    if (chosen !== primary.dir && reals.some((r) => r.hash !== primary!.hash)) {
      report.conflicts.push({ ...conflictOf(name, root, reals, enabled, readsOf), ...(dep ? { managed: primary.dir } : {}) });
      continue;
    }

    const wanted = new Set([...installDirs(enabled, rel(primary.dir)), ...(dep?.links ?? [])].map(abs));
    const steps: TidyStep[] = [];
    for (const e of entries) {
      if (e === primary) continue;
      const needed = wanted.has(e.dir);
      if (e.link) {
        if (e.real === primary.real) {
          if (!needed) steps.push({ kind: "unlink", path: e.path });
        } else steps.push(needed ? { kind: "link", path: e.path, target: primary.path } : { kind: "unlink", path: e.path });
      } else {
        steps.push(needed ? { kind: "replace", path: e.path, target: primary.path } : { kind: "remove", path: e.path });
      }
    }
    if (steps.length) report.plans.push({ name, root, primary: primary.path, steps });
  }
  return report;
}

/** The global folders an agent reads. */
function globalReadsOf(id: HarnessId): string[] {
  return HARNESSES.find((h) => h.id === id)!.globalDirs();
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
  const dirs = globalSkillDirs();
  const agents = join(userHome(), ".agents", "skills");
  for (const name of namesIn(dirs)) {
    const entries = entriesOf(dirs, name);
    if (entries.some((e) => isSkillsDirPlugin(e.path))) {
      report.skipped.push({ name, reason: "a Claude Code plugin kept in a skills folder" });
      continue;
    }
    const reals = entries.filter((e) => !e.link);
    if (reals.length < 2) continue;
    hashReals(reals);
    const primary = reals.find((r) => r.dir === keep[name]) ?? reals.find((r) => r.dir === agents) ?? reals[0]!;
    if (!keep[name] && reals.some((r) => r.hash !== primary.hash)) {
      report.conflicts.push(conflictOf(name, null, reals, enabled, globalReadsOf));
      continue;
    }
    const steps = reals.filter((r) => r !== primary).map((r): TidyStep => ({ kind: "replace", path: r.path, target: primary.path }));
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
  return plan.steps.filter((s) => {
    const state = git.of(relativeTo(plan.root!, s.path));
    return state === "committed" || state === "changed";
  });
}

export type TidyResult = { name: string; root: string | null; applied: TidyStep[]; held: TidyStep[] };

/**
 * Applies a plan. With `git: "keep"`, steps git would notice are held back
 * (see gitVisibleSteps) and reported instead. Links skilllib.json should know
 * about are recorded there.
 */
export function applyTidy(plan: TidyPlan, { git = "keep", info }: { git?: "keep" | "go"; info?: GitInfo | null } = {}): TidyResult {
  const held = git === "keep" ? gitVisibleSteps(plan, info) : [];
  const applied: TidyStep[] = [];
  for (const step of plan.steps) {
    // Planned earlier (Health builds plans on load); skip what changed since.
    if (held.includes(step) || !entryExists(step.path) || ("target" in step && !entryExists(step.target))) continue;
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
  const shown = root ? relativeTo(root, step.path) : step.path.replace(userHome(), "~");
  switch (step.kind) {
    case "link":
      return `link ${shown}`;
    case "unlink":
      return `remove extra link ${shown}`;
    case "replace":
      return `${shown}: duplicate copy → link`;
    case "remove":
      return `remove duplicate copy ${shown}`;
  }
}

/** Folder label for a conflict copy: ".claude/skills" in a repo, "~/.agents/skills" globally. */
export function copyLabel(conflict: Conflict, dir: string): string {
  return conflict.root ? relativeTo(conflict.root, dir) : dir.replace(userHome(), "~");
}

