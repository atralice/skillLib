/**
 * The TUI's World from disk: your repos, library and global skills, with ops that call
 * library.ts and config.ts. Usage comes separately (loadUsage): reading transcripts is slow.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { agentSkillState, installAgentSkill, removeAgentSkill } from "../agentSkill.js";
import { projectOfFactory } from "../commands.js";
import { addRoot, allowTrackedLinks, discoverProjects, enabledHarnesses, harnessesChosen, keptGlobal, readConfig, removeRoot, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "../config.js";
import { copyText } from "../review.js";
import { gitInfo, relativeTo } from "../git.js";
import { findIssues, usageIssues } from "../health.js";
import {
  addSkill,
  createSkill,
  deleteGlobal,
  deleteLibrarySkill,
  importSkill,
  librarySkills,
  linkEverywhere,
  listBackups,
  projectStatus,
  relinkDependency,
  removeSkill,
  librarySkillDir,
  projectsUsing,
  removeUntracked,
  restoreBackup,
  updateProject,
  visibilityOf,
  type Backup,
  type Change,
  type LinkResult,
  type ProjectSkill,
} from "../library.js";
import { harness, type HarnessId } from "../harnesses.js";
import { moveGlobalSkills } from "../move.js";
import { PROJECT_SKILLS_DIR } from "../paths.js";
import { projectHere, readManifest } from "../project.js";
import { readSkillInfo } from "../skills.js";
import {
  claudeBinary,
  cursorPlugins,
  forgetClaudeBinary,
  installedPlugins,
  pluginBackups,
  restorePlugin,
  setPluginOn,
  uninstallPlugin,
  updatePlugin,
  type InstalledPlugin,
  type PluginRef,
} from "../plugins.js";
import { libraryOrigins, machineSkills, recordOrigin, skillsLoadedIn, type SourcedSkill } from "../sources.js";
import { scanUsage } from "../usage.js";
import { forgetLatest, latestVersion, versionHistory } from "../versions.js";
import { failed, followUp, type Fix, type LocalSkill, type MachineSkill, type Ops, type Plugin, type Project, type Result, type World } from "./world.js";
import { tildify as homeRelative } from "../output.js";

/** Home-relative path for labels. */
export function tildify(p: string): string {
  return homeRelative(p).replace(/\\/g, "/");
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
    "edited locally": { edited: true },
    "edited locally, update available": { edited: true },
    "folder missing": { missing: true },
  };
  const other: Partial<Record<ProjectSkill["state"], Partial<LocalSkill>>> = {
    "untracked copy of library skill": { source: "untracked" },
    "untracked, differs from library": { source: "untracked" },
    "local only": { source: "untracked" },
    // Installed with `npx skills add` (the repo's skills-lock.json): not skilllib's, so not a library skill.
    "from npx skills": { source: "untracked" },
    "repo skill": { source: "repo" },
    "repo skill, in library": { source: "repo" },
    "repo skill, differs from library": { source: "repo" },
  };
  const state = git ? git.of(relativeTo(root, s.path)) : null;
  // A copy git tracks is the team's wherever it lives (.claude/skills too), so it's never removed or replaced from here.
  const own = other[s.state]?.source === "untracked" && (state === "committed" || state === "changed") ? { source: "repo" as const } : {};
  return {
    name: s.name,
    source: "lib",
    dir: s.location,
    path: s.path,
    // Agents that actually load it here: visibility lists every agent you use, with `paths: 0` for the blind ones.
    agents: s.visibility.filter((v) => v.paths > 0).map((v) => v.id),
    ...(s.managed ? { version: s.version ?? undefined, ...managed[s.state] } : { ...other[s.state], ...own }),
    ...(s.source ? { origin: `npx skills: ${s.source}` } : {}),
    git: state,
  };
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
    source: global ? "global" : s.kind === "plugin" ? "plugin" : s.kind === "claude.ai" ? "claude.ai" : s.kind === "system" ? "system" : s.kind === "skilllib" ? "skilllib" : s.kind === "built-in" && s.harnesses[0] === "grok" ? "grok" : "cursor",
    where: global || s.kind === "skilllib" ? tildify(dirname(s.path)) : s.kind === "claude.ai" ? "claude.ai account" : s.kind === "built-in" ? `${s.origin} built-in` : s.origin,
    ...(s.kind === "skills.sh" ? { origin: `npx skills: ${s.origin}` } : {}),
    path: s.path,
    links: s.links,
    agents: s.harnesses,
    ...(global && kept.has(s.name) ? { kept: true } : {}),
    ...(s.broken ? { broken: true } : {}),
    ...(global && s.kind !== "skills.sh" ? { installed: installedAt(s.path) } : {}),
  };
}

