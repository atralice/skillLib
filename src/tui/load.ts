/**
 * The TUI's World from disk: your repos, library and global skills, with ops that call
 * library.ts and config.ts. Usage comes separately (loadUsage): reading transcripts is slow.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { agentSkillState, installAgentSkill, removeAgentSkill } from "../agentSkill.js";
import { projectOfFactory } from "../commands.js";
import { addRoot, allowTrackedLinks, discoverProjects, enabledHarnesses, harnessesChosen, keptGlobal, readConfig, removeRoot, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "../config.js";
import { copyText } from "../review.js";
import { gitInfo, relativeTo, type GitInfo } from "../git.js";
import { addedAt } from "../health.js";
import {
  addSkill,
  createSkill,
  deleteGlobal,
  deleteLibrarySkill,
  importSkill,
  librarySkills,
  linkEverywhere,
  linkGlobal,
  listBackups,
  projectStatus,
  relinkDependency,
  removeSkill,
  librarySkillDir,
  projectsUsing,
  removeUntracked,
  restoreBackup,
  syncProject,
  unloadGlobal,
  updateProject,
  visibilityOf,
  type Backup,
  type Change,
  type LinkResult,
  type ProjectSkill,
} from "../library.js";
import { harness, type HarnessId } from "../harnesses.js";
import { PROJECT_SKILLS_DIR, userHome } from "../paths.js";
import { projectHere, readManifest } from "../project.js";
import { readSkillInfo } from "../skills.js";
import { claudeBinary, claudePlugins, cursorPluginSkills, pluginBackups, recordRemovedPlugin, restorePlugin, turnOffIn } from "../plugins.js";
import { libraryOrigins, machineSkills, recordOrigin, setPluginEnabled, skillsLoadedIn, type SourcedSkill } from "../sources.js";
import { applyTidy, copyLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type TidyReport } from "../tidy.js";
import { scanUsage } from "../usage.js";
import { forgetLatest, latestVersion, versionHistory } from "../versions.js";
import { failed, type Dupes, type Fix, type LocalSkill, type MachineSkill, type Ops, type Project, type RepoInfo, type Result, type World } from "./world.js";

/** Home-relative path for labels. */
export function tildify(p: string): string {
  const home = userHome();
  return (p.startsWith(home) ? "~" + p.slice(home.length) : p).replace(/\\/g, "/");
}

/** Folder names, with as many parent folders as it takes to tell repos apart (ops find repos by name). */
export function uniqueNames(roots: string[]): Map<string, string> {
  const tail = (r: string, n: number) => r.split(/[\\/]/).filter(Boolean).slice(-n).join("/");
  return new Map(
    roots.map((r) => {
      let n = 1;
      while (roots.some((o) => o !== r && tail(o, n) === tail(r, n)) && tail(r, n) !== tail(r, n + 1)) n++;
      return [r, tail(r, n)];
    }),
  );
}

function localSkill(root: string, s: ProjectSkill, git: ReturnType<typeof gitInfo>): LocalSkill {
  const managed: Partial<Record<ProjectSkill["state"], Partial<LocalSkill>>> = {
    ok: {},
    "update available": {},
    "edited locally": { edited: true },
    "edited locally, update available": { edited: true },
    // sync restores it from your library, unless the library doesn't have it (a teammate's skill, another library).
    "folder missing": { missing: true, ...(s.latest === null && { library: "missing" as const }) },
    "not in library": { library: "missing" },
  };
  const other: Partial<Record<ProjectSkill["state"], Partial<LocalSkill>>> = {
    "untracked copy of library skill": { source: "untracked", library: "same" },
    "untracked, differs from library": { source: "untracked", library: "differs" },
    "local only": { source: "untracked" },
    // Installed with `npx skills add` (the repo's skills-lock.json): not skilllib's, so not a library skill.
    "from npx skills": { source: "untracked" },
    "repo skill": { source: "repo" },
    "repo skill, in library": { source: "repo", library: "same" },
    "repo skill, differs from library": { source: "repo", library: "differs" },
  };
  const state = git ? git.of(relativeTo(root, s.path)) : null;
  // A copy git tracks is the team's wherever it lives (.claude/skills too), so it's never removed or replaced from here.
  const own = other[s.state]?.source === "untracked" && (state === "committed" || state === "changed") ? { source: "repo" as const } : {};
  // Agents only a link in a folder git tracks would reach, while git doesn't share the real copy: never linked (see linkEverywhere).
  const blind = s.state === "folder missing" ? [] : s.visibility.filter((v) => v.paths === 0).map((v) => v.id);
  const uncommitted = blind.length ? linkEverywhere(root, s.name, s.location, { dryRun: true }).uncommitted : [];
  const unshared = blind.filter((id) => uncommitted.includes(harness(id).projectDirs[0]!));
  return {
    name: s.name,
    source: "lib",
    dir: s.location,
    path: s.path,
    // Agents that actually load it here: visibility lists every agent you use, with `paths: 0` for the blind ones.
    agents: s.visibility.filter((v) => v.paths > 0).map((v) => v.id),
    ...(s.managed ? { library: "same" as const, version: s.version ?? undefined, ...managed[s.state] } : { ...other[s.state], ...own }),
    ...(unshared.length && { unshared }),
    ...(s.source ? { origin: `npx skills: ${s.source}` } : {}),
    added: addedAt(s.path),
    git: state,
  };
}

