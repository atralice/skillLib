import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  addSkill,
  importSkill,
  librarySkills,
  projectStatus,
  removeSkill,
  syncProject,
  type Change,
  type SkillState,
} from "./library.js";
import { claudeDir, libraryDir } from "./paths.js";
import { findProjectRoot, isProjectCandidate, knownProjects, projectSkillsDir, readManifest, rememberProjects, writeManifest } from "./project.js";
import { isSkillDir, readSkillInfo, skillDirsIn, treeHash } from "./skills.js";
import { dim, error, green, info, red, success, table, tildify, truncate, warn, yellow } from "./output.js";
import { scanUsage, summarize, type UsageSummary } from "./usage.js";

const USAGE_DAYS = 30;

export type Args = { positional: string[]; force: boolean; all: boolean; global: boolean; days: number };

export function parseArgs(argv: string[]): Args {
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : USAGE_DAYS;
  return {
    positional: argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--days"),
    force: argv.includes("--force"),
    all: argv.includes("--all"),
    global: argv.includes("--global"),
    days: Number.isFinite(days) && days > 0 ? days : USAGE_DAYS,
  };
}

function colorState(state: SkillState): string {
  if (state === "ok") return green(state);
  if (state === "folder missing" || state === "not in library") return red(state);
  if (state === "local only") return dim(state);
  return yellow(state);
}

function printChanges(changes: Change[]) {
  for (const c of changes) {
    if (c.action === "skipped") warn(`${c.name}: ${c.reason}`);
    else info(`  ${c.action === "removed" ? red("-") : green(c.action === "installed" ? "+" : "↑")} ${c.name} ${dim(c.action)}`);
  }
}

/**
 * Maps a session cwd to the known project containing it. Sessions in other
 * directories fall back to the cwd itself, with Claude Code worktrees
 * (<repo>/.claude/worktrees/<name>) mapped back to their repo.
 */
function projectOfFactory(projects: string[]) {
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
  info(`${basename(root)} ${dim(tildify(root))}\n`);
  if (skills.length === 0) {
    info("No skills in this project yet. Add one from your library with: skilllib add <name>");
    return;
  }
  const usage = await usageBySkill(args.days, root);
  table(
    skills.map((s) => ({
      Skill: s.name,
      Status: colorState(s.state),
      [`Uses (${args.days}d)`]: String(usage.get(s.name)?.uses ?? 0),
      "Last used": lastUsed(usage.get(s.name)),
    })),
  );

  const states = new Set(skills.map((s) => s.state));
  const hints: string[] = [];
  if (states.has("update available") || states.has("folder missing")) hints.push("`skilllib sync` to update from the library");
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
    for (const project of knownProjects()) {
      for (const name of Object.keys(readManifest(project).skills)) {
        installs.set(name, [...(installs.get(name) ?? []), basename(project)]);
      }
    }
    const usage = await usageBySkill(args.days);
    info(`Library ${dim(tildify(libraryDir()))}\n`);
    table(
      skills.map((s) => ({
        Skill: s.name,
        Description: truncate(s.description, 50),
        Projects: (installs.get(s.name) ?? []).join(", ") || dim("none"),
        [`Uses (${args.days}d)`]: String(usage.get(s.name)?.uses ?? 0),
      })),
    );
  }

  const globals = skillDirsIn(join(claudeDir(), "skills"));
  if (globals.length > 0) {
    info("");
    warn(
      `${globals.length} global skill(s) in ${tildify(join(claudeDir(), "skills"))} load in every project: ${globals.map((g) => basename(g)).join(", ")}`,
    );
    info(dim(`→ \`skilllib import --global\` copies them into the library so you can add them per project`));
  }
}

export function projects() {
  const roots = knownProjects();
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

export function sync(args: Args) {
  const roots = args.all ? knownProjects() : [findProjectRoot()];
  for (const root of roots) {
    const changes = syncProject(root, { force: args.force });
    if (args.all) info(`${basename(root)} ${dim(tildify(root))}`);
    if (changes.length === 0) success("Up to date");
    else printChanges(changes);
  }
  if (!args.all) rememberProjects(roots);
}

/**
 * Copies skill folders into the library. When a folder is a managed skill in
 * a project, the project is marked in sync with the new library version.
 */
export function importSkills(args: Args) {
  const dirs = args.global ? skillDirsIn(join(claudeDir(), "skills")) : args.positional.map((p) => resolve(p));
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
      const manifest = readManifest(root);
      if (manifest.skills[name] !== treeHash(dir)) {
        manifest.skills[name] = treeHash(dir) ?? "";
        writeManifest(root, manifest);
        info(dim(`  ${basename(root)} now tracks ${name} in skilllib.json`));
      }
      rememberProjects([root]);
    }
  }
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "vendor", "target", "Library", "Applications"]);

function findProjects(dir: string, depth: number): string[] {
  if (depth < 0 || !existsSync(dir)) return [];
  const hasSkills = skillDirsIn(projectSkillsDir(dir)).length > 0 || existsSync(join(dir, "skilllib.json"));
  const here = hasSkills && isProjectCandidate(dir) ? [dir] : [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_DIRS.has(d.name))
      .map((d) => join(dir, d.name));
  } catch {
    return here;
  }
  return [...here, ...entries.flatMap((e) => findProjects(e, depth - 1))];
}

/** Finds projects with skills under the given directories and remembers them. */
export function scan(args: Args) {
  const bases = args.positional.length > 0 ? args.positional.map((p) => resolve(p)) : [process.cwd()];
  const found = bases.flatMap((b) => findProjects(b, 4));
  if (found.length === 0) {
    info("No projects with .claude/skills found.");
    return;
  }
  rememberProjects(found);
  const library = new Set(librarySkills().map((s) => s.name));
  table(
    found.map((root) => {
      const names = skillDirsIn(projectSkillsDir(root)).map((d) => basename(d));
      return {
        Project: basename(root),
        Path: dim(tildify(root)),
        Skills: names.map((n) => (library.has(n) ? n : yellow(n))).join(", "),
      };
    }),
  );
  info(`\nRemembered ${found.length} project(s). ${yellow("Yellow")} skills aren't in your library yet.`);
  info(dim("→ `skilllib import <project>/.claude/skills/<name>` to add one"));
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
