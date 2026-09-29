/**
 * The TUI's model: your repos, your library and what loads everywhere, as plain data, plus the
 * issues and fixes derived from them. Fixes act through `w.ops`: the real disk (load.ts), or
 * in-memory sample data (sample.ts) for tests and headless checks.
 */
import type { GitState } from "../git.js";
import { harness, type HarnessId } from "../harnesses.js";
import { matchScore } from "../search.js";

export type Source = "lib" | "repo" | "untracked" | "global" | "plugin" | "claude.ai" | "cursor";
export type Filter = "all" | "local" | "global" | "plugins" | "vendor";

export type LocalSkill = {
  name: string;
  /** lib: tracked in skilllib.json · repo: the team's, in .agents/skills · untracked: only on this machine. */
  source: "lib" | "repo" | "untracked";
  /** Project folder holding the real copy, e.g. ".claude/skills". */
  dir: string;
  path: string;
  /** Your agents that load it here. */
  agents: HarnessId[];
  /** Installed version, for tracked skills. */
  version?: number;
  edited?: boolean;
  missing?: boolean;
  /** How it compares with your library: the same, different, or not there (tracked but deleted from it). */
  library?: "same" | "differs" | "missing";
  /** Its git state; null when the repo isn't a git repo. */
  git: GitState | null;
};

export type MachineSkill = {
  name: string;
  source: "global" | "plugin" | "claude.ai" | "cursor";
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
  /** For plugin skills: what else the plugin brings, e.g. ["commands", "hooks"]. */
  pluginParts?: string[];
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
};

export type RepoInfo = { remote?: string; branch?: string; dirty: number };
export type Backup = { name: string; from: string; at: string };

/** What a fix did; `then` asks for one more confirmation (e.g. linking into a folder git tracks). */
export type Result = string | { message: string; then: Fix };

/** Everything that changes something, and a few lookups too slow to do for every repo up front. */
export type Ops = {
  add(repo: string, name: string): Result;
  remove(repo: string, name: string): Result;
  /** Reinstall a tracked skill whose folder is missing. */
  restore(repo: string, name: string): Result;
  update(repo: string, name: string): Result;
  /** Local edits become a new library version. */
  saveEdits(repo: string, name: string): Result;
  /** Back to the library's copy of the recorded (or newest) version. */
  discardEdits(repo: string, name: string): Result;
  /** Links so every agent you use loads it. */
  link(repo: string, name: string, allowTracked?: boolean): Result;
  track(repo: string, name: string): Result;
  /** An untracked copy into your library, then tracked here. */
  importLocal(repo: string, name: string): Result;
  /** This repo's copy into your library (new skill, or a new version); the repo's copy stays. */
  copyToLibrary(repo: string, name: string): Result;
  unloadGlobal(m: MachineSkill): Result;
  deleteGlobal(m: MachineSkill): Result;
  keepGlobal(name: string, keep: boolean): Result;
  /** `group`: the group it moved with, recorded as its origin so it stays grouped in your library. */
  moveGlobal(m: MachineSkill, repos: string[], group?: string): Result;
  createSkill(name: string): Result;
  /** A plugin's skills into your library (and these repos), then the plugin uninstalled from Claude Code. */
  replacePlugin(id: string, repos: string[]): Result;
  /** Deletes a library skill, first removing it from every repo that tracks it (each copy backed up). */
  deleteLibrary(name: string): Result;
  restoreBackup(index: number): Result;
  setAgents(ids: HarnessId[]): Result;
  repoInfo(repo: string): RepoInfo;
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
};

