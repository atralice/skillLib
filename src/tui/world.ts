/**
 * The TUI's model: your repos, your library and what loads everywhere, as plain data, with
 * doctor's issues (health.ts) placed on their rows. Actions act through `w.ops`: the real disk
 * (load.ts), or in-memory sample data (sample.ts) for tests and headless checks.
 */
import { isShared, type GitState } from "../git.js";
import type { HarnessId } from "../harnesses.js";
import { runFix, type Choice, type Issue as Found } from "../health.js";

export type Source = "lib" | "repo" | "untracked" | "global" | "plugin" | "claude.ai" | "cursor" | "grok" | "system" | "skilllib";
export type Filter = "all" | "local" | "global" | "plugins" | "vendor";

export type LocalSkill = {
  name: string;
  /** lib: tracked in skilllib.json · repo: the team's (in .agents/skills or .grok/skills, or committed to git), never removed · untracked: only on this machine. */
  source: "lib" | "repo" | "untracked";
  /** Project folder holding the real copy, e.g. ".claude/skills". */
  dir: string;
  path: string;
  /** Its own description, when it isn't the one `descriptions` has for the name (the team's copy, say). */
  description?: string;
  /** Your agents that load it here. */
  agents: HarnessId[];
  /** Installed version, for tracked skills. */
  version?: number;
  /** Tracked in your personal pins (~/.skilllib/pins), not skilllib.json: only on your machines, kept out of git. */
  personal?: boolean;
  /** A tracked skill git has: its copy, or a link skilllib.json records. */
  inGit?: boolean;
  /** Its pin can move between skilllib.json and your personal pins (see pinFix). */
  pinMoves?: boolean;
  edited?: boolean;
  missing?: boolean;
  /** Its git state; null when the repo isn't a git repo. */
  git: GitState | null;
  /** Where it was installed from, e.g. "npx skills: owner/repo" (the repo's skills-lock.json). */
  origin?: string;
  /** Other project folders holding a real copy of it (one that differs, or an extra one), e.g. ".agents/skills". */
  others?: string[];
};

export type MachineSkill = {
  name: string;
  /** system: a machine-wide folder an admin manages (/etc/codex/skills) · skilllib: skilllib's own skill (`where`: its global folder). */
  source: "global" | "plugin" | "claude.ai" | "cursor" | "grok" | "system" | "skilllib";
  /** Global folder, plugin id, or where a vendor skill comes from. */
  where: string;
  /** Where it was installed from, e.g. an `npx skills` repo. */
  origin?: string;
  path: string;
  /** Other global entries (links) pointing at it. */
  links: string[];
  agents: HarnessId[];
  kept?: boolean;
  broken?: boolean;
  /** When its folder appeared ("2026-09-25 20:55"): skills copied in together share it. */
  installed?: string;
};

export type LibrarySkill = {
  name: string;
  latest: number;
  /** Where skilllib imported it from, e.g. "plugin: ponytail@ponytail" or "skills.sh: owner/repo". */
  origin?: string;
};

export type Project = {
  /** Unique display name (the folder's name). */
  name: string;
  /** The repo's root. */
  path: string;
  /** skilllib.json's git state; "no git" when the repo isn't a git repo. */
  manifest: GitState | "none" | "no git";
  skills: LocalSkill[];
  /** What loads here besides its own skills, when the repo's Claude Code settings turn a plugin on or off (else World.machine). */
  machine?: MachineSkill[];
};

/** An installed plugin, on or off: Claude Code's (one per install) or Cursor's (read only). */
export type Plugin = {
  /** Unique per install: id, scope and project. */
  key: string;
  /** name@marketplace, or name@synced for plugins synced from claude.ai. */
  id: string;
  agent: "claude-code" | "cursor";
  /** user, project, local · claude.ai: synced from your account · cursor: Cursor's own. */
  scope: string;
  /** Project and local installs: the repo (its name, if skilllib lists it) and its path. */
  repo?: string;
  projectPath?: string;
  /** null when it can't be read (Cursor). */
  on: boolean | null;
  version?: string;
  /** A newer version in its marketplace ("newer" when only the commit differs). */
  update?: string;
  /** Turned on in your settings with no install record: it can't be uninstalled or updated, only turned off. */
  settingsOnly?: true;
  description: string;
  path: string;
  skills: { name: string; path: string }[];
  /** What else it brings: "commands", "agents", "hooks", "MCP servers". */
  parts: string[];
};

export type Backup = { name: string; from: string; at: string };

/**
 * What a fix did. `then` asks for one more confirmation (e.g. linking into a folder git tracks);
 * `failed` when it didn't do what it was for (the app shows ✗).
 */