/** A plugin as the screens show it; `repoOf` names the repo a project or local install is in. */
function pluginOf(p: InstalledPlugin, repoOf: (path: string) => string | undefined): Plugin {
  const scope = p.agent === "cursor" ? "cursor" : p.synced ? "claude.ai" : (p.scope ?? "user");
  const repo = p.projectPath ? (repoOf(p.projectPath) ?? basename(p.projectPath)) : undefined;
  return {
    key: [p.agent, p.id, scope, p.projectPath ?? ""].join("|"),
    id: p.id,
    agent: p.agent,
    scope,
    ...(repo ? { repo, projectPath: p.projectPath } : {}),
    on: p.on,
    ...(p.version ? { version: p.version } : {}),
    ...(p.update ? { update: p.update } : {}),
    ...(p.settingsOnly ? { settingsOnly: true as const } : {}),
    description: p.description,
    path: p.root,
    skills: p.skills.map((path) => ({ name: basename(path), path })),
    parts: p.extras,
  };
}

/** What plugins.ts needs to act on a plugin. */
function refOf(p: Plugin): PluginRef {
  return { id: p.id, scope: p.scope === "claude.ai" ? null : p.scope, ...(p.projectPath ? { projectPath: p.projectPath } : {}), synced: p.scope === "claude.ai", ...(p.settingsOnly ? { settingsOnly: true as const } : {}) };
}

/** Everything on disk the screens show, except usage. */
export function loadWorld(): World {
  forgetLatest();
  forgetClaudeBinary();
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
  const libraryNames = new Set(library.map((l) => l.name));
  const kept = keptGlobal();
  // Cursor plugins: reported only (Cursor's plugin state can't be read).
  const cursorList = agents.includes("cursor") ? cursorPlugins() : [];
  const sourced = machineSkills(agents);
  const machine = sourced.map((s) => {
    descriptions[s.name] ??= s.description;
    return machineSkill(s, kept);
  });
  // A repo's Claude Code settings can turn a plugin on or off just there.
  const loadedHere = (root: string): Pick<Project, "machine"> => {
    const loaded = skillsLoadedIn(root, sourced, agents);
    if (loaded === sourced) return {};
    for (const s of loaded) descriptions[s.name] ??= s.description;
    return { machine: loaded.map((s) => machine[sourced.indexOf(s)] ?? machineSkill(s, kept)) };
  };
  const statuses = new Map(roots.map((root) => [root, projectStatus(root)]));
  const projects = roots.map((root): Project => {
    const status = statuses.get(root)!;
    const hasManifest = existsSync(join(root, "skilllib.json"));
    const git = status.length || hasManifest ? gitInfo(root) : null;
    for (const s of status) if (!descriptions[s.name] && !s.state.includes("missing")) descriptions[s.name] = readSkillInfo(s.path).description;
    return {
      name: names.get(root)!,
      path: root,
      manifest: hasManifest ? (git ? git.of("skilllib.json") : "no git") : "none",
      skills: status.map((s) => localSkill(root, s, git)),
      ...loadedHere(root),
    };
  });
  const backups = [...listBackups(), ...pluginBackups()].sort((a, b) => b.movedAt.localeCompare(a.movedAt));
  const repoOf = (path: string) => projects.find((p) => real(p.path) === real(path))?.name;
  const plugins = [...installedPlugins(), ...cursorList].map((p) => pluginOf(p, repoOf));
  return {
    agents,
    cwd: cwd ? names.get(cwd)! : null,
    projects,
    machine,
    plugins,
    library,
    usage: {},
    descriptions,
    backups: backups.map((b) => ({ name: b.name, from: tildify(b.from), at: b.movedAt })),
    ...(({ roots, hidden }) => ({ roots, hidden }))(readConfig()),
    agentsChosen: harnessesChosen(),
    agentSkill: agentSkillState(agents),
    issues: findIssues(roots, sourced, libraryNames, (root) => statuses.get(root)!),
    ops: realOps(new Map(projects.map((p) => [p.name, p.path])), backups, sourced, libraryNames),
  };
}