export type World = {
  agents: HarnessId[];
  /** The repo you started in, if any. */
  cwd: string | null;
  projects: Project[];
  machine: MachineSkill[];
  library: LibrarySkill[];
  /** Uses in the last 30 days, per repo, per skill. */
  usage: Record<string, Record<string, number>>;
  /** The same per day (index 29 = today); absent until the transcripts are read. */
  days?: Record<string, Record<string, number[]>>;
  descriptions: Record<string, string>;
  backups: Backup[];
  /** Folders scanned for repos, and repos you hid from the list. */
  roots: string[];
  hidden: string[];
  /** You've picked your agents (otherwise the first run asks). */
  agentsChosen: boolean;
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

export type Severity = "problem" | "warning" | "hint";
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
export type Issue = {
  id: string;
  severity: Severity;
  title: string;
  /** The same, in a few words, for the list; the details show `title`. */
  short: string;
  /** Decisions never run from "fix all"; the first fix of an automatic issue is the recommended one. */
  decision: boolean;
  fixes: Fix[];
};

export const SEVERITY_RANK: Record<Severity, number> = { problem: 0, warning: 1, hint: 2 };

export function filterOf(source: Source): Exclude<Filter, "all"> {
  return source === "lib" || source === "repo" || source === "untracked" ? "local" : source === "global" ? "global" : source === "plugin" ? "plugins" : "vendor";
}

export function project(w: World, name: string): Project {
  return w.projects.find((p) => p.name === name)!;
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

/** Everything agents can use in a project: its own skills plus what loads everywhere. */
export function usable(w: World, projectName: string): Usable[] {
  const p = project(w, projectName);
  const uses = (n: string) => w.usage[projectName]?.[n] ?? 0;
  return [
    ...p.skills.map((s): Usable => ({ name: s.name, source: s.source, where: s.dir, agents: s.agents, uses: uses(s.name), local: s })),
    ...w.machine.map((m): Usable => ({ name: m.name, source: m.source, where: m.where, agents: m.agents, uses: uses(m.name), machine: m })),
  ];
}

function lib(w: World, name: string): LibrarySkill | undefined {
  return w.library.find((l) => l.name === name);
}

// ─── Health ─────────────────────────────────────────────

/** What you can do with one of your global skills. */
export function globalFixes(m: MachineSkill): Fix[] {
  return [
    {
      label: "Move it to the repos that need it…",
      preview: `Pick repos. ${m.name} goes into your library and those repos, and stops loading globally (original backed up).`,
      run: () => "",
      pickRepos: (w, repos) => w.ops.moveGlobal(m, repos),
    },
    m.kept
      ? { label: "Stop marking it as global on purpose", preview: `skilllib warns about ${m.name} again, like any global skill.`, run: (w) => w.ops.keepGlobal(m.name, false) }
      : { label: "Keep it global on purpose", preview: `Mark ${m.name} as global on purpose. skilllib stops warning about it.`, run: (w) => w.ops.keepGlobal(m.name, true) },
    { label: "Delete it", preview: `Remove ${m.path}. A backup is kept in Settings › Backups.`, run: (w) => w.ops.deleteGlobal(m) },
  ];
}

/**
 * What Global offers for a skill beyond its issues. Everything acts on the machine-wide copy;
 * the only thing that reaches repos is "Move it to the repos…", and only the repos you tick.
 */
export function machineActions(m: MachineSkill): Fix[] {
  if (m.broken) return []; // its issue already offers "Remove the link"
  return m.source === "global" ? globalFixes(m) : [];
}

/** Issues on skills that load everywhere, independent of any project. */
export function machineIssues(w: World, m: MachineSkill): Issue[] {
  if (m.broken)
    return [
      {
        id: `broken:${m.path}`,
        severity: "problem",
        title: "Broken link: points at a folder that no longer exists",
        short: "Broken link",
        decision: false,
        fixes: [{ label: "Remove the link", preview: `Remove ${m.path}.`, run: (w) => w.ops.deleteGlobal(m) }],
      },
    ];
  const issues: Issue[] = [];
  // Loaded twice: another copy one of the same agents loads.
  const other = w.machine.find((x) => x !== m && x.name === m.name && !x.broken && x.agents.some((a) => m.agents.includes(a)));
  if (m.source === "global" && other && other.source !== "global")
    issues.push({
      id: `dup-plugin:${m.name}`,
      severity: "problem",
      title: `Loaded twice: also in ${other.source} ${other.where}`,
      short: "Loaded twice",
      decision: false,
      fixes: [
        {
          label: `Keep the ${other.source}'s copy, stop loading yours globally`,
          preview: `Copy ${m.name} into your library if needed, then move ${m.path} to the backups.`,
          run: (w) => w.ops.unloadGlobal(m),
        },
      ],
    });
  // Two of your own folders with the same skill, both loaded by one agent: keep one.
  const twins = w.machine.filter((x) => x.source === "global" && x.name === m.name && !x.broken && x.agents.some((a) => m.agents.includes(a)));
  if (m.source === "global" && twins.length > 1)
    issues.push({
      id: `dup-global:${m.name}`,
      severity: "problem",
      title: `Loaded twice: in ${twins.map((t) => t.where).join(" and ")}`,
      short: "Loaded twice",
      decision: true,
      fixes: twins.map((t) => ({ label: `Delete the copy in ${t.where}`, preview: `Move ${t.path} to Settings › Backups; the other copy stays.`, run: (w: World) => w.ops.deleteGlobal(t) })),
    });
  if (m.source === "global" && !m.kept)
    issues.push({ id: `global:${m.name}`, severity: "warning", title: "Global, not reviewed: loads in every repo", short: "Not reviewed", decision: true, fixes: globalFixes(m) });
  return issues;
}

/** Issues of a repo's own copy of a skill; what loads everywhere is Global's (see machineIssues). */
export function issuesOf(w: World, projectName: string, u: Usable): Issue[] {
  const s = u.local!;
  const issues: Issue[] = [];
  const shares = (m: MachineSkill) => m.name === s.name && !m.broken && m.agents.some((a) => s.agents.includes(a));
  const g = w.machine.find((m) => m.source === "global" && shares(m));
  const vendor = w.machine.find((m) => m.source !== "global" && shares(m));
  const l = lib(w, s.name);
  const remove: Fix = {
    label: "Remove this repo's copy",
    preview: s.source === "lib" ? `Delete ${s.dir}/${s.name} in ${projectName}. Your library keeps it.` : `Move ${s.dir}/${s.name} in ${projectName} to Settings › Backups.`,
    run: (w) => w.ops.remove(projectName, s.name),
  };

  if (s.missing)
    issues.push({
      id: `missing:${s.name}`,
      severity: "problem",
      title: "Listed in skilllib.json but the folder is missing",
      short: "Folder missing",
      decision: false,
      fixes: [{ label: "Restore it (sync)", preview: `Reinstall ${s.name} v${s.version} into ${s.dir}.`, run: (w) => w.ops.restore(projectName, s.name) }],
    });
  if (s.source === "lib" && s.library === "missing")
    issues.push({
      id: `not-in-lib:${s.name}`,
      severity: "problem",
      title: "Tracked here, but no longer in your library",
      short: "Not in your library",
      decision: false,
      fixes: [{ label: "Copy it back into your library", preview: `Copy this repo's ${s.name} into your library, so it can be restored and shared again.`, run: (w) => w.ops.copyToLibrary(projectName, s.name) }],
    });
  if (g)
    issues.push({
      id: `twice-g:${s.name}`,
      severity: "problem",
      title: `Loaded twice: also global in ${g.where}`,
      short: "Loaded twice",
      decision: false,
      fixes: [
        {
          label: "Keep this repo's copy, stop loading it globally",
          preview: `Copy ${s.name} into your library if needed, then move ${g.path} to the backups. Other repos stop seeing it.`,
          run: (w) => w.ops.unloadGlobal(g),
        },
        ...(s.source !== "repo" ? [{ ...remove, label: "Keep it global, remove it from this repo" }] : []),
      ],
    });
  if (vendor)
    issues.push({
      id: `twice-p:${s.name}`,
      severity: "problem",
      title: `Same name as a skill in ${vendor.source} ${vendor.where}`,
      short: `Same name as a ${vendor.source} skill`,
      decision: true,
      fixes: [
        ...(s.source !== "repo" ? [{ ...remove, label: `Remove this repo's copy, use the ${vendor.source}'s` }] : []),
        {
          label: vendor.source === "plugin" ? "Turn the plugin off with /plugin in Claude Code" : `Turn it off in ${vendor.where}`,
          preview: "skilllib can't turn it off for you yet.",
          run: () => `Turn ${vendor.where} off at its source; skilllib picks it up next time`,
        },
      ],
    });
  if (s.source === "lib" && s.edited)
    issues.push({
      id: `edited:${s.name}`,
      severity: "warning",
      title: `Edited here: differs from library v${s.version}`,
      short: "Edited here",
      decision: true,
      fixes: [
        { label: `Save as v${(l?.latest ?? 0) + 1} in your library`, preview: `Your library gets v${(l?.latest ?? 0) + 1} with these edits. Other repos can update to it.`, run: (w) => w.ops.saveEdits(projectName, s.name) },
        { label: "Discard the edits", preview: `Replace ${s.dir}/${s.name} with library v${s.version} (edits backed up).`, run: (w) => w.ops.discardEdits(projectName, s.name) },
      ],
    });
  if (s.source === "lib" && l && s.version! < l.latest && !s.edited && !s.missing)
    issues.push({
      id: `outdated:${s.name}`,
      severity: "warning",
      title: `Update available: v${s.version} → v${l.latest}`,
      short: `Update to v${l.latest}`,
      decision: false,
      fixes: [{ label: `Update to v${l.latest}`, preview: `Replace ${s.dir}/${s.name} with library v${l.latest}.`, run: (w) => w.ops.update(projectName, s.name) }],
    });
  const blind = w.agents.filter((a) => !u.agents.includes(a));
  if (!s.missing && blind.length)
    issues.push({
      id: `blind:${s.name}`,
      severity: "warning",
      title: `${blind.map((a) => harness(a).name).join(", ")} can't see it`,
      short: `${blind.map((a) => harness(a).name).join(", ")} can't see it`,
      decision: false,
      fixes: [
        {
          label: "Link it for every agent",
          preview: `Add links (nothing is copied or moved), so ${blind.map((a) => harness(a).name).join(", ")} load it too.`,
          run: (w) => w.ops.link(projectName, s.name),
        },
      ],
    });
  if (s.source !== "lib" && s.library === "differs")
    issues.push({
      id: `differs:${s.name}`,
      severity: "hint",
      title: "Differs from the copy in your library",
      short: "Differs from library",
      decision: true,
      fixes: [
        { label: "Update your library from this copy", preview: `Your library gets a new version of ${s.name} with this repo's content.`, run: (w) => w.ops.copyToLibrary(projectName, s.name) },
        ...(s.source === "untracked"
          ? [{ label: "Replace it with the library version", preview: `Replace ${s.dir}/${s.name} with your library's newest version and track it (this copy backed up).`, run: (w: World) => w.ops.discardEdits(projectName, s.name) }]
          : []),
      ],
    });
  if (s.source === "untracked" && s.library === "same")
    issues.push({
      id: `adopt:${s.name}`,
      severity: "hint",
      title: "Same as your library skill, but not tracked",
      short: "Not tracked",
      decision: false,
      fixes: [{ label: "Track it", preview: `Record ${s.name} in skilllib.json so library updates reach it.`, run: (w) => w.ops.track(projectName, s.name) }],
    });
  if (s.source === "untracked" && !l && !vendor)
    issues.push({
      id: `local:${s.name}`,
      severity: "hint",
      title: "Only exists in this repo",
      short: "Only in this repo",
      decision: false,
      fixes: [
        {
          label: "Import it into your library",
          preview: `Copy ${s.name} into your library and track it here, so other repos can use it.`,
          run: (w) => w.ops.importLocal(projectName, s.name),
        },
      ],
    });
  if (s.source === "lib" && w.days && u.uses === 0 && !s.missing)
    issues.push({
      id: `unused:${s.name}`,
      severity: "hint",
      title: "Not used here in 30 days (Claude Code)",
      short: "Unused 30 days",
      decision: true,
      fixes: [{ ...remove, label: "Remove it from this repo", preview: `Delete ${s.dir}/${s.name} in ${projectName}. Your library keeps it.` }],
    });
  return issues;
}

export function worst(issues: Issue[]): Issue | undefined {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
}

export function tally(issues: Issue[]): Record<Severity, number> {
  return {
    problem: issues.filter((i) => i.severity === "problem").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    hint: issues.filter((i) => i.severity === "hint").length,
  };
}

/** A repo's own issues, per skill. */
export function projectIssues(w: World, projectName: string): { skill: Usable; issue: Issue }[] {
  return usable(w, projectName)
    .filter((u) => u.local)
    .flatMap((u) => issuesOf(w, projectName, u).map((issue) => ({ skill: u, issue })));
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
      repos.length ? `Removes ${names.length === 1 ? "it" : "them"} from ${repos.length === 1 ? "this repo" : `these ${repos.length} repos`}: ${repos.join(", ")}.` : "No repo uses it.",
      edited.length ? `${edited.join(", ")} ${edited.length === 1 ? "has" : "have"} local edits: backed up too.` : "",
      "Every copy goes to Settings › Backups.",
      others.length ? `Untracked or the team's own copies in ${others.join(", ")} stay.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    run: (w) =>
      names
        .map((n) => w.ops.deleteLibrary(n))
        .map((r) => (typeof r === "string" ? r : r.message))
        .join(" · "),
  };
}

/**
 * A plugin can't be half removed: replacing it means copying all its skills into your library,
 * adding them where you pick, and uninstalling the whole plugin (with whatever else it brings).
 */
export function replacePluginFix(w: World, id: string): Fix {
  const skills = w.machine.filter((m) => m.source === "plugin" && m.where === id);
  const names = skills.map((m) => m.name);
  const parts = skills[0]?.pluginParts ?? [];
  // Marketplace plugins can be uninstalled; ones synced from claude.ai ("name@synced") only turned off here.
  const synced = id.endsWith("@synced");
  return {
    label: `Replace ${id.split("@")[0]} with library skills…`,
    preview: [
      `Copies its ${skills.length} skill${skills.length === 1 ? "" : "s"} into your library and adds them to the repos you tick (or none),`,
      synced
        ? `then turns ${id} off in Claude Code. It's synced from your claude.ai account: to delete it for good, remove it there.`
        : `then uninstalls ${id} from Claude Code (its saved data is kept).`,
      parts.length ? `It also brings ${parts.join(", ")}: those ${synced ? "stop" : "go"} too.` : "",
      synced ? "Turn it back on with /plugin." : "Reinstall it anytime with /plugin.",
    ]
      .filter(Boolean)
      .join(" "),
    run: () => "",
    allowNone: true,
    preticked: (w) => w.projects.filter((p) => names.some((n) => (w.usage[p.name]?.[n] ?? 0) > 0)).map((p) => p.name),
    pickRepos: (w, repos) => w.ops.replacePlugin(id, repos),
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
    const origin = originGroup(u.origin);
    return [...(origin ? [origin] : []), ...byWord("library", u.name)];
  }
  const m = u.machine;
  if (m?.source === "plugin") return [{ key: `plugin:${m.where}`, label: `⧉ ${m.where.split("@")[0]} plugin` }];
  if (m?.source === "claude.ai") return [{ key: "claude.ai", label: "claude.ai skills" }];
  if (m?.source === "cursor") return [{ key: "cursor", label: "Cursor built-ins" }];
  if (m) {
    const origin = originGroup(m.origin);
    return [...(origin ? [origin] : []), ...byTime("global", m.installed), ...byWord("global", m.name)];
  }
  if (u.local?.source === "lib") {
    const l = w.library.find((x) => x.name === u.name);
    const origin = originGroup(l?.origin);
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
  return matchScore(name, query) !== null;
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
  run?: (w: World) => Result;
};

/**
 * The add box for `target` (a repo, or your library when null): library skills the repo
 * doesn't have yet, then "create" and "write with an agent" for the name you typed.
 * Only the library for now; GitHub and skills.sh come later.
 */
export function addRows(w: World, target: string | null, q: string): AddRow[] {
  // A global or plugin copy doesn't block adding the library version: that's how a skill moves into the repo.
  const taken = new Set(target ? project(w, target).skills.map((s) => s.name) : []);
  const loaded = new Set(target ? usable(w, target).map((u) => u.name) : []);
  const hit = (name: string, description: string) => !q || matches(name, q) || (q.length >= 3 && description.toLowerCase().includes(q));
  const library: AddRow[] = target
    ? w.library
        .filter((l) => !taken.has(l.name) && hit(l.name, w.descriptions[l.name] ?? ""))
        .map((l) => ({ key: `lib:${l.name}`, name: l.name, note: `v${l.latest}`, description: w.descriptions[l.name] ?? "", run: (w) => w.ops.add(target, l.name) }))
    : [];
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
          run: (w) => {
            const made = w.ops.createSkill(q);
            return target ? w.ops.add(target, q) : made;
          },
        },
        { key: "agent", agent: true, name: q ? `✦ Write "${q}" with an agent` : "✦ Write a new skill with an agent", note: "", description: "" },
      ];
  const group = (title: string, rows: AddRow[]): AddRow[] => (rows.length ? [{ key: `#${title}`, header: title, name: "", note: "", description: "" }, ...rows] : []);
  return [...group("Your library", library), ...group("New", fresh)];
}