/** What a plugin ships besides skills, which turning it off stops too. Read once per plugin. */
const partsOf = new Map<string, string[]>();
function pluginParts(root: string): string[] {
  if (!partsOf.has(root))
    partsOf.set(
      root,
      [
        ["commands", "commands"],
        ["agents", "agents"],
        ["hooks", "hooks"],
        [".mcp.json", "MCP servers"],
      ].flatMap(([file, what]) => (existsSync(join(root, file!)) ? [what!] : [])),
    );
  return partsOf.get(root)!;
}

/** When a folder appeared, to the minute ("2026-09-25 20:55"). */
function installedAt(path: string): string | undefined {
  try {
    const st = lstatSync(path);
    const at = st.birthtimeMs > 0 ? st.birthtime : st.mtime;
    return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return undefined;
  }
}

function machineSkill(s: SourcedSkill, kept: Set<string>): MachineSkill {
  const global = s.kind === "global" || s.kind === "skills.sh";
  return {
    name: s.name,
    source: global ? "global" : s.kind === "plugin" ? "plugin" : s.kind === "claude.ai" ? "claude.ai" : s.kind === "system" ? "system" : s.kind === "skilllib" ? "skilllib" : "cursor",
    where: global || s.kind === "skilllib" ? tildify(dirname(s.path)) : s.kind === "claude.ai" ? "claude.ai account" : s.kind === "built-in" ? `${s.origin} built-in` : s.origin,
    ...(s.kind === "skills.sh" ? { origin: `npx skills: ${s.origin}` } : {}),
    path: s.path,
    links: s.links,
    agents: s.harnesses,
    ...(global && kept.has(s.name) ? { kept: true } : {}),
    ...(s.broken ? { broken: true } : {}),
    ...(global && s.kind !== "skills.sh" ? { installed: installedAt(s.path) } : {}),
    ...(s.kind === "plugin" ? { pluginParts: pluginParts(dirname(dirname(s.path))) } : {}),
  };
}

/** tidy.ts's plans and conflicts, per skill; `root` null for your global folders. */
function dupesOf(r: TidyReport, root: string | null, git: GitInfo | null = null): Map<string, Dupes> {
  const out = new Map<string, Dupes>();
  for (const p of r.plans) out.set(p.name, { steps: p.steps.map((s) => describeStep(s, root)), git: gitVisibleSteps(p, git).map((s) => describeStep(s, root)) });
  for (const c of r.conflicts)
    out.set(c.name, { steps: [], git: [], differ: c.copies.map((x) => ({ dir: x.dir, label: root ? copyLabel(c, x.dir) : tildify(x.dir), runs: x.runs, canWin: !c.managed || x.dir === c.managed })) });
  return out;
}