export type Result = string | { message: string; then: Fix } | { message: string; failed: true };

export const failed = (message: string): Result => ({ message, failed: true });
export const isFailure = (r: Result): boolean => typeof r !== "string" && "failed" in r;
/** The follow-up question a result asks, if any. */
export const followUp = (r: Result): Fix | undefined => (typeof r !== "string" && "then" in r ? r.then : undefined);
/** A result's message. */
export const said = (r: Result): string => (typeof r === "string" ? r : r.message);
/** Several results as one: their messages, failed if any failed. */
export const joined = (results: Result[]): Result => {
  // A group's results: how many went first, so the ones that did aren't lost behind the ones that didn't.
  const bad = results.filter(isFailure);
  const message = [...(bad.length && bad.length < results.length ? [`${results.length - bad.length} of ${results.length} done`] : []), ...results.map(said)].join(" · ");
  return bad.length ? failed(message) : message;
};

/** Everything that changes something, and a few lookups too slow to do for every repo up front. */
export type Ops = {
  add(repo: string, name: string): Result;
  /** Library skills into several repos; links git-tracked folders held back are one question for all of them. */
  addTo(repos: string[], names: string[]): Result;
  remove(repo: string, name: string): Result;
  /** One tracked skill to the newest library version (doctor's fix updates every one in the repo). */
  update(repo: string, name: string): Result;
  /** Moves a tracked skill's pin to your personal pins, or to the repo's skilllib.json; its version stays. */
  pin(repo: string, name: string, personal: boolean): Result;
  /** This repo's copy into your library (new skill, or a new version); the repo's copy stays. */
  copyToLibrary(repo: string, name: string): Result;
  deleteGlobal(m: MachineSkill): Result;
  keepGlobal(name: string, keep: boolean): Result;
  /**
   * Global skills into your library and these repos, no longer loading globally. One result for all of them,
   * asking before linking into folders git tracks. `group`: the group they moved with, recorded as their
   * origin so they stay grouped in your library.
   */
  moveGlobal(skills: MachineSkill[], repos: string[], group?: string): Result;
  createSkill(name: string): Result;
  /** A plugin's skills into your library (and these repos), then the plugin uninstalled from Claude Code. */
  replacePlugin(p: Plugin, repos: string[]): Result;
  /** Turns a Claude Code plugin on or off where it's installed. */
  setPlugin(p: Plugin, on: boolean): Result;
  /** Uninstalls a Claude Code plugin, keeping its data; Settings › Backups reinstalls it. */
  uninstallPlugin(p: Plugin): Result;
  updatePlugin(p: Plugin): Result;
  /** Deletes a library skill, first removing it from every repo that tracks it (each copy backed up). */
  deleteLibrary(name: string): Result;
  restoreBackup(index: number): Result;
  setAgents(ids: HarnessId[]): Result;
  /** A tracked skill at a specific library version. */
  installVersion(repo: string, name: string, version: number): Result;
  versions(name: string): { version: number; date: string }[];
  /** The library's SKILL.md for a skill, to edit. */
  libraryFile(name: string): string;
  addRoot(path: string): Result;
  removeRoot(path: string): Result;
  /** Looks for repos in your project folders again. */
  rescan(): Result;
  hide(repo: string): Result;
  unhide(path: string): Result;
  openFolder(path: string): Result;
  /** Copies text for an agent (and saves it); says where it went. */
  copy(text: string, what: string): Result;
  /** Installs (or refreshes) the skilllib skill in the global folders your agents read. */
  installAgentSkill(): Result;
  /** Removes the skilllib skill from the global folders it was installed in. */
  removeAgentSkill(): Result;
  /** What usage says on top of `World.issues` (doctor's unused skills). */
  usageIssues(used: Pick<World, "usage" | "totals">): Found[];
};

export type World = {
  agents: HarnessId[];
  /** The repo you started in, if any. */
  cwd: string | null;
  projects: Project[];
  machine: MachineSkill[];
  /** Every plugin installed, on or off. */
  plugins: Plugin[];
  library: LibrarySkill[];
  /** Uses in the last 30 days, per repo, per skill. */
  usage: Record<string, Record<string, number>>;
  /** The same per day (index 29 = today); absent until the transcripts are read. */
  days?: Record<string, Record<string, number[]>>;
  /**
   * Uses in every session, in a listed repo or not, as doctor counts them: per skill (a plugin's copy counts
   * for the skill), and per name as recorded when that differs (a plugin's as plugin:skill).
   */
  totals?: Record<string, number>;
  descriptions: Record<string, string>;
  backups: Backup[];
  /** Folders scanned for repos, and repos you hid from the list. */
  roots: string[];
  hidden: string[];
  /** You've picked your agents (otherwise the first run asks). */
  agentsChosen: boolean;
  /** The skilllib skill, which lets your agents answer "which skills can I use here?" with skilllib. */
  agentSkill: "installed" | "outdated" | "missing";
  /** What `skilllib doctor` reports (health.ts), with usage's once it's read. */
  issues: Found[];
  ops: Ops;
};