/** Uses per repo and per day over the last 30 days, from Claude Code's transcripts. */
export async function loadUsage(w: World): Promise<Pick<World, "usage" | "days" | "totals">> {
  const repoOf = new Map(w.projects.map((p) => [p.path, p.name]));
  const projectOf = projectOfFactory(w.projects.map((p) => p.path));
  const usage: World["usage"] = {};
  const days: NonNullable<World["days"]> = {};
  // Calendar days in local time (index 29 = today), so "today" and each bar mean a real day.
  const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const today = midnight(Date.now());
  const totals: Record<string, number> = {};
  for (const use of await scanUsage(30)) {
    // As doctor counts them: every session, and a plugin's copy (/plugin:name) counts for the skill.
    const skill = use.skill.split(":").pop()!;
    totals[skill] = (totals[skill] ?? 0) + 1;
    if (skill !== use.skill) totals[use.skill] = (totals[use.skill] ?? 0) + 1;
    const root = projectOf(use.cwd);
    const repo = root ? repoOf.get(root) : undefined;
    const day = 29 - Math.round((today - midnight(Date.parse(use.at))) / 86_400_000);
    if (!repo || day < 0 || day > 29) continue;
    (usage[repo] ??= {})[use.skill] = (usage[repo][use.skill] ?? 0) + 1;
    ((days[repo] ??= {})[use.skill] ??= new Array<number>(30).fill(0))[day]! += 1;
  }
  return { usage, days, totals };
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

function realOps(roots: Map<string, string>, backups: Backup[], machine: SourcedSkill[], libraryNames: Set<string>): Ops {
  const rootOf = (repo: string) => roots.get(repo)!;
  const find = (repo: string, name: string) => projectStatus(rootOf(repo)).find((s) => s.name === name);

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
    return addMany(repos, names).result;
  };
  /** addTo's work, with what it couldn't add and the links it held back, for callers that need them apart. */
  const addMany = (repos: string[], names: string[]): { result: Result; skipped: string[]; notes: string[] } => {
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
    const result: Result = !done.length ? failed(text) : held.length ? { message: text, then: allowTracked(held) } : skipped.length ? failed(text) : text;
    return { result, skipped, notes };
  };
  /** Asks to add the links git-tracked folders held back: skills by repo, with the folders each one missed. */
  const allowTracked = (held: { repo: string; name: string; blocked: string[] }[]): Fix => {
    const repos = [...new Set(held.map((h) => h.repo))];
    const dirs = [...new Set(held.flatMap((h) => h.blocked))];
    return {
      label: `Also link ${new Set(held.map((h) => h.name)).size === 1 ? "it" : "them"} in ${dirs.join(", ")}`,
      preview: `${dirs.join(", ")} ${dirs.length === 1 ? "is" : "are"} committed in ${repos.join(", ")}: the links will show in git status. skilllib remembers this for ${repos.join(", ")}.`,
      run: () => {
        for (const repo of repos) allowTrackedLinks(rootOf(repo));
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
  const orForce = (c: Change, repo: string, label: string, force: () => Change): Result =>
    c.action === "skipped" && c.reason?.includes("edits")
      ? {
          message: `${c.name} in ${repo} has local edits`,
          then: { label, preview: `Your edits to ${c.name} in ${repo} go to Settings › Backups.`, run: () => result(force(), repo) },
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
    update: (repo, name) => {
      const c = updateProject(rootOf(repo), [name])[0];
      return c ? orForce(c, repo, "Update anyway", () => updateProject(rootOf(repo), [name], { force: true })[0]!) : `${name} is up to date`;
    },
    copyToLibrary: (repo, name) => toLibrary(find(repo, name)!.path),
    deleteGlobal: (m) => {
      const r = deleteGlobal(m.path, m.links);
      return r.ok ? (m.broken ? `Removed the broken link ${m.name}` : `Deleted ${m.name} (in Settings › Backups)`) : failed(`${m.name}: ${r.reason}`);
    },
    keepGlobal: (name, keep) => (setKeepGlobal([name], keep), keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`),
    moveGlobal: (skills, repos, group) => {
      const moved: string[] = [];
      const notes: string[] = [];
      /**
       * Links a git-tracked folder held back, where an agent you use now can't see the skill.
       * `copy`: the real copy's folder; unless git shares it, a link would break for teammates, so none is offered.
       */
      const held: { repo: string; name: string; blocked: string[]; blind: HarnessId[]; copy: string; shared: boolean }[] = [];
      const repoRoots = repos.map(rootOf);
      for (const mv of moveGlobalSkills(skills, repoRoots, { group, label: (root) => repos[repoRoots.indexOf(root)]!, allowBlind: true })) {
        if (!mv.moved) {
          notes.push(`${mv.name}: ${mv.reason}`);
          continue;
        }
        moved.push(mv.name);
        for (const [i, [root, c]] of mv.changes.entries()) {
          const repo = repos[i]!;
          const blind = visibilityOf(root, mv.name).flatMap((v) => (v.paths === 0 ? [v.id] : []));
          // addSkill holds back a link where git tracks the folder: `uncommitted` when git doesn't share the real copy.
          const blocked = [...(c.blocked ?? []), ...(c.uncommitted ?? [])];
          if (!blocked.length || !blind.length) continue;
          held.push({ repo, name: mv.name, blocked, blind, copy: copyDir(repo, mv.name), shared: !c.uncommitted?.length });
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
    replacePlugin: (p, repos) => {
      const id = p.id;
      // Copies in, recording the plugin as their origin; a different library skill by the same name stops it.
      const imported = p.skills.map((s) => ({ name: s.name, status: importSkill(s.path).status }));
      const clashes = imported.filter((r) => r.status === "exists").map((r) => r.name);
      if (clashes.length) return failed(`${id} kept: your library has different ${clashes.join(", ")}; update or delete ${clashes.length === 1 ? "it" : "them"} first`);
      // Skills you already had keep the origin they have.
      for (const r of imported) if (r.status !== "unchanged") recordOrigin(r.name, `plugin: ${id}`);
      // Adding them asks about links git-tracked folders held back, as Add to repos does.
      const added = repos.length ? addMany(repos, p.skills.map((s) => s.name)) : { result: "", skipped: [], notes: [] };
      // Only remove the plugin once every repo you picked has its skills.
      if (added.skipped.length) return failed(`${id} kept: ${added.skipped.join("; ")}`);
      const n = p.skills.length;
      const copied = `${n} skill${n === 1 ? " from " + id + " is" : "s from " + id + " are"} in your library${repos.length ? ` and in ${repos.join(", ")}` : ""}`;
      const notes = added.notes.length ? `; ${added.notes.join("; ")}` : "";
      const then = followUp(added.result);
      const done = (message: string): Result => (then ? { message: message + notes, then } : message + notes);
      // Claude Code does the removing, where the plugin is installed: uninstall (keeping its data, so a
      // reinstall brings it back as it was), or, when it can't (synced from claude.ai, only turned on in
      // your settings, no claude command), turn it off.
      const ref = refOf(p);
      const bin = claudeBinary();
      let uninstallFailed = "";
      if (bin && !ref.synced && !ref.settingsOnly) {
        const r = uninstallPlugin(ref);
        if (r.ok) return done(`${copied}; ${r.message}`);
        uninstallFailed = ` (uninstalling failed: ${r.message.replace(`${id}: `, "")})`;
      }
      const off = setPluginOn(ref, false);
      if (!off.ok) return failed(`${copied}; couldn't turn ${id} off (${off.message}): turn it off with /plugin${notes}`);
      if (ref.synced) return done(`${copied}; ${id} is off (it's synced from claude.ai: remove it there to delete it for good)`);
      if (ref.settingsOnly) return done(`${copied}; ${id} is off (it was only turned on in your settings, so there's nothing to uninstall)`);
      return done(`${copied}; ${id} is off${bin ? uninstallFailed : " (the claude command isn't on your PATH)"}: finish with /plugin uninstall ${id}`);
    },
    setPlugin: (p, on) => {
      const r = setPluginOn(refOf(p), on);
      return r.ok ? r.message : failed(r.message);
    },
    uninstallPlugin: (p) => {
      const r = uninstallPlugin(refOf(p));
      return r.ok ? r.message : failed(r.message);
    },
    updatePlugin: (p) => {
      const r = updatePlugin(refOf(p));
      return r.ok ? r.message : failed(r.message);
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
      return r.copied ? `Copied ${what}: paste it into Claude Code, Cursor, Codex or Grok` : `Couldn't reach the clipboard; ${what} is in ${tildify(r.savedTo)}`;
    },
    installAgentSkill: () => {
      const r = installAgentSkill();
      return r.ok ? `Your agents can now use skilllib (${r.dirs.map(tildify).join(", ")})` : failed(`skilllib skill: ${r.reason}`);
    },
    removeAgentSkill: () => {
      const removed = removeAgentSkill();
      return removed.length ? `Removed the skilllib skill (${removed.map(tildify).join(", ")})` : failed("The skilllib skill isn't installed");
    },
    usageIssues: ({ usage, totals = {} }) => {
      const repoOf = new Map([...roots].map(([name, root]) => [root, name]));
      return usageIssues([...roots.values()], machine, libraryNames, {
        inProject: (root, skill) => usage[repoOf.get(root)!]?.[skill] ?? 0,
        total: (skill) => totals[skill] ?? 0,
        asUsed: (key) => totals[key] ?? 0,
        days: 30,
      });
    },
  };
}