/** Everything on disk the screens show, except usage. */
export function loadWorld(): World {
  forgetLatest();
  const agents = enabledHarnesses();
  const here = projectHere();
  // The same repo can come as two paths (a symlinked folder, /var vs /private/var): match by real path.
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const visible = visibleProjects();
  const cwd = here ? (visible.find((p) => real(p) === real(here)) ?? here) : null;
  const roots = [...new Set([...(cwd ? [cwd] : []), ...visible])];
  const names = uniqueNames(roots);
  const descriptions: Record<string, string> = {};
  const origins = libraryOrigins();
  const library = librarySkills().map((s) => {
    descriptions[s.name] = s.description;
    return { name: s.name, latest: latestVersion(s.name)?.version ?? 1, origin: origins[s.name] };
  });
  const kept = keptGlobal();
  // Cursor plugins: reported only (Cursor's plugin state can't be read).
  const cursorPlugin = new Map(agents.includes("cursor") ? cursorPluginSkills().map((s) => [s.name, s.plugin]) : []);
  const globalDupes = dupesOf(planGlobalTidy({ enabled: agents }), null);
  const sourced = machineSkills(agents);
  const machine = sourced.map((s) => {
    descriptions[s.name] ??= s.description;
    const m = machineSkill(s, kept);
    if (m.source !== "global" || m.broken) return m;
    const dupes = globalDupes.get(m.name);
    const plugin = cursorPlugin.get(m.name);
    return { ...m, ...(dupes ? { dupes } : {}), ...(plugin ? { cursorPlugin: plugin } : {}) };
  });
  // A repo's Claude Code settings can turn a plugin on or off just there.
  const plugins = (root: string): Pick<Project, "machine"> => {
    const loaded = skillsLoadedIn(root, sourced, agents);
    if (loaded === sourced) return {};
    for (const s of loaded) descriptions[s.name] ??= s.description;
    return { machine: loaded.map((s) => machine[sourced.indexOf(s)] ?? machineSkill(s, kept)) };
  };
  const projects = roots.map((root): Project => {
    const status = projectStatus(root);
    const hasManifest = existsSync(join(root, "skilllib.json"));
    const git = status.length || hasManifest ? gitInfo(root) : null;
    for (const s of status) if (!descriptions[s.name] && !s.state.includes("missing")) descriptions[s.name] = readSkillInfo(s.path).description;
    const dupes = status.length ? dupesOf(planProjectTidy(root, { enabled: agents }), root, git) : new Map<string, Dupes>();
    return {
      name: names.get(root)!,
      path: root,
      manifest: hasManifest ? (git ? git.of("skilllib.json") : "no git") : "none",
      skills: status.map((s) => {
        const d = dupes.get(s.name);
        const plugin = cursorPlugin.get(s.name);
        return { ...localSkill(root, s, git), ...(d ? { dupes: d } : {}), ...(plugin ? { cursorPlugin: plugin } : {}) };
      }),
      ...plugins(root),
    };
  });
  const backups = [...listBackups(), ...pluginBackups()].sort((a, b) => b.movedAt.localeCompare(a.movedAt));
  return {
    agents,
    cwd: cwd ? names.get(cwd)! : null,
    projects,
    machine,
    library,
    usage: {},
    descriptions,
    backups: backups.map((b) => ({ name: b.name, from: tildify(b.from), at: b.movedAt })),
    roots: readConfig().roots,
    hidden: readConfig().hidden,
    agentsChosen: harnessesChosen(),
    agentSkill: agentSkillState(agents),
    ops: realOps(new Map(projects.map((p) => [p.name, p.path])), backups),
  };
}