/** One skill as a repo sees it. */
export type Usable = {
  name: string;
  source: Source;
  /** Plugin id, global folder, or project folder. */
  where: string;
  agents: HarnessId[];
  uses: number;
  local?: LocalSkill;
  machine?: MachineSkill;
};

export type Severity = Found["severity"];
export type Fix = {
  label: string;
  /** What happens, shown before you confirm. */
  preview: string;
  run: (w: World) => Result;
  /** Opens the repo picker; called with the repos you tick. */
  pickRepos?: (w: World, repos: string[]) => Result;
  /** Repos the picker offers (default: all). */
  candidates?: (w: World) => string[];
  /** Repos ticked to start with (default: the ones that used the skill). */
  preticked?: (w: World) => string[];
  /** The picker may be confirmed with no repo ticked. */
  allowNone?: boolean;
};
/** One of doctor's issues (health.ts) as the app shows it. */
export type Issue = {
  id: string;
  severity: Severity;
  title: string;
  /** The same, in a few words, for the list; the details show `title`. */
  short: string;
  detail: string;
  /** The skills it names, each once. */
  skills: string[];
  /** Decisions never run from "fix all"; the first fix of an automatic issue is the recommended one. */
  decision: boolean;
  fixes: Fix[];
};

export const SEVERITY_RANK: Record<Severity, number> = { problem: 0, suggestion: 1 };

/** One of doctor's fixes or choices as the app runs it: its hint, then what the issue says, before you confirm. */
function fixOf(c: Choice, found: Found): Fix {
  return {
    label: c.label,
    preview: c.hint ? `${c.hint[0]!.toUpperCase()}${c.hint.slice(1)}. ${found.detail}` : found.detail,
    run: () => {
      const r = runFix(c);
      return r.ok ? r.message : failed(r.message);
    },
  };
}

/** An issue in a few words, by the kind its id starts with; its title when there's no shorter way to say it. */
function shortOf(found: Found): string {
  const kind = found.id.split(":")[0]!;
  if (found.id === "unused:library") return "In no repo, unused 30 days";
  if (kind === "plugin") return `Also in ⧉ ${found.plugin!.split("@")[0]}`;
  if (kind === "cursor-plugin") return `Also in Cursor's ${found.plugin}`;
  const short: Record<string, string> = {
    broken: "Broken link",
    dup: "Loaded twice",
    tidy: "Extra copies",
    conflict: "Copies differ",
    review: "Not reviewed",
    usable: "Not every agent can use it",
    sync: "Folder missing",
    unavailable: "Pinned, not in your library",
    pin: "Pinned version not in your library",
    "out-of-sync": "Not the pinned version",
    shadowed: "Pinned twice",
    update: "Out of date",
    uncommitted: "Commit it first",
    local: "Not in your library",
    adopt: "Not tracked",
    differs: "Differs from your library",
    npx: "From npx skills",
    "plugin-update": "Update available",
    "plugin-unused": "Unused 30 days",
    edited: "Edited here",
    "not-in-lib": "No longer in your library",
    twice: "Repo and global copies",
    unused: "Unused 30 days",
  };
  return short[kind] ?? found.title;
}

/** Each issue's view, made once: the screens look issues up on every render. */
const views = new WeakMap<Found, Issue>();

/** A doctor issue as the app shows it: its `fix` is the ★ one; `choices` make it your call. */
export function issueOf(found: Found): Issue {
  let view = views.get(found);
  if (!view) views.set(found, (view = viewOf(found)));
  return view;
}

function viewOf(found: Found): Issue {
  return {
    id: found.id,
    severity: found.severity,
    title: found.title,
    short: shortOf(found),
    detail: found.detail,
    skills: [...new Set(found.at?.flatMap((a) => (a.skill ? [a.skill] : [])))],
    decision: !found.fix,
    fixes: (found.fix ? [found.fix] : (found.choices ?? [])).map((c) => fixOf(c, found)),
  };
}

export function filterOf(source: Source): Exclude<Filter, "all"> {
  return source === "lib" || source === "repo" || source === "untracked" ? "local" : source === "global" || source === "skilllib" ? "global" : source === "plugin" ? "plugins" : "vendor";
}

export function project(w: World, name: string): Project {
  return w.projects.find((p) => p.name === name)!;
}

