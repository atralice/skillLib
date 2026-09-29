import { basename, dirname, join, resolve, sep } from "node:path";
import {
  addSkill,
  createSkill,
  listBackups,
  restoreBackup,
  importSkill,
  librarySkills,
  nestedSkills,
  projectStatus,
  removeSkill,
  linkAll,
  syncProject,
  updateProject,
  type Change,
  type SkillState,
} from "./library.js";
import { claudeDir, libraryDir } from "./paths.js";
import { agentsSkillsDir, findProjectRoot, isProjectCandidate, knownProjects, projectSkillsDir, readManifest, rememberProjects } from "./project.js";
import { isSkillDir, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";
import { dim, error, green, info, red, success, table, tildify, truncate, warn, yellow } from "./output.js";
import { scanUsage, summarize, type UsageSummary } from "./usage.js";
import { libraryOrigins, machineSkills } from "./sources.js";
import { addRoot, allowTrackedLinks, discoverProjects, enabledHarnesses, expandHome, keptGlobal, readConfig, removeRoot, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "./config.js";
import { HARNESSES, installDirs, type HarnessId } from "./harnesses.js";
import { findIssues, runFix } from "./health.js";
import { pluginBackups, restorePlugin } from "./plugins.js";
import { applyTidy, copyLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type TidyReport } from "./tidy.js";

const USAGE_DAYS = 30;

export type Args = {
  positional: string[];
  force: boolean;
  all: boolean;
  global: boolean;
  fix: boolean;
  allowTracked: boolean;
  days: number;
  dryRun: boolean;
  allowGit: boolean;
  /** tidy: the folder whose copy wins a conflict, e.g. ".agents/skills". */
  keep?: string;
};

export function parseArgs(argv: string[]): Args {
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : USAGE_DAYS;
  const keepIdx = argv.indexOf("--keep");
  return {
    positional: argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--days" && argv[i - 1] !== "--keep"),
    force: argv.includes("--force"),
    all: argv.includes("--all"),
    global: argv.includes("--global"),
    fix: argv.includes("--fix"),
    allowTracked: argv.includes("--allow-tracked"),
    days: Number.isFinite(days) && days > 0 ? days : USAGE_DAYS,
    dryRun: argv.includes("--dry-run"),
    allowGit: argv.includes("--allow-git"),
    ...(keepIdx >= 0 && argv[keepIdx + 1] ? { keep: argv[keepIdx + 1] } : {}),
  };
}

function colorState(state: SkillState): string {
  if (state === "ok") return green(state);
  if (state === "folder missing" || state === "not in library") return red(state);
  if (state === "local only" || state === "from npx skills") return dim(state);
  return yellow(state);
}

function printChanges(changes: Change[]) {
  for (const c of changes) {
    if (c.blocked?.length) {
      warn(`${c.name}: git tracks ${c.blocked.join(", ")} here, so no link was added there. Re-run with --allow-tracked to add it.`);
    }
    if (c.action === "skipped") warn(`${c.name}: ${c.reason}`);
    else {
      const icon = c.action === "removed" ? red("-") : green(c.action === "installed" ? "+" : "↑");
      const versions = c.action === "removed" ? "" : c.from && c.from !== c.to ? ` v${c.from} → v${c.to}` : c.to ? ` v${c.to}` : "";
      info(`  ${icon} ${c.name}${versions} ${dim(c.action)}`);
    }
  }
}

/**
 * Maps a session cwd to the known project containing it. Sessions in other
 * directories fall back to the cwd itself, with Claude Code worktrees
 * (<repo>/.claude/worktrees/<name>) mapped back to their repo.
 */
export function projectOfFactory(projects: string[]) {
  const sorted = [...projects].sort((a, b) => b.length - a.length);
  return (cwd: string) => {
    if (!cwd) return null;
    const known = sorted.find((p) => cwd === p || cwd.startsWith(p + sep));
    if (known) return known;
    const repo = cwd.split(`${sep}.claude${sep}worktrees${sep}`)[0]!;
    return isProjectCandidate(repo) ? repo : null;
  };
}

async function usageBySkill(days: number, onlyProject?: string): Promise<Map<string, UsageSummary>> {
  const projectOf = projectOfFactory(onlyProject ? [onlyProject, ...knownProjects()] : knownProjects());
  const uses = await scanUsage(days);
  const scoped = onlyProject ? uses.filter((u) => projectOf(u.cwd) === onlyProject) : uses;
  return new Map(summarize(scoped, projectOf).map((s) => [s.skill, s]));
}

function lastUsed(summary: UsageSummary | undefined): string {
  return summary ? summary.lastUsed.slice(0, 10) : "-";
}

// ─── Commands ───────────────────────────────────────────

/** Skills in the current project and how they compare to the library. */
export async function status(args: Args) {
  const root = findProjectRoot();
  const skills = projectStatus(root);
  const nested = nestedSkills(root);
  info(`${basename(root)} ${dim(tildify(root))}\n`);
  if (skills.length === 0 && nested.length === 0) {
    info("No skills in this project yet. Add one from your library with: skilllib add <name>");
    return;
  }
  const usage = await usageBySkill(args.days, root);
  if (skills.length) {
    table(
      skills.map((s) => ({
        Skill: s.name,
        Status: s.source ? dim(`npx skills: ${s.source}`) : colorState(s.state),
        [`Uses (${args.days}d)`]: String(usage.get(s.name)?.uses ?? 0),
        "Last used": lastUsed(usage.get(s.name)),
      })),
    );
  }
  if (nested.length) {
    info(`${skills.length ? "\n" : ""}In subfolders ${dim("(Claude Code loads .claude/skills when you work there; Codex loads .agents/skills when started there)")}`);
    table(
      nested.map((s) => ({
        Skill: s.name,
        Folder: s.location,
        Status: colorState(s.state),
        [`Uses (${args.days}d)`]: String(usage.get(s.name)?.uses ?? 0),
      })),
    );
  }

  const states = new Set(skills.map((s) => s.state));
  const hints: string[] = [];
  if (states.has("update available")) hints.push("`skilllib update` to install the newest versions");
  if (states.has("folder missing")) hints.push("`skilllib sync` to restore missing skills");
  if (states.has("edited locally") || states.has("edited locally, update available"))
    hints.push("`skilllib import .claude/skills/<name> --force` to save local edits to the library");
  if (states.has("local only")) hints.push("`skilllib import .claude/skills/<name>` to add a local skill to the library");
  if (states.has("untracked copy of library skill") || states.has("untracked, differs from library"))
    hints.push("`skilllib add <name>` to manage an untracked skill (--force if it differs)");
  if (hints.length > 0) info("\n" + hints.map((h) => dim(`→ ${h}`)).join("\n"));
  rememberProjects([root]);
}

/** Everything in the library, where each skill is installed, and how much it's used. */
export async function list(args: Args) {
  const skills = librarySkills();
  if (skills.length === 0) {
    info(`Your library (${tildify(libraryDir())}) is empty.`);
    info("Import skills with `skilllib import <skill-dir>`, or find existing ones with `skilllib scan ~/Projects`.");
  } else {
    const installs = new Map<string, string[]>();
    for (const project of visibleProjects()) {
      for (const name of Object.keys(readManifest(project).skills)) {
        installs.set(name, [...(installs.get(name) ?? []), basename(project)]);
      }
    }
    const usage = await usageBySkill(args.days);
    const origins = libraryOrigins();
    info(`Library ${dim(tildify(libraryDir()))}\n`);
    table(
      skills.map((s) => ({
        Skill: s.name,
        Description: truncate(s.description, 50),
        From: dim(truncate(origins[s.name] ?? "", 30)),
        Projects: (installs.get(s.name) ?? []).join(", ") || dim("none"),
        [`Uses (${args.days}d)`]: String(usage.get(s.name)?.uses ?? 0),
      })),
    );
  }

  const libraryNames = new Set(skills.map((s) => s.name));
  const globals = machineSkills().filter((m) => m.movable && !m.broken);
  if (globals.length > 0) {
    info("");
    warn(`${globals.length} of your global skill(s) still load in every project`);
    const missing = globals.filter((g) => !libraryNames.has(g.name));
    info(
      dim(
        missing.length > 0
          ? `→ \`skilllib import --global\` copies ${missing.length} of them into the library`
          : "→ all are in your library; run `skilllib` → Global skills to stop loading them everywhere",
      ),
    );
  }
}

export function projects() {
  const roots = visibleProjects();
  if (roots.length === 0) {
    info("No known projects. Run `skilllib scan <dir>` to find them, or `skilllib add` inside one.");
    return;
  }
  table(
    roots.map((root) => {
      const skills = projectStatus(root);
      const managed = skills.filter((s) => s.managed);
      const attention = skills.filter((s) => s.state !== "ok" && s.state !== "local only").length;
      return {
        Project: basename(root),
        Path: dim(tildify(root)),
        Skills: managed.map((s) => s.name).join(", ") || dim("none"),
        "Local only": String(skills.filter((s) => s.state === "local only").length),
        Status: attention === 0 ? green("ok") : yellow(`${attention} need attention`),
      };
    }),
  );
}

export function add(args: Args) {
  if (args.positional.length === 0) {
    error("Usage: skilllib add <skill-name>... [--force]");
    process.exit(1);
  }
  const root = findProjectRoot();
  if (args.allowTracked) allowTrackedLinks(root);
  printChanges(args.positional.map((name) => addSkill(root, name, { force: args.force })));
  rememberProjects([root]);
}

export function remove(args: Args) {
  if (args.positional.length === 0) {
    error("Usage: skilllib remove <skill-name>... [--force]");
    process.exit(1);
  }
  const root = findProjectRoot();
  printChanges(args.positional.map((name) => removeSkill(root, name, { force: args.force })));
}

/** Installs exactly the versions in skilllib.json (--all: every project). */
export function sync(args: Args) {
  const roots = args.all ? visibleProjects() : [findProjectRoot()];
  for (const root of roots) {
    if (args.allowTracked) allowTrackedLinks(root);
    const changes = syncProject(root, { force: args.force });
    if (args.all) info(`${basename(root)} ${dim(tildify(root))}`);
    if (changes.length === 0) success("Installed versions match skilllib.json");
    else printChanges(changes);
  }
  if (!args.all) rememberProjects(roots);
}

/** Moves skills to their newest library version (all, or the ones named). */
export function update(args: Args) {
  const roots = args.all ? visibleProjects() : [findProjectRoot()];
  for (const root of roots) {
    if (args.allowTracked) allowTrackedLinks(root);
    const changes = updateProject(root, args.positional.length ? args.positional : undefined, { force: args.force });
    if (args.all) info(`${basename(root)} ${dim(tildify(root))}`);
    if (changes.length === 0) success("Everything is on the latest version");
    else printChanges(changes);
  }
}

/** Skills with a newer library version, per project. */
export function outdated(args: Args) {
  const roots = args.all ? visibleProjects() : [findProjectRoot()];
  const rows = roots.flatMap((root) =>
    projectStatus(root)
      .filter((s) => s.managed && s.latest !== null && s.version !== null && s.latest > s.version)
      .map((s) => ({ Project: basename(root), Skill: s.name, Installed: `v${s.version}`, Latest: `v${s.latest}`, Status: colorState(s.state) })),
  );
  if (rows.length === 0) return success("Everything is on the latest version");
  table(rows);
  info(dim(`\n→ skilllib update${args.all ? " --all" : ""}`));
}

/**
 * Copies skill folders into the library. When a folder is a managed skill in
 * a project, the project is marked in sync with the new library version.
 */
export function importSkills(args: Args) {
  const dirs = args.global ? machineSkills().filter((m) => m.movable && !m.broken).map((m) => m.path) : args.positional.map((p) => resolve(p));
  if (dirs.length === 0) {
    error("Usage: skilllib import <skill-dir>... [--force] | skilllib import --global");
    process.exit(1);
  }
  for (const dir of dirs) {
    if (!isSkillDir(dir)) {
      warn(`${tildify(dir)}: no SKILL.md, skipping`);
      continue;
    }
    const { name, status: result } = importSkill(dir, { force: args.force });
    if (result === "exists") {
      warn(`${name}: the library already has a different version (use --force to replace it)`);
      continue;
    }
    success(`${name} ${dim(result === "unchanged" ? "already in library" : result === "added" ? "added to library" : "library updated")}`);

    // Importing a project's own skill folder: that project now uses the library copy.
    const skillsDir = resolve(dir, "..");
    const root = resolve(skillsDir, "..", "..");
    if (skillsDir === join(root, ".claude", "skills") && isProjectCandidate(root)) {
      if (readManifest(root).skills[name]?.hash !== treeHash(dir)) {
        const change = addSkill(root, name);
        if (change.action !== "skipped") info(dim(`  ${basename(root)} now depends on ${name} v${change.to}`));
      }
      rememberProjects([root]);
    }
  }
}

/** Adds folders (default: the configured ones) and scans them for projects. */
export function scan(args: Args) {
  for (const p of args.positional) addRoot(p);
  const { roots } = readConfig();
  if (roots.length === 0) {
    info("No project folders yet. Run `skilllib scan ~/Projects` (or wherever your repos live).");
    return;
  }
  const found = discoverProjects();
  const library = new Set(librarySkills().map((s) => s.name));
  const skillNames = (root: string) => [...skillDirsIn(projectSkillsDir(root)), ...skillDirsIn(agentsSkillsDir(root))].map((d) => basename(d));
  const withSkills = found.filter((root) => skillNames(root).length > 0);
  info(`Scanned ${roots.map((r) => tildify(r)).join(", ")}: ${found.length} project(s), ${withSkills.length} with skills\n`);
  table(
    withSkills.map((root) => ({
      Project: basename(root),
      Path: dim(tildify(root)),
      Skills: [...new Set(skillNames(root))].map((n) => (library.has(n) ? n : yellow(n))).join(", "),
    })),
  );
  if (withSkills.length > 0) info(`\n${yellow("Yellow")} skills aren't in your library yet (import them from \`skilllib\` → 3 Sources or 5 Health).`);
}

export function folders(args: Args) {
  const [action, ...paths] = args.positional;
  if (action === "add") {
    for (const p of paths) success(`Added ${tildify(addRoot(p))}`);
    discoverProjects();
  } else if (action === "remove" || action === "rm") {
    for (const p of paths) {
      if (removeRoot(p)) success(`Removed ${tildify(expandHome(p))}`);
      else warn(`${tildify(expandHome(p))} wasn't a project folder`);
    }
  }
  const { roots, hidden } = readConfig();
  info(roots.length ? `Project folders:\n${roots.map((r) => `  ${tildify(r)}`).join("\n")}` : "No project folders. Add one: skilllib folders add ~/Projects");
  if (hidden.length) info(dim(`Hidden projects: ${hidden.map((h) => tildify(h)).join(", ")}  (skilllib unhide <path>)`));
}

export function unhide(args: Args) {
  for (const p of args.positional) {
    setHidden(expandHome(p), false);
    success(`${tildify(expandHome(p))} is visible again`);
  }
}

export function newSkill(args: Args) {
  const [name, ...rest] = args.positional;
  if (!name) {
    error("Usage: skilllib new <name> [description]");
    process.exit(1);
  }
  const r = createSkill(name, rest.join(" "));
  if (!r.ok) {
    error(`Can't create ${name}: ${r.reason}`);
    process.exit(1);
  }
  success(`Created ${tildify(join(r.dir, "SKILL.md"))}`);
}

export function restore(args: Args) {
  const backups = [...listBackups(), ...pluginBackups()];
  const name = args.positional[0];
  if (!name) {
    if (backups.length === 0) return info("Nothing to restore.");
    table(backups.map((b) => ({ Skill: b.name, From: b.kind === "trash" ? "library (deleted)" : b.kind === "plugin" ? "Claude Code plugin" : tildify(dirname(b.from)), Moved: b.movedAt })));
    info(dim("\n→ skilllib restore <name>"));
    return;
  }
  const backup = backups.find((b) => b.name === name);
  if (!backup) {
    error(`No backup named ${name}`);
    process.exit(1);
  }
  const r = backup.kind === "plugin" ? restorePlugin(backup) : restoreBackup(backup);
  if (r.ok) success(`Restored ${name} to ${tildify(r.to)}`);
  else error(`Can't restore ${name}: ${r.reason}`);
}

/** Lists problems and suggestions; --fix applies every automatic fix. */
export function doctor(args: Args) {
  const projects = visibleProjects();
  const issues = findIssues(projects, machineSkills(), new Set(librarySkills().map((s) => s.name)));
  if (issues.length === 0) return success("Everything looks good");
  for (const issue of issues) {
    info(`${issue.severity === "problem" ? red("●") : yellow("◆")} ${issue.title}`);
    info(dim(`  ${issue.detail}${issue.fix ? `  →  ${issue.fix.label}` : ""}`));
    if (issue.choices) info(dim(`  choose in skilllib → Health: ${issue.choices.map((c) => c.label).join(" / ")}`));
    if (args.fix && issue.fix) {
      const r = runFix(issue.fix);
      info(`  ${r.ok ? green("✓") : red("✗")} ${r.message}`);
    }
  }
  if (!args.fix && issues.some((i) => i.fix)) info(dim("\nRun `skilllib doctor --fix` to apply the fixes, or fix them one by one in `skilllib` → Health."));
}

/** Skill usage across all Claude Code sessions, from transcripts. */
export async function usage(args: Args) {
  const summaries = summarize(await scanUsage(args.days), projectOfFactory(knownProjects()));
  if (summaries.length === 0) {
    info(`No skill usage in Claude Code transcripts from the last ${args.days} days.`);
    return;
  }
  const library = new Set(librarySkills().map((s) => s.name));
  info(`Skill usage, last ${args.days} days ${dim(`(from ${tildify(join(claudeDir(), "projects"))})`)}\n`);
  table(
    summaries.map((s) => ({
      Skill: s.skill,
      Uses: String(s.uses),
      Projects: [...s.projects].map((p) => basename(p)).join(", ") || dim("-"),
      "Last used": lastUsed(s),
      Library: library.has(s.skill) ? green("yes") : dim("no"),
    })),
  );

  const unused = librarySkills().filter((s) => !summaries.some((u) => u.skill === s.name));
  if (unused.length > 0) {
    info("");
    warn(`Library skills unused in the last ${args.days} days: ${unused.map((s) => s.name).join(", ")}`);
  }
}

export function show(args: Args) {
  const name = args.positional[0];
  const dir = name ? join(libraryDir(), name) : "";
  if (!name || !isSkillDir(dir)) {
    error(name ? `${name} is not in the library` : "Usage: skilllib show <skill-name>");
    process.exit(1);
  }
  const { description } = readSkillInfo(dir);
  info(`${name} ${dim(tildify(dir))}`);
  if (description) info(`\n${description}`);
  const using = knownProjects().filter((p) => name in readManifest(p).skills);
  info(`\nInstalled in: ${using.map((p) => tildify(p)).join(", ") || "no projects"}`);
}

/** Show or set the harnesses you use: skilllib harnesses claude-code cursor codex */
export function harnessesCommand(args: Args) {
  const ids = HARNESSES.map((h) => h.id);
  if (args.positional.length) {
    const unknown = args.positional.filter((p) => !ids.includes(p as HarnessId));
    if (unknown.length) {
      error(`Unknown harness: ${unknown.join(", ")}. Choose from: ${ids.join(", ")}`);
      process.exit(1);
    }
    setHarnesses(args.positional as HarnessId[]);
    success(`Using ${args.positional.join(", ")}`);
  }
  const enabled = enabledHarnesses();
  for (const h of HARNESSES) {
    info(`${enabled.includes(h.id) ? green("◉") : dim("○")} ${h.name.padEnd(12)} ${dim(`reads ${h.projectDirs.join(", ")}${h.installed() ? " · detected" : ""}`)}`);
  }
  info(dim(`\nNew installs go to ${installDirs(enabled).join(" (real copy) + ")}${installDirs(enabled).length > 1 ? " (link)" : ""}.`));
}

/** Makes every skill in the project (or --all projects) usable by every harness you use. */
export function link(args: Args) {
  const roots = args.all ? visibleProjects() : [findProjectRoot()];
  for (const root of roots) {
    if (args.allowTracked) allowTrackedLinks(root);
    const res = linkAll(root);
    const label = args.all ? `${basename(root)}: ` : "";
    if (res.linked.length) success(`${label}linked ${res.linked.length} skill(s) for your other agents`);
    else if (!args.all) success("Every skill here is already usable by all your agents");
    if (res.blocked.length) warn(`${label}git tracks ${res.blocked.join(", ")}; re-run with --allow-tracked to link there too`);
  }
}

/** Your global skills, and which you keep global on purpose: skilllib global [keep|unkeep <name>...] */
export function globalCommand(args: Args) {
  const [action, ...names] = args.positional;
  const yours = machineSkills().filter((m) => m.movable && !m.broken);
  if (action === "keep" || action === "unkeep") {
    const unknown = names.filter((n) => !yours.some((m) => m.name === n));
    if (!names.length || unknown.length) {
      error(names.length ? `Not one of your global skills: ${unknown.join(", ")}` : `Usage: skilllib global ${action} <name>...`);
      process.exit(1);
    }
    setKeepGlobal(names, action === "keep");
    success(action === "keep" ? `Keeping ${names.join(", ")} global on purpose` : `${names.join(", ")} will show up in cleanup again`);
  } else if (action) {
    error("Usage: skilllib global [keep|unkeep <name>...]");
    process.exit(1);
  }
  const kept = keptGlobal();
  if (!yours.length) return info("None of your skills load globally.");
  for (const m of yours) info(`${kept.has(m.name) ? green("✓") : yellow("⚠")} ${m.name.padEnd(32)} ${dim(tildify(m.path))}`);
  const unreviewed = yours.filter((m) => !kept.has(m.name)).length;
  if (unreviewed) info(dim(`\n${unreviewed} not reviewed. Keep one global on purpose: skilllib global keep <name>`));
}

/**
 * One real copy per skill, plus only the links your agents need:
 * skilllib tidy [--all | --global] [--dry-run] [--allow-git] [<name> --keep <folder>]
 */
export function tidy(args: Args) {
  const names = args.positional;
  const keepFor = (base: string | null) =>
    args.keep ? Object.fromEntries(names.map((n) => [n, base ? resolve(base, args.keep!) : expandHome(args.keep!)])) : {};
  const reports: { label: string; report: TidyReport }[] = args.global
    ? [{ label: "global folders", report: planGlobalTidy({ keep: keepFor(null) }) }]
    : (args.all ? visibleProjects() : [findProjectRoot()]).map((root) => ({ label: basename(root), report: planProjectTidy(root, { keep: keepFor(root) }) }));

  let held = 0;
  let changed = 0;
  for (const { label, report } of reports) {
    const plans = report.plans.filter((p) => !names.length || names.includes(p.name));
    const conflicts = report.conflicts.filter((c) => !names.length || names.includes(c.name));
    if (!plans.length && !conflicts.length && !args.all) success(`${label}: every skill has one copy and the links your agents need`);
    for (const plan of plans) {
      const result = args.dryRun ? { applied: [], held: gitVisibleSteps(plan) } : applyTidy(plan, { git: args.allowGit ? "go" : "keep" });
      const show = args.dryRun ? plan.steps : result.applied;
      if (show.length) info(`${args.dryRun ? dim("would") : green("✓")} ${label} · ${plan.name}: ${show.map((s) => describeStep(s, plan.root)).join(", ")}`);
      if (!args.dryRun) for (const step of result.held) info(`${yellow("!")} ${label} · ${plan.name}: held back, git would see it: ${describeStep(step, plan.root)}`);
      held += args.dryRun ? 0 : result.held.length;
      changed += result.applied.length;
    }
    for (const c of conflicts) {
      warn(`${label} · ${c.name}: the copies differ`);
      for (const copy of c.copies) {
        const runs = copy.runs.map((id) => HARNESSES.find((h) => h.id === id)!.name);
        info(`    ${copyLabel(c, copy.dir)}${runs.length ? dim(`  run by ${runs.join(", ")}`) : ""}${c.managed === copy.dir ? dim("  (skilllib's copy)") : ""}`);
      }
      const pick = copyLabel(c, c.managed ?? c.copies[0]!.dir);
      info(dim(`    keep one: skilllib tidy ${c.name}${args.global ? " --global" : ""} --keep ${pick}`));
    }
    for (const s of report.skipped.filter((x) => !names.length || names.includes(x.name))) info(dim(`- ${label} · ${s.name}: skipped, ${s.reason}`));
  }
  if (args.dryRun) info(dim("\nNothing changed (--dry-run)."));
  else if (changed) info(dim("\nReplaced copies are in ~/.skilllib/tidy-backup; `skilllib restore` puts them back."));
  if (held) info(dim(`${held} change${held === 1 ? "" : "s"} held back because git would see them. Re-run with --allow-git to make them.`));
}