/** Uses per repo and per day over the last 30 days, from Claude Code's transcripts. */
export async function loadUsage(w: World): Promise<Pick<World, "usage" | "days">> {
  const repoOf = new Map(w.projects.map((p) => [p.path, p.name]));
  const projectOf = projectOfFactory(w.projects.map((p) => p.path));
  const usage: World["usage"] = {};
  const days: NonNullable<World["days"]> = {};
  // Calendar days in local time (index 29 = today), so "today" and each bar mean a real day.
  const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const today = midnight(Date.now());
  for (const use of await scanUsage(30)) {
    const root = projectOf(use.cwd);
    const repo = root ? repoOf.get(root) : undefined;
    const day = 29 - Math.round((today - midnight(Date.parse(use.at))) / 86_400_000);
    if (!repo || day < 0 || day > 29) continue;
    (usage[repo] ??= {})[use.skill] = (usage[repo][use.skill] ?? 0) + 1;
    ((days[repo] ??= {})[use.skill] ??= new Array<number>(30).fill(0))[day]! += 1;
  }
  return { usage, days };
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** "git@github.com:me/app.git" or "https://github.com/me/app.git" → "github.com/me/app". */
function remoteLabel(url: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/^[a-z+]+:\/\//, "").replace(/^[^@/]+@/, "").replace(/:(?!\d)/, "/").replace(/\.git$/, "");
}

/** What a change did, in a few words. */
function said(c: Change, repo: string): string {
  if (c.action === "skipped") return `${c.name}: ${c.reason ?? "skipped"}`;
  if (c.action === "removed") return `Removed ${c.name} from ${repo}`;
  // An older version picked from Other versions… isn't an update.
  const back = c.action === "updated" && c.from !== undefined && c.to !== undefined && c.to < c.from;
  const done = back
    ? `Pinned ${c.name} to v${c.to} in ${repo} (was v${c.from})`
    : `${c.action === "installed" ? "Added" : c.action === "reset" ? "Reset" : "Updated"} ${c.name}${c.to ? ` v${c.to}` : ""} in ${repo}`;
  return c.backedUp ? `${done} (your edits are in Settings › Backups)` : done;
}

function realOps(roots: Map<string, string>, backups: Backup[]): Ops {
  const rootOf = (repo: string) => roots.get(repo)!;
  const find = (repo: string, name: string) => projectStatus(rootOf(repo)).find((s) => s.name === name);
  const info = new Map<string, RepoInfo>();

  /** A change; failed if it was skipped. */
  const result = (c: Change, repo: string): Result => (c.action === "skipped" ? failed(said(c, repo)) : said(c, repo));
  /** The folder holding a tracked skill's real copy in a repo. */
  const copyDir = (repo: string, name: string) => readManifest(rootOf(repo)).skills[name]?.dir ?? PROJECT_SKILLS_DIR;
  /**
   * A change, asking before adding links in folders git tracks. When git doesn't share the real copy,
   * a link would break for teammates: it says so instead of asking.
   */
  const withLinks = (c: Change, repo: string, name: string): Result => {
    const it = (dirs: string[]) => (dirs.length === 1 ? "it" : "them");
    if (c.uncommitted?.length)
      return `${said(c, repo)}; not linked in ${c.uncommitted.join(", ")}: git tracks ${it(c.uncommitted)} and ${copyDir(repo, name)}/${name} isn't committed, so teammates would get broken links`;
    if (!c.blocked?.length) return result(c, repo);
    return { message: `${said(c, repo)}; not linked in ${c.blocked.join(", ")}: git tracks ${it(c.blocked)}`, then: allowTracked([{ repo, name, blocked: c.blocked }]) };
  };
  /** Library skills into repos; links git-tracked folders held back are asked about once, for all of them. */
  const addTo = (repos: string[], names: string[]): Result => {
    if (repos.length === 1 && names.length === 1) return withLinks(addSkill(rootOf(repos[0]!), names[0]!), repos[0]!, names[0]!);
    const changes = repos.flatMap((repo) => names.map((name) => ({ repo, name, c: addSkill(rootOf(repo), name) })));
    const done = changes.filter((x) => x.c.action !== "skipped");
    const added = [...new Set(done.map((x) => x.name))];
    const summary = done.length ? `Added ${added.length === 1 ? `${added[0]} v${done[0]!.c.to}` : `${added.length} skills`} to ${[...new Set(done.map((x) => x.repo))].join(", ")}` : "";
    // Per repo, the links git held back: to ask about, or (git doesn't share the copy) only to say.
    const notes: string[] = [];
    for (const repo of repos)
      for (const kind of ["blocked", "uncommitted"] as const) {
        const here = done.filter((x) => x.repo === repo && x.c[kind]?.length);
        if (!here.length) continue;
        const dirs = [...new Set(here.flatMap((x) => x.c[kind]!))];
        const who = here.length === names.length ? "" : `${here.map((x) => x.name).join(", ")}: `;
        const copies = [...new Set(here.map((x) => copyDir(repo, x.name)))];
        const why = kind === "blocked" ? `git tracks ${dirs.length === 1 ? "it" : "them"}` : `${copies.join(", ")} ${copies.length === 1 ? "isn't" : "aren't"} committed, so a link would break for teammates`;
        notes.push(`${who}not linked in ${dirs.join(", ")} in ${repo}: ${why}`);
      }
    const skipped = changes.filter((x) => x.c.action === "skipped").map((x) => `${x.name} not added to ${x.repo}: ${x.c.reason}`);
    const text = [summary, ...notes, ...skipped].filter(Boolean).join("; ");
    const held = done.flatMap((x) => (x.c.blocked?.length ? [{ repo: x.repo, name: x.name, blocked: x.c.blocked }] : []));
    if (!done.length) return failed(text);
    if (held.length) return { message: text, then: allowTracked(held) };
    return skipped.length ? failed(text) : text;
  };
  /** Asks to add the links git-tracked folders held back: skills by repo, with the folders each one missed. */
  const allowTracked = (held: { repo: string; name: string; blocked: string[] }[]): Fix => {
    const repos = [...new Set(held.map((h) => h.repo))];
    const dirs = [...new Set(held.flatMap((h) => h.blocked))];
    return {
      label: `Also link ${new Set(held.map((h) => h.name)).size === 1 ? "it" : "them"} in ${dirs.join(", ")}`,
      preview: `${dirs.join(", ")} ${dirs.length === 1 ? "is" : "are"} committed in ${repos.join(", ")}: the links will show in git status. skilllib remembers this for ${repos.join(", ")}.`,
      run: (w) => {
        for (const repo of repos) allowTrackedLinks(rootOf(repo));
        if (held.length === 1) return w.ops.link(held[0]!.repo, held[0]!.name, true);
        const results = held.map((h) => ({ ...h, r: linkIn(h.repo, h.name, true) }));
        const linked = results.filter((x) => x.r.created.length);
        const names = [...new Set(linked.map((x) => x.name))];
        const summary = linked.length
          ? `Linked ${names.length === 1 ? names[0] : `${names.length} skills`} in ${[...new Set(linked.flatMap((x) => x.r.created))].join(", ")} in ${[...new Set(linked.map((x) => x.repo))].join(", ")}`
          : "";
        const others = results.filter((x) => !x.r.created.length || x.r.uncommitted.length).map((x) => `${x.repo}: ${linkSaid(x.name, x.r)}`);
        return [summary, ...others].join("; ");
      },
    };
  };
  const linkIn = (repo: string, name: string, allow: boolean): LinkResult => {
    const s = find(repo, name)!;
    return s.managed ? relinkDependency(rootOf(repo), name, { allowTracked: allow }) : linkEverywhere(rootOf(repo), name, s.location, { allowTracked: allow });
  };
  const linkSaid = (name: string, r: LinkResult): string => {
    const linked = r.created.length ? `linked in ${r.created.join(", ")}` : "";
    const notLinked = r.uncommitted.length
      ? `not linked in ${r.uncommitted.join(", ")}: git tracks ${r.uncommitted.length === 1 ? "it" : "them"} and ${name} isn't committed, so teammates would get broken links`
      : "";
    return `${name}: ${[linked, notLinked].filter(Boolean).join("; ") || "nothing to link"}`;
  };
  /** Local edits in the way: offer to go ahead anyway (`lost`: the edits aren't backed up). */
  const orForce = (c: Change, repo: string, label: string, force: () => Change, lost = true): Result =>
    c.action === "skipped" && c.reason?.includes("edits")
      ? {
          message: said(c, repo),
          then: { label, preview: lost ? `Your edits to ${c.name} in ${repo} are lost.` : `Your edits to ${c.name} in ${repo} go to Settings › Backups.`, run: () => result(force(), repo) },
        }
      : result(c, repo);
  const toLibrary = (path: string) => {
    const r = importSkill(path, { force: true });
    return r.status === "unchanged" ? `${r.name} is already the same in your library` : `${r.name} v${latestVersion(r.name)?.version} is in your library`;
  };

  return {
    add: (repo, name) => addTo([repo], [name]),
    addTo,
    remove: (repo, name) => {
      const s = find(repo, name);
      if (!s) return failed(`${name} isn't in ${repo}`);
      const committed = !s.managed && ["committed", "changed"].includes(gitInfo(rootOf(repo))?.of(relativeTo(rootOf(repo), s.path)) ?? "");
      if (s.state.startsWith("repo skill") || committed) return failed(`${name} is the repo's own (committed by your team): skilllib doesn't delete it`);
      if (!s.managed) return (removeUntracked(rootOf(repo), name, s.path), `Removed ${name} from ${repo} (in Settings › Backups)`);
      return orForce(removeSkill(rootOf(repo), name), repo, "Remove it anyway", () => removeSkill(rootOf(repo), name, { force: true }));
    },
    restore: (repo, name) => {
      const c = syncProject(rootOf(repo)).find((x) => x.name === name);
      return c ? result(c, repo) : `${name} is already in place`;
    },
    update: (repo, name) => {
      const c = updateProject(rootOf(repo), [name])[0];
      return c ? orForce(c, repo, "Update anyway", () => updateProject(rootOf(repo), [name], { force: true })[0]!, false) : `${name} is up to date`;
    },
    saveEdits: (repo, name) => {
      const s = find(repo, name)!;
      const saved = toLibrary(s.path);
      addSkill(rootOf(repo), name);
      return saved;
    },
    discardEdits: (repo, name) => {
      // The edited copy goes to the backups; then the library's copy goes in its place.
      const s = find(repo, name)!;
      removeUntracked(rootOf(repo), name, s.path);
      return withLinks(addSkill(rootOf(repo), name, s.managed && s.version ? { version: s.version } : {}), repo, name);
    },
    link: (repo, name, allow = false) => {
      const r = linkIn(repo, name, allow);
      const message = linkSaid(name, r);
      if (!r.blocked.length || allow) return r.created.length ? message : failed(message);
      return { message: `${message}; not linked in ${r.blocked.join(", ")}: git tracks ${r.blocked.length === 1 ? "it" : "them"}`, then: allowTracked([{ repo, name, blocked: r.blocked }]) };
    },
    track: (repo, name) => withLinks(addSkill(rootOf(repo), name), repo, name),
    importLocal: (repo, name) => {
      const s = find(repo, name)!;
      importSkill(s.path);
      return withLinks(addSkill(rootOf(repo), name), repo, name);
    },
    copyToLibrary: (repo, name) => toLibrary(find(repo, name)!.path),
    tidy: (repo, name, { keep, allowGit = false } = {}) => {
      // Planned again: the folders may have changed since the world was read.
      const root = repo === null ? null : rootOf(repo);
      const opts = keep ? { keep: { [name]: keep } } : {};
      const plan = (root ? planProjectTidy(root, opts) : planGlobalTidy(opts)).plans.find((p) => p.name === name);
      if (!plan) return `${name}: nothing to tidy`;
      const r = applyTidy(plan, { git: allowGit ? "go" : "keep" });
      const steps = (list: typeof r.applied) => list.map((s) => describeStep(s, root)).join(", ");
      if (!r.held.length) return r.applied.length ? `${name}: ${steps(r.applied)}` : `${name}: nothing changed`;
      return {
        message: `${name}: ${r.applied.length ? `${steps(r.applied)}; ` : ""}held back ${steps(r.held)}, because git tracks it`,
        then: {
          label: "Also change what git tracks",
          preview: `${steps(r.held)}: these changes will show in git status in ${repo}. Replaced copies go to Settings › Backups.`,
          run: (w) => w.ops.tidy(repo, name, { keep, allowGit: true }),
        },
      };
    },
    unloadGlobal: (m) => {
      if (!m.broken && !latestVersion(m.name)) importSkill(m.path);
      const r = unloadGlobal(m.path, m.links);
      return r.ok ? `${m.name} no longer loads globally (in Settings › Backups)` : failed(`${m.name}: ${r.reason}`);
    },
    deleteGlobal: (m) => {
      const r = deleteGlobal(m.path, m.links);
      return r.ok ? (m.broken ? `Removed the broken link ${m.name}` : `Deleted ${m.name} (in Settings › Backups)`) : failed(`${m.name}: ${r.reason}`);
    },
    keepGlobal: (name, keep) => (setKeepGlobal([name], keep), keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`),
    linkGlobal: (m, agents) => {
      const r = linkGlobal(m.path, agents);
      const linked = r.linked.map(tildify).join(", ");
      const skipped = r.skipped.length ? `; ${r.skipped.map(tildify).join(", ")} already holds a different skill` : "";
      const message = `${m.name}: ${linked ? `linked ${linked}` : "nothing linked"}${skipped}`;
      return !linked && skipped ? failed(message) : message;
    },
    moveGlobal: (skills, repos, group) => {
      const moved: string[] = [];
      const notes: string[] = [];
      /**
       * Links a git-tracked folder held back, where an agent you use now can't see the skill.
       * `copy`: the real copy's folder; unless git shares it, a link would break for teammates, so none is offered.
       */
      const held: { repo: string; name: string; blocked: string[]; blind: HarnessId[]; copy: string; shared: boolean }[] = [];
      for (const m of skills) {
        // Your library already has a different skill by that name: moving this one would swap in the other.
        if (importSkill(m.path).status === "exists") {
          notes.push(`${m.name}: your library has a different ${m.name}; nothing moved (update your library from this copy first)`);
          continue;
        }
        if (group) recordOrigin(m.name, `group: ${group}`);
        const results = repos.map((r) => [r, addSkill(rootOf(r), m.name)] as const);
        const skipped = results.filter(([, c]) => c.action === "skipped");
        // Only stop loading it globally once every repo you picked has it.
        if (skipped.length) {
          notes.push(`${m.name}: not added to ${skipped.map(([r, c]) => `${r} (${c.reason})`).join(", ")}, so it still loads globally`);
          continue;
        }
        const r = unloadGlobal(m.path, m.links);
        if (!r.ok) {
          notes.push(`${m.name}: ${r.reason}`);
          continue;
        }
        moved.push(m.name);
        for (const [repo, c] of results) {
          const blind = visibilityOf(rootOf(repo), m.name).flatMap((v) => (v.paths === 0 ? [v.id] : []));
          // addSkill holds back a link where git tracks the folder: `uncommitted` when git doesn't share the real copy.
          const blocked = [...(c.blocked ?? []), ...(c.uncommitted ?? [])];
          if (!blocked.length || !blind.length) continue;
          held.push({ repo, name: m.name, blocked, blind, copy: copyDir(repo, m.name), shared: !c.uncommitted?.length });
        }
      }
      // Never drop an agent silently: name who can't see it where, whether or not you then allow the links.
      // One note per kind of gap, e.g. "Claude Code can't see them in repo-api, repo-web: git tracks .claude/skills".
      const gaps = new Map<string, { who: string; why: string; repos: string[] }>();
      for (const repo of new Set(held.map((h) => h.repo)))
        for (const shared of [true, false]) {
          const here = held.filter((h) => h.repo === repo && h.shared === shared);
          if (!here.length) continue;
          const agents = [...new Set(here.flatMap((h) => h.blind))].map((id) => harness(id).name).join(", ");
          const what = skills.length === 1 ? "it" : here.length === moved.length ? "them" : here.map((h) => h.name).join(", ");
          const dirs = [...new Set(here.flatMap((h) => h.blocked))].join(", ");
          const why = shared ? `git tracks ${dirs}` : `${[...new Set(here.map((h) => h.copy))].join(", ")} isn't committed, so a link in ${dirs} would break for teammates`;
          const key = `${agents}|${what}|${why}`;
          if (!gaps.has(key)) gaps.set(key, { who: `${agents} can't see ${what}`, why, repos: [] });
          gaps.get(key)!.repos.push(repo);
        }
      const blindNotes = [...gaps.values()].map((g) => `${g.who} in ${g.repos.join(", ")}: ${g.why}`);
      const summary = moved.length ? `${moved.length === 1 ? moved[0] : `${moved.length} skills`} now load${moved.length === 1 ? "s" : ""} only in ${repos.join(", ")}` : "";
      const text = [summary, ...blindNotes, ...notes].filter(Boolean).join("; ") || "Nothing moved";
      const askable = held.filter((h) => h.shared);
      if (!moved.length && notes.length) return failed(text);
      return askable.length ? { message: text, then: allowTracked(askable) } : text;
    },
    createSkill: (name) => {
      const r = createSkill(name, "");
      return r.ok ? `Created ${name} in your library: edit its SKILL.md from Your skills` : failed(`${name}: ${r.reason}`);
    },
    pluginOffHere: (repo, id) => {
      const root = rootOf(repo);
      const plugin = claudePlugins(skillsLoadedIn(root, machineSkills()), root).find((p) => p.id === id);
      if (!plugin) return failed(`${id} isn't on in ${repo}`);
      const r = turnOffIn(plugin, root);
      return r.ok ? r.message : failed(r.message);
    },
    replacePlugin: (id, repos) => {
      const skills = machineSkills().filter((s) => s.kind === "plugin" && s.origin === id && !s.broken);
      // Copies in (recording "plugin: <id>" as their origin); a different library skill by the same name stops it.
      const clashes = skills.filter((s) => importSkill(s.path).status === "exists").map((s) => s.name);
      if (clashes.length) return failed(`${id} kept: your library has different ${clashes.join(", ")}; update or delete ${clashes.length === 1 ? "it" : "them"} first`);
      const skipped = repos.flatMap((r) => skills.flatMap((s) => {
        const c = addSkill(rootOf(r), s.name);
        return c.action === "skipped" ? [`${s.name} in ${r} (${c.reason})`] : [];
      }));
      // Only remove the plugin once every repo you picked has its skills.
      if (skipped.length) return failed(`${id} kept: not added ${skipped.join(", ")}`);
      const copied = `${skills.length} skill${skills.length === 1 ? " from " + id + " is" : "s from " + id + " are"} in your library${repos.length ? ` and in ${repos.join(", ")}` : ""}`;
      // Claude Code does the removing: uninstall (keeping its data, so a reinstall brings it back as it was),
      // or, when it can't (plugins synced from claude.ai), turn it off on this machine.
      // A timeout, so a slow or waiting `claude` can't freeze the app.
      // `claude` on PATH, or where the installer puts it (~/.local/bin/claude).
      const bin = claudeBinary();
      const claude = (...args: string[]) => spawnSync(bin!, ["plugin", ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
      const synced = id.endsWith("@synced");
      const off = bin && !synced && claude("uninstall", id, "--keep-data").status === 0 ? "uninstalled" : bin ? claude("disable", id) : null;
      if (off === "uninstalled") {
        recordRemovedPlugin(id, "user");
        return `${copied}; ${id} is uninstalled (restore it from Settings › Backups, or reinstall with /plugin)`;
      }
      if (off?.status === 0)
        return synced ? `${copied}; ${id} is off (it's synced from claude.ai: remove it there to delete it for good)` : `${copied}; ${id} is off: finish with /plugin uninstall ${id}`;
      const why = !off
        ? "the claude command isn't on your PATH"
        : off.error
          ? `claude didn't answer: ${off.error.message}`
          : (off.stderr || off.stdout).trim().split("\n")[0] || `exit ${off.status}`;
      // No claude command: the same setting `claude plugin disable` writes, so nothing loads twice.
      try {
        setPluginEnabled(id, false);
      } catch (e) {
        return failed(`${copied}; couldn't turn ${id} off (${why}; ${(e as Error).message}): turn it off with /plugin`);
      }
      return `${copied}; turned ${id} off in ~/.claude/settings.json (${why})${synced ? "" : `: finish with /plugin uninstall ${id}`}`;
    },
    deleteLibrary: (name) => {
      // Every repo that tracks it, hidden ones too; each copy (edits included) goes to the backups first.
      const from: string[] = [];
      for (const root of projectsUsing(name)) {
        const s = projectStatus(root).find((x) => x.name === name && x.managed);
        if (s && existsSync(s.path)) removeUntracked(root, name, s.path);
        removeSkill(root, name, { force: true });
        from.push([...roots].find(([, r]) => r === root)?.[0] ?? basename(root));
      }
      const r = deleteLibrarySkill(name);
      if (!r.ok) return failed(`${name}: ${r.reason}`);
      return `Deleted ${name} from your library${from.length ? ` and from ${from.join(", ")}` : ""} (in Settings › Backups)`;
    },
    restoreBackup: (i) => {
      const b = backups[i]!;
      const r = b.kind === "plugin" ? restorePlugin(b) : restoreBackup(b);
      return r.ok ? `Restored ${b.name} to ${tildify(r.to)}` : failed(`${b.name}: ${r.reason}`);
    },
    setAgents: (ids) => (setHarnesses(ids), "Saved your agents"),
    installVersion: (repo, name, version) => withLinks(addSkill(rootOf(repo), name, { version, force: true }), repo, name),
    versions: (name) => versionHistory(name).map((v) => ({ version: v.version, date: v.date.slice(0, 10) })),
    libraryFile: (name) => join(librarySkillDir(name), "SKILL.md"),
    addRoot: (path) => {
      const root = addRoot(path);
      discoverProjects();
      return `Scanning ${tildify(root)} for repos`;
    },
    removeRoot: (path) => (removeRoot(path), `Stopped scanning ${tildify(path)}; repos already found stay until you hide them`),
    rescan: () => (discoverProjects(), "Looked for repos in your project folders again"),
    hide: (repo) => (setHidden(rootOf(repo), true), `Hid ${repo}: Settings › Hidden repos brings it back`),
    unhide: (path) => (setHidden(path, false), `${tildify(path)} is back in the list`),
    openFolder: (path) => {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      spawn(cmd, [path], { detached: true, stdio: "ignore" }).unref();
      return `Opened ${tildify(path)}`;
    },
    copy: (text, what) => {
      const r = copyText(text);
      return r.copied ? `Copied ${what}: paste it into Claude Code, Cursor or Codex` : `Couldn't reach the clipboard; ${what} is in ${tildify(r.savedTo)}`;
    },
    installAgentSkill: () => {
      const r = installAgentSkill();
      return r.ok ? `Your agents can now use skilllib (${r.dirs.map(tildify).join(", ")})` : failed(`skilllib skill: ${r.reason}`);
    },
    removeAgentSkill: () => {
      const removed = removeAgentSkill();
      return removed.length ? `Removed the skilllib skill (${removed.map(tildify).join(", ")})` : failed("The skilllib skill isn't installed");
    },
    repoInfo: (repo) => {
      if (!info.has(repo)) {
        const root = rootOf(repo);
        const status = git(root, ["status", "--porcelain"]);
        info.set(repo, {
          remote: remoteLabel(git(root, ["remote", "get-url", "origin"])),
          branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || undefined,
          dirty: status ? status.split("\n").length : 0,
        });
      }
      return info.get(repo)!;
    },
  };
}