/** The name a copy's uses are recorded under: Claude Code records a plugin's skill as "plugin:skill". */
export function usesKey(m: Pick<MachineSkill, "name" | "source" | "where">): string {
  return m.source === "plugin" ? `${m.where.split("@")[0]}:${m.name}` : m.name;
}

export function totalUses(w: World, name: string): number {
  return Object.values(w.usage).reduce((n, u) => n + (u[name] ?? 0), 0);
}

/** Uses per day over the last 30 days (index 29 = today), in one repo or all of them. */
export function dailyUses(w: World, name: string, onlyRepo?: string): number[] {
  const days = new Array<number>(30).fill(0);
  for (const [repo, bySkill] of Object.entries(w.days ?? {})) {
    if (onlyRepo && repo !== onlyRepo) continue;
    bySkill[name]?.forEach((n, i) => (days[i]! += n));
  }
  return days;
}

/** What loads in a project besides its own skills: World.machine, unless its settings turn a plugin on or off. */
export function machineIn(w: World, p: Project): MachineSkill[] {
  return p.machine ?? w.machine;
}

/** Everything agents can use in a project: its own skills plus what loads everywhere. */
export function usable(w: World, projectName: string): Usable[] {
  const p = project(w, projectName);
  const uses = (n: string) => w.usage[projectName]?.[n] ?? 0;
  return [
    ...p.skills.map((s): Usable => ({ name: s.name, source: s.source, where: s.dir, agents: s.agents, uses: uses(s.name), local: s })),
    ...machineIn(w, p).map((m): Usable => ({ name: m.name, source: m.source, where: m.where, agents: m.agents, uses: uses(usesKey(m)), machine: m })),
  ];
}

// ─── Health ─────────────────────────────────────────────

/** Doctor's issues on a skill's row, in a repo or in Global (`repo` null). */
export function issuesAt(w: World, repo: string | null, skill: string): Issue[] {
  const root = repo === null ? null : project(w, repo).path;
  return w.issues.filter((i) => i.at?.some((a) => a.root === root && a.skill === skill)).map(issueOf);
}

/** Doctor's issues on a repo's rows, each once. */
export function repoIssues(w: World, repo: string): Issue[] {
  const root = project(w, repo).path;
  return w.issues.filter((i) => i.at?.some((a) => a.root === root)).map(issueOf);
}

/** Skills doctor names in a repo that have no copy there (a link to nothing): their issues get a row of their own. */
export function unlisted(w: World, repo: string): string[] {
  const root = project(w, repo).path;
  const listed = new Set(usable(w, repo).map((u) => u.name));
  return [...new Set(w.issues.flatMap((i) => (i.at ?? []).filter((a) => a.root === root && a.skill && !listed.has(a.skill)).map((a) => a.skill)))];
}

/** Doctor's issue on a library skill's row: in no repo, unused (the rest are where the skill is). */
export function libraryIssues(w: World, name: string): Issue[] {
  return w.issues.filter((i) => i.id === "unused:library" && i.at?.some((a) => a.skill === name)).map(issueOf);
}

/** Doctor's issues about a plugin, or about this install of it; Cursor's are named without their marketplace. */
export function pluginIssues(w: World, p: Plugin): Issue[] {
  const id = p.agent === "cursor" ? pluginName(p) : p.id;
  return w.issues.filter((i) => i.plugin === id && (i.pluginAt === undefined || i.pluginAt === (p.projectPath ?? null))).map(issueOf);
}

/** What you can do with one of your global skills. */
function globalFixes(m: MachineSkill): Fix[] {
  return [
    {
      label: "Move it to the repos that need it…",
      preview: `Pick repos. ${m.name} goes into your library and those repos, and stops loading globally (every global copy backed up).`,
      run: () => "",
      pickRepos: (w, repos) => w.ops.moveGlobal([m], repos),
    },
    m.kept
      ? { label: "Stop marking it as global on purpose", preview: `${m.name} shows as Not reviewed again, like any global skill.`, run: (w) => w.ops.keepGlobal(m.name, false) }
      : { label: "Keep it global on purpose", preview: `Mark ${m.name} as global on purpose: it no longer shows as Not reviewed. Its other issues stay.`, run: (w) => w.ops.keepGlobal(m.name, true) },
    { label: "Delete it", preview: `Remove ${m.where}/${m.name}. A backup is kept in Settings › Backups.`, run: (w) => w.ops.deleteGlobal(m) },
  ];
}

/**
 * Moving a library skill's pin between the repo's skilllib.json and your personal pins, when that can succeed: its
 * version is in your library, and (to make it personal) git doesn't have its copy or links, since excluding them wouldn't
 * take it out of git.
 */
export function pinFix(w: World, repo: string, s: LocalSkill): Fix | null {
  // Its version in your library, its copy not edited, and a repo's top folder to be personal in: else the move would fail.
  if (s.source !== "lib" || !s.pinMoves || !w.library.some((l) => l.name === s.name)) return null;
  if (s.personal)
    return { label: "Pin it for the team", preview: `Move ${s.name}'s pin into ${repo}'s skilllib.json. Git will see skilllib.json and ${s.dir}/${s.name}: commit them to share it.`, run: (w) => w.ops.pin(repo, s.name, false) };
  if (s.inGit || isShared(s.git)) return null;
  return {
    label: "Make it personal",
    preview: `Move ${s.name}'s pin out of ${repo}'s skilllib.json into your personal pins, and keep its copy out of git.${
      project(w, repo).manifest === "committed" ? " Git will see skilllib.json change: once that's committed, teammates no longer get it." : ""
    }`,
    run: (w) => w.ops.pin(repo, s.name, true),
  };
}

/**
 * What Global offers for a skill beyond its issues. Everything acts on the machine-wide copy;
 * the only thing that reaches repos is "Move it to the repos…", and only the repos you tick.
 */
export function machineActions(m: MachineSkill): Fix[] {
  if (m.broken) return []; // its issue already offers "Remove the link"
  return m.source === "global" ? globalFixes(m) : m.source === "skilllib" ? [removeAgentSkillFix()] : [];
}

/** Installs or refreshes the skilllib skill for every agent you use. */
export function agentSkillFix(w: World): Fix {
  return {
    label: w.agentSkill === "outdated" ? "Update the skilllib skill" : "Install the skilllib skill for your agents",
    preview:
      "One global skill, skilllib, where your agents look in every repo (~/.claude/skills, and ~/.agents/skills for Codex and Zed). Then ask your agents which skills they can use here, where each comes from, and which of your skills a repo should add. `skilllib agent-skill remove` takes it out.",
    run: (w) => w.ops.installAgentSkill(),
  };
}

/** Takes the skilllib skill out of your global folders (`skilllib agent-skill remove`). */
function removeAgentSkillFix(): Fix {
  return {
    label: "Remove the skilllib skill",
    preview:
      "Removes it from ~/.claude/skills and ~/.agents/skills, where skilllib put it. Your agents then stop using skilllib to answer which skills they can use. Settings › skilllib skill puts it back.",
    run: (w) => w.ops.removeAgentSkill(),
  };
}

/** "Fix all": runs doctor's fixes (never a decision) and says how many applied, and which failed and why. */
export function runAll(w: World, fixes: Fix[]): Result {
  const bad = fixes.map((fix) => fix.run(w)).filter(isFailure).map(said);
  const ok = fixes.length - bad.length;
  const message = [
    `Applied ${ok}${ok === fixes.length ? "" : ` of ${fixes.length}`} fix${fixes.length === 1 ? "" : "es"}${ok ? " (anything removed is in Settings › Backups)" : ""}`,
    bad.length ? `couldn't: ${bad.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return bad.length ? failed(message) : message;
}

export function worst(issues: Issue[]): Issue | undefined {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
}

export function tally(issues: Issue[]): Record<Severity, number> {
  return {
    problem: issues.filter((i) => i.severity === "problem").length,
    suggestion: issues.filter((i) => i.severity === "suggestion").length,
  };
}

/**
 * Deleting library skills: which repos lose them, said plainly before you confirm.
 * Untracked copies and the repo's own aren't the library's, so they stay.
 */
export function deleteLibraryFix(w: World, names: string[]): Fix {
  const tracked = w.projects.flatMap((p) => p.skills.filter((s) => names.includes(s.name) && s.source === "lib").map((s) => ({ repo: p.name, edited: s.edited })));
  const repos = [...new Set(tracked.map((t) => t.repo))];
  const edited = [...new Set(tracked.filter((t) => t.edited).map((t) => t.repo))];
  const others = [...new Set(w.projects.filter((p) => p.skills.some((s) => names.includes(s.name) && s.source !== "lib")).map((p) => p.name))];
  const what = names.length === 1 ? names[0]! : `these ${names.length} skills`;
  return {
    label: `Delete ${names.length === 1 ? "" : `all ${names.length} `}from your library${repos.length ? ` and ${repos.length} repo${repos.length === 1 ? "" : "s"}…` : ""}`,
    preview: [
      `Delete ${what} and ${names.length === 1 ? "its" : "their"} versions from your library.`,
      repos.length ? `Removes ${names.length === 1 ? "it" : "them"} from ${repos.length === 1 ? repos[0] : `these ${repos.length} repos: ${repos.join(", ")}`}.` : "No repo uses it.",
      edited.length ? `${edited.join(", ")} ${edited.length === 1 ? "has" : "have"} local edits: backed up too.` : "",
      "Every copy goes to Settings › Backups; where a repo commits its copy, git will see it.",
      others.length ? `Untracked or the team's own copies in ${others.join(", ")} stay.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    run: (w) => joined(names.map((n) => w.ops.deleteLibrary(n))),
  };
}

// ─── Plugins ────────────────────────────────────────────

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** A plugin's name without its marketplace. */
export function pluginName(p: Plugin): string {
  return p.id.split("@")[0]!;
}

/** Claude Code records a plugin's skill as "plugin:skill"; your own skill by that name is counted apart. */
export function pluginSkillKey(p: Plugin, skill: string): string {
  return `${pluginName(p)}:${skill}`;
}

/** Claude Code uses of a plugin's skills in the last 30 days, in one repo or everywhere. */
export function pluginUses(w: World, p: Plugin, repo?: string): number {
  return p.skills.reduce((n, s) => n + (repo ? (w.usage[repo]?.[pluginSkillKey(p, s.name)] ?? 0) : totalUses(w, pluginSkillKey(p, s.name))), 0);
}

/** Where a plugin is installed, in a few words: "user", "project web-app", "claude.ai". */
export function pluginScope(p: Plugin): string {
  return p.repo ? `${p.scope} ${p.repo}` : p.scope;
}

/**
 * A plugin can't be half removed: replacing it means copying all its skills into your library,
 * adding them where you pick, and uninstalling the whole plugin (with whatever else it brings).
 */
export function replacePluginFix(p: Plugin): Fix {
  const names = p.skills.map((s) => s.name);
  // Marketplace plugins can be uninstalled; ones synced from claude.ai ("name@synced"), or only turned on
  // in your settings (not installed), are only turned off.
  const synced = p.scope === "claude.ai";
  const offOnly = synced || !!p.settingsOnly;
  return {
    label: `Replace ${pluginName(p)} with library skills…`,
    preview: [
      `Copies its ${plural(names.length, "skill")} into your library and adds them to the repos you tick (or none),`,
      synced
        ? `then turns ${p.id} off in Claude Code. It's synced from your claude.ai account: to delete it for good, remove it there.`
        : p.settingsOnly
          ? `then turns ${p.id} off in ~/.claude/settings.json. It isn't installed, only turned on there, so there's nothing to uninstall.`
          : `then uninstalls ${p.id}${p.repo ? ` from ${p.repo}` : ""} (its saved data is kept).`,
      p.parts.length ? `It also brings ${p.parts.join(", ")}: those ${offOnly ? "stop" : "go"} too.` : "",
      // A plugin only turned on in settings isn't listed in Plugins once it's off: say where it comes back.
      offOnly ? (p.settingsOnly ? "Turn it back on with /plugin in Claude Code." : "Turn it back on from Plugins.") : "Settings › Backups reinstalls it.",
    ]
      .filter(Boolean)
      .join(" "),
    run: () => "",
    allowNone: true,
    preticked: (w) => w.projects.filter((x) => pluginUses(w, p, x.name) > 0).map((x) => x.name),
    pickRepos: (w, repos) => w.ops.replacePlugin(p, repos),
  };
}

/** Turning a Claude Code plugin on or off where it's installed. */
export function pluginSwitchFix(p: Plugin, on: boolean): Fix {
  const where = p.repo ? ` in ${p.repo} (${p.scope} install)` : p.scope === "claude.ai" ? " on this machine" : " in every repo";
  return {
    // doctor's wording, so the details list it once when an issue offers it too.
    label: `Turn the plugin ${p.id} ${on ? "on" : "off"}`,
    preview: `Turns ${p.id} ${on ? "on" : "off"}${where}${p.parts.length ? `, with its ${p.parts.join(", ")}` : ""}. ${
      p.scope === "claude.ai" || p.settingsOnly
        ? `Sets "${p.id}": ${on} in Claude Code's settings.`
        : `Runs claude plugin ${on ? "enable" : "disable"} ${p.id} --scope ${p.scope}${p.repo ? ` in ${p.repo}` : ""} (without the claude command, sets it in Claude Code's settings).`
    } Claude Code picks it up in its next session.`,
    run: (w) => w.ops.setPlugin(p, on),
  };
}

export function uninstallPluginFix(p: Plugin): Fix {
  return {
    label: `Uninstall the plugin ${p.id}`,
    preview: `Runs claude plugin uninstall ${p.id} --keep-data --scope ${p.scope}${p.repo ? ` in ${p.repo}` : ""}: its ${[plural(p.skills.length, "skill"), ...p.parts].join(", ")} go, its saved data stays. Settings › Backups reinstalls it.`,
    run: (w) => w.ops.uninstallPlugin(p),
  };
}

export function updatePluginFix(p: Plugin): Fix {
  return {
    label: p.update === "newer" ? "Update it" : `Update to ${p.update}`,
    preview: `Runs claude plugin update ${p.id}${p.repo ? ` in ${p.repo}` : ""}. Updates can bring new commands, hooks or MCP servers. If the marketplace asks to run a command, skilllib stops and you update it yourself. Claude Code uses the new version after a restart.`,
    run: (w) => w.ops.updatePlugin(p),
  };
}

// ─── Groups ─────────────────────────────────────────────

/** A group a skill might belong to; `label` is what its row says. */
export type GroupKey = { key: string; label: string };

/** Where a library skill came from, as a group, when that says anything ("global folder" doesn't). */
function originGroup(origin: string | undefined): GroupKey | null {
  if (!origin) return null;
  const plugin = origin.match(/^plugin: (.+)$/);
  if (plugin) return { key: `plugin:${plugin[1]}`, label: `⧉ ${plugin[1]!.split("@")[0]} plugin` };
  const source = origin.match(/^(?:skills\.sh|npx skills): (.+)$/);
  if (source) return { key: `src:${source[1]}`, label: source[1]! };
  const group = origin.match(/^group: (.+)$/);
  if (group) return { key: `group:${group[1]}`, label: group[1]! };
  const repo = origin.match(/^project: (.+)$/);
  if (repo) return { key: `repo:${repo[1]}`, label: `from ${repo[1]}` };
  return null;
}

const word = (name: string) => name.split(/[-_.]/)[0]!;

/** A library skill's origin. A plugin's namesake (ponytail of ponytail@…) imported without one shares its siblings'. */
function libraryOrigin(w: World, l: LibrarySkill | undefined): string | undefined {
  return l && (l.origin ?? w.library.find((x) => x.origin?.match(/^plugin: ([^@]+)@/)?.[1] === l.name)?.origin);
}

/**
 * Groups a skill could be in, strongest signal first: where it came from (a plugin, an
 * `npx skills` repo, claude.ai, Cursor), then when it arrived (folders created the same
 * minute), then its name's first word, within one source. assignGroups picks one.
 */
export function groupCandidates(w: World, u: Usable | LibrarySkill): GroupKey[] {
  const byTime = (family: string, installed?: string): GroupKey[] => (installed ? [{ key: `time:${family}:${installed}`, label: `installed together ${installed.slice(0, 10)}` }] : []);
  const byWord = (family: string, name: string): GroupKey[] => (word(name).length >= 3 ? [{ key: `word:${family}:${word(name)}`, label: `${word(name)}-*` }] : []);
  // Library folders are created when skilllib imports them, often many at once: their time says nothing.
  if (!("source" in u)) {
    const origin = originGroup(libraryOrigin(w, u));
    return [...(origin ? [origin] : []), ...byWord("library", u.name)];
  }
  const m = u.machine;
  if (m?.source === "plugin") return [{ key: `plugin:${m.where}`, label: `⧉ ${m.where.split("@")[0]} plugin` }];
  if (m?.source === "claude.ai") return [{ key: "claude.ai", label: "claude.ai skills" }];
  if (m?.source === "cursor") return [{ key: "cursor", label: "Cursor built-ins" }];
  if (m?.source === "grok") return [{ key: "grok", label: "Grok bundled" }];
  if (m?.source === "system") return [{ key: `system:${m.where}`, label: m.where }];
  if (m?.source === "skilllib") return [];
  if (m) {
    const origin = originGroup(m.origin);
    return [...(origin ? [origin] : []), ...byTime("global", m.installed), ...byWord("global", m.name)];
  }
  if (u.local?.source === "lib") {
    const origin = originGroup(libraryOrigin(w, w.library.find((x) => x.name === u.name)));
    return [...(origin ? [origin] : []), ...byWord("local", u.name)];
  }
  return byWord("local", u.name);
}

/**
 * Picks each skill's group: its strongest candidate that at least one other skill shares.
 * Groups left with a single member are dropped (that skill stays on its own).
 */
export function assignGroups(candidates: GroupKey[][]): (GroupKey | undefined)[] {
  const count = new Map<string, number>();
  for (const c of candidates) for (const k of c) count.set(k.key, (count.get(k.key) ?? 0) + 1);
  const picked = candidates.map((c) => c.find((k) => count.get(k.key)! >= 2));
  const size = new Map<string, number>();
  for (const p of picked) if (p) size.set(p.key, (size.get(p.key) ?? 0) + 1);
  return picked.map((p) => (p && size.get(p.key)! >= 2 ? p : undefined));
}

/** A time group's label: its most common first word, e.g. "cloudflare + 12 more · installed together 2026-09-25". */
export function groupLabel(g: GroupKey, names: string[]): string {
  if (!g.key.startsWith("time:")) return g.label;
  const counts = new Map<string, number>();
  for (const n of names) counts.set(word(n), (counts.get(word(n)) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  return `${top} + ${names.length - 1} more · ${g.label}`;
}

// ─── Adding skills ──────────────────────────────────────

/** Substring, or word initials ("cfw" → cloudflare-workers): the TUI's search. */
export function matches(name: string, query: string): boolean {
  if (!query) return true;
  const text = name.toLowerCase();
  const q = query.toLowerCase();
  if (text.includes(q)) return true;
  const initials = text.split(/[-_\s./]+/).filter(Boolean).map((w) => w[0]).join("");
  return q.length >= 2 && initials.startsWith(q);
}

/** One row of the add box: a group title, a library skill, or a way to make a new one. */
export type AddRow = {
  key: string;
  header?: string;
  name: string;
  note: string;
  description: string;
  create?: boolean;
  /** Hands the writing to an agent; changes nothing here. */
  agent?: boolean;
  /** Library skills this row adds (one, or a group's when more): what space ticks. */
  members?: string[];
  /** A member shown under its group's row. */
  inGroup?: boolean;
  run?: (w: World) => Result;
  /** Runs once the new skill's SKILL.md has been edited: installing it then puts in what you wrote, not the template. */
  afterEdit?: (w: World) => Result;
};

/**
 * The add box for `target` (a repo, or your library when null): library skills the repo
 * doesn't have yet, related ones under a row that adds them all (a plugin's skills, say),
 * then "create" and "write with an agent" for the name you typed.
 */
export function addRows(w: World, target: string | null, q: string): AddRow[] {
  // A global or plugin copy doesn't block adding the library version: that's how a skill moves into the repo.
  const taken = new Set(target ? project(w, target).skills.map((s) => s.name) : []);
  const loaded = new Set(target ? usable(w, target).map((u) => u.name) : []);
  const hit = (name: string, description: string) => !q || matches(name, q) || (q.length >= 3 && description.toLowerCase().includes(q));
  // Grouped over the whole library, so a group doesn't change as you type or as the repo gets some of it.
  // No repo picked: only the rows that create a skill, so there's nothing to group.
  const groups = target ? assignGroups(w.library.map((l) => groupCandidates(w, l))) : [];
  const shown = target ? w.library.map((l, i) => ({ l, g: groups[i] })).filter(({ l }) => !taken.has(l.name) && hit(l.name, w.descriptions[l.name] ?? "")) : [];
  const skillRow = (l: LibrarySkill, inGroup: boolean): AddRow => ({
    key: `lib:${l.name}`,
    name: l.name,
    note: `v${l.latest}`,
    description: w.descriptions[l.name] ?? "",
    members: [l.name],
    ...(inGroup ? { inGroup } : {}),
    run: (w) => w.ops.add(target!, l.name),
  });
  const library: AddRow[] = [];
  const done = new Set<string>();
  for (const { l, g } of shown) {
    if (done.has(l.name)) continue;
    const members = g ? shown.filter((x) => x.g?.key === g.key).map((x) => x.l) : [l];
    members.forEach((m) => done.add(m.name));
    if (members.length < 2) {
      library.push(skillRow(l, false));
      continue;
    }
    const names = members.map((m) => m.name);
    library.push(
      { key: `group:${g!.key}`, name: groupLabel(g!, names), note: `${names.length} skills`, description: names.join(", "), members: names, run: (w) => w.ops.addTo([target!], names) },
      ...members.map((m) => skillRow(m, true)),
    );
  }
  const exists = q !== "" && (loaded.has(q) || w.library.some((l) => l.name === q));
  const where = target ? ` for ${target}` : "";
  const fresh: AddRow[] = exists
    ? []
    : [
        {
          key: "create",
          create: true,
          name: q ? `+ Create "${q}"${where}` : "+ Create a new skill (type its name)",
          note: "",
          description: "",
          run: (w) => w.ops.createSkill(q),
          ...(target ? { afterEdit: (w: World) => w.ops.add(target, q) } : {}),
        },
        { key: "agent", agent: true, name: q ? `✦ Write "${q}" with an agent` : "✦ Write a new skill with an agent", note: "", description: "" },
      ];
  const group = (title: string, rows: AddRow[]): AddRow[] => (rows.length ? [{ key: `#${title}`, header: title, name: "", note: "", description: "" }, ...rows] : []);
  return [...group("Your library", library), ...group("New", fresh)];
}
