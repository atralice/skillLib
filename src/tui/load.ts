/**
 * The TUI's World from disk: your repos, library and global skills, with ops that call
 * library.ts and config.ts. Usage comes separately (loadUsage): reading transcripts is slow.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { agentSkillState, installAgentSkill, removeAgentSkill } from "../agentSkill.js";
import { projectOfFactory } from "../commands.js";
import { addRoot, allowTrackedLinks, discoverProjects, enabledHarnesses, harnessesChosen, keptGlobal, readConfig, removeRoot, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "../config.js";
import { copyText } from "../review.js";
import { gitInfo, isShared, relativeTo } from "../git.js";
import { findIssues, usageIssues } from "../health.js";
import {
  addRefusal,
  withoutForceHint,
  addSkill,
  blindSaid,
  blindWithoutGlobal,
  createSkill,
  entryExists,
  strandedLinks,
  survives,
  deleteGlobal,
  deleteLibrarySkill,
  importSkill,
  librarySkills,
  inTheWaySaid,
  linkEverywhere,
  notWritable,
  listBackups,
  movedTogether,
  projectStatus,
  relinkDependency,
  removeSkill,
  librarySkillDir,
  projectsUsing,
  removeUntracked,
  restoreBackup,
  updateProject,
  type Backup,
  type Change,
  type LinkResult,
  type ProjectSkill,
  trackBlocker,
} from "../library.js";
import { moveGlobalSkills } from "../move.js";
import { PROJECT_SKILLS_DIR, realPath } from "../paths.js";
import { knownProjects, projectHere, readableRoots, readManifest, rememberProjects } from "../project.js";
import { isDir, readSkillInfo, treeHash } from "../skills.js";
import { foldersOf } from "../tidy.js";
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
import { scanUsage, skillOf } from "../usage.js";
import { forgetLatest, latestVersion, versionHistory } from "../versions.js";
import { failed, followUp, said as resultSaid, type Fix, type LocalSkill, type MachineSkill, type Ops, type Plugin, type Project, type Result, type World } from "./world.js";
import { localStamp, tildify } from "../output.js";

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
  const others = otherCopies(root, s.name, s.location);
  // A copy git tracks is the team's wherever it lives (.claude/skills too), so it's never removed or replaced from here.
  const own = other[s.state]?.source === "untracked" && isShared(state) ? { source: "repo" as const } : {};
  return {
    name: s.name,
    source: "lib",
    dir: s.location,
    path: s.path,
    // Agents that actually load it here: visibility lists every agent you use, with `paths: 0` for the blind ones.
    agents: s.visibility.filter((v) => v.paths > 0).map((v) => v.id),
    ...(s.managed ? { version: s.version ?? undefined, ...managed[s.state] } : { ...other[s.state], ...own }),
    ...(s.source ? { origin: `npx skills: ${s.source}` } : {}),
    ...(others.length ? { others } : {}),
    git: state,
  };
}

/** Folders in a repo holding another real copy of a skill, besides `dir` (e.g. ".agents/skills"). */
function otherCopies(root: string, name: string, dir: string): string[] {
  // The same folder seen through a skills folder that links to another (.claude/skills → .agents/skills) is no other copy.
  const self = realPath(join(root, dir, name));
  return foldersOf(root, name)
    .real.filter((d) => realPath(join(d, name)) !== self)
    .map((d) => relativeTo(root, d));
}

/** When a folder appeared, to the minute ("2026-09-25 20:55"). */
function installedAt(path: string): string | undefined {
  try {
    const st = lstatSync(path);
    return localStamp((st.birthtimeMs > 0 ? st.birthtime : st.mtime).getTime());
  } catch {
    return undefined;
  }
}

function machineSkill(s: SourcedSkill, kept: Set<string>): MachineSkill {
  const global = s.kind === "global" || s.kind === "skills.sh";
  return {
    name: s.name,
    source: global ? "global" : s.kind === "plugin" ? "plugin" : s.kind === "claude.ai" ? "claude.ai" : s.kind === "system" || (s.kind === "built-in" && s.harnesses[0] === "codex") ? "system" : s.kind === "skilllib" ? "skilllib" : s.kind === "built-in" && s.harnesses[0] === "grok" ? "grok" : "cursor",
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
  // Remembered, as a CLI command there would: "who uses this skill" (deleting from your library) sees it too.
  if (here) rememberProjects([here]);
  // The same repo can come as two paths (a symlinked folder, /var vs /private/var): match by real path.
  const real = realPath;
  const visible = visibleProjects();
  const cwd = here ? (visible.find((p) => real(p) === real(here)) ?? here) : null;
  const listed = [...new Set([...(cwd ? [cwd] : []), ...visible])];
  // A repo whose skilllib.json can't be read is left out here; its issue (from findIssues) says why.
  const roots = readableRoots(listed).readable;
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
  // What your agents load everywhere: a skill in a folder none of them reads isn't (a broken link still shows, to fix).
  const sourced = machineSkills(agents).filter((s) => s.harnesses.length || s.broken);
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
      skills: status.map((s) => {
        const local = localSkill(root, s, git);
        // A repo's own copy can say something else than your library's or the global one by that name.
        const own = s.state.includes("missing") ? "" : readSkillInfo(s.path).description;
        return own && own !== descriptions[s.name] ? { ...local, description: own } : local;
      }),
      ...loadedHere(root),
    };
  });
  const backups = [...listBackups(), ...pluginBackups()].sort((a, b) => b.movedAt.localeCompare(a.movedAt));
  const repoOf = (path: string) => projects.find((p) => real(p.path) === real(path))?.name;
  const plugins = [...installedPlugins(), ...cursorList].map((p) => pluginOf(p, repoOf));
  return {
    agents,
    cwd: cwd && names.has(cwd) ? names.get(cwd)! : null,
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
    issues: findIssues(listed, sourced, libraryNames, (root) => statuses.get(root)!),
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
    const skill = skillOf(use.skill);
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
  if (c.action === "removed") return `Removed ${c.name} from ${repo}${c.reason ? ` (${c.reason})` : ""}`;
  if (c.action === "unchanged") return `${c.name}${c.to ? ` v${c.to}` : ""} is already in ${repo}`;
  if (c.action === "relinked") return `Linked ${c.name}${c.to ? ` v${c.to}` : ""} for your other agents in ${repo}`;
  // An older version picked from Other versions… isn't an update.
  const back = c.action === "updated" && c.from !== undefined && c.to !== undefined && c.to < c.from;
  const done = back
    ? `Pinned ${c.name} to v${c.to} in ${repo} (was v${c.from})`
    : `${c.action === "installed" ? "Added" : c.action === "reset" ? "Reset" : "Updated"} ${c.name}${c.to ? ` v${c.to}` : ""} in ${repo}`;
  return c.backedUp ? `${done} (your edits are in Settings › Backups)` : done;
}

function realOps(roots: Map<string, string>, backups: Backup[], machine: SourcedSkill[], libraryNames: Set<string>): Ops {
  const rootOf = (repo: string) => roots.get(repo)!;
  /** A repo's name in the app, or its folder's for one the app doesn't show. */
  const nameOf = (root: string) => [...roots].find(([, r]) => r === root)?.[0] ?? basename(root);
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
    // Something in a link's way is said, and still leaves the git-tracked folders' question to ask.
    const way = c.inTheWay?.length ? `; not linked everywhere: ${inTheWaySaid(rootOf(repo), c.inTheWay)} (clear the way, then link again)` : "";
    if (c.uncommitted?.length)
      return `${said(c, repo)}${way}; not linked in ${c.uncommitted.join(", ")}: git tracks ${it(c.uncommitted)} and ${copyDir(repo, name)}/${name} isn't committed, so teammates would get broken links`;
    if (!c.blocked?.length) return way ? failed(`${said(c, repo)}${way}`) : result(c, repo);
    return { message: `${said(c, repo)}${way}; not linked in ${c.blocked.join(", ")}: git tracks ${it(c.blocked)}`, then: allowTracked([{ repo, name, blocked: c.blocked }]) };
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
    for (const x of done.filter((d) => d.c.inTheWay?.length)) notes.push(`${x.name} not linked everywhere in ${x.repo}: ${inTheWaySaid(rootOf(x.repo), x.c.inTheWay!)}`);
    const skipped = changes.filter((x) => x.c.action === "skipped").map((x) => `${x.name} not added to ${x.repo}: ${x.c.reason}`);
    const text = [summary, ...notes, ...skipped].filter(Boolean).join("; ");
    const held = done.flatMap((x) => (x.c.blocked?.length ? [{ repo: x.repo, name: x.name, blocked: x.c.blocked }] : []));
    const result: Result = !done.length ? failed(text) : held.length ? { message: text, then: allowTracked(held) } : skipped.length || done.some((x) => x.c.inTheWay?.length) ? failed(text) : text;
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
        const others = results.filter((x) => !x.r.created.length || x.r.uncommitted.length || x.r.inTheWay.length).map((x) => `${x.repo}: ${linkSaid(x.repo, x.name, x.r)}`);
        return [summary, ...others].join("; ");
      },
    };
  };
  const linkIn = (repo: string, name: string, allow: boolean): LinkResult => {
    // The world can be stale (removed outside the app since it loaded): say so, not "undefined".
    const s = find(repo, name);
    if (!s) throw new Error(`${name} isn't in ${repo} any more`);
    return s.managed ? relinkDependency(rootOf(repo), name, { allowTracked: allow }) : linkEverywhere(rootOf(repo), name, s.location, { allowTracked: allow });
  };
  const linkSaid = (repo: string, name: string, r: LinkResult): string => {
    const linked = r.created.length ? `linked in ${r.created.join(", ")}` : "";
    const notLinked = r.uncommitted.length
      ? `not linked in ${r.uncommitted.join(", ")}: git tracks ${r.uncommitted.length === 1 ? "it" : "them"} and ${name} isn't committed, so teammates would get broken links`
      : "";
    const inTheWay = r.inTheWay.length ? inTheWaySaid(rootOf(repo), r.inTheWay) : "";
    return `${name}: ${[linked, notLinked, inTheWay].filter(Boolean).join("; ") || "nothing to link"}`;
  };
  /** Local edits in the way: offer to go ahead anyway (`lost`: the edits aren't backed up). */
  const orForce = (c: Change, repo: string, label: string, force: () => Change): Result =>
    // Whatever --force would get past (edits, a pin from another library, another copy in the way): offer it here.
    c.action === "skipped" && !!c.reason?.includes("--force")
      ? {
          message: `${c.name} in ${repo}: ${withoutForceHint(c.reason!)}`,
          then: { label, preview: `What's there now in ${repo} goes to Settings › Backups first.`, run: () => result(force(), repo) },
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
      const committed = !s.managed && isShared(gitInfo(rootOf(repo))?.of(relativeTo(rootOf(repo), s.path)));
      if (s.state.startsWith("repo skill") || committed) return failed(`${name} is the repo's own (committed by your team): skilllib doesn't delete it`);
      // This copy goes; a real copy in another folder (one that differs) stays, and the result says so.
      const others = otherCopies(rootOf(repo), name, s.location);
      const left = (r: Result): Result => (typeof r === "string" && others.length ? `${r}; the copy in ${others.join(", ")} stays` : r);
      if (!s.managed) return (removeUntracked(rootOf(repo), name, s.path), left(`Removed ${others.length ? `${s.location}/${name}` : name} from ${repo} (in Settings › Backups)`));
      return left(orForce(removeSkill(rootOf(repo), name), repo, "Remove it anyway", () => removeSkill(rootOf(repo), name, { force: true })));
    },
    update: (repo, name) => {
      const c = updateProject(rootOf(repo), [name])[0];
      return c ? orForce(c, repo, "Update anyway", () => updateProject(rootOf(repo), [name], { force: true })[0]!) : `${name} is up to date`;
    },
    copyToLibrary: (repo, name) => ((s) => (s ? toLibrary(s.path) : failed(`${name} isn't in ${repo} any more`)))(find(repo, name)),
    deleteGlobal: (m) => {
      // Gone already: an earlier copy in a group took this link along, or it went outside skilllib.
      if (!entryExists(m.path)) return `${tildify(m.path)} is already gone`;
      // Other global entries by that name that go through this one (a link to it, or to its link) would break with it:
      // they go too, and their agents count. A plugin's skill is its own (/plugin:name); a broken link loads nothing.
      const others = machine.filter((o) => o.name === m.name && o.path !== m.path && o.kind !== "plugin" && !o.broken);
      const dependents = others.filter((o) => !survives(o.path, [m.path, ...m.links]));
      const stays = others.filter((o) => !dependents.includes(o));
      if (!m.broken) {
        // As global move and Stop loading it globally: never while an agent in a repo you have would then lack it. Only
        // agents that read no other global copy of it (one that stays) lose anything.
        const readers = [...new Set([...m.agents, ...dependents.flatMap((o) => o.harnesses)])].filter((id) => !stays.some((o) => o.harnesses.includes(id)));
        const blind = blindWithoutGlobal(m.name, [{ path: m.path, harnesses: readers, links: [...m.links, ...dependents.map((o) => o.path)] }], [...roots.values(), ...knownProjects()]);
        if (blind.length) return failed(`${m.name} kept: ${blindSaid(m.name, blind, nameOf)}`);
      }
      // Package links that will point at nothing (the repo's own copy serves them): found before, said after.
      const left = m.broken ? [] : strandedLinks(m.name, [{ path: m.path, links: [...m.links, ...dependents.map((o) => o.path)] }], [...roots.values(), ...knownProjects()], nameOf);
      const r = deleteGlobal(m.path, [...m.links, ...dependents.map((o) => o.path)]);
      if (!r.ok) return failed(`${m.name}: ${r.reason}`);
      if (m.broken) return `Removed the broken link ${m.name}`;
      // Another global copy by that name still loads: said, so nobody thinks it's gone everywhere.
      const still = stays.map((o) => tildify(o.path));
      return `Deleted ${tildify(m.path)} (in Settings › Backups)${still.length ? `; ${m.name} still loads globally from ${still.join(", ")}` : ""}${
        left.length ? `; ${left.join(", ")} now point${left.length === 1 ? "s" : ""} at nothing: remove ${left.length === 1 ? "it" : "them"}` : ""
      }`;
    },
    keepGlobal: (name, keep) => (setKeepGlobal([name], keep), keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`),
    moveGlobal: (skills, repos, group) => {
      const repoRoots = repos.map(rootOf);
      // A repo you picked by its name in the app, any other (one that blocks the move) by its own.
      const label = (root: string) => repos[repoRoots.indexOf(root)] ?? nameOf(root);
      // Every global copy of a skill you picked moves, as global move does: a row is one copy, and another (or a link
      // through it) left loading would make "now loads only in" false, or break.
      const picked = new Set(skills.map((m) => m.name));
      const sourced = machine.filter((o) => picked.has(o.name) && o.movable && !o.broken);
      // A skill an agent in some repo would only have seen globally never moves (see moveGlobalSkills): it stays global, said.
      const attempt = (names?: string[]) =>
        moveGlobalSkills(names ? sourced.filter((m) => names.includes(m.name)) : sourced, repoRoots, { group, label, allowTrackedHint: "allow links there, then move it again" });
      const said = (results: ReturnType<typeof attempt>) => {
        const moved = results.filter((mv) => mv.moved).map((mv) => mv.name);
        // Named (a few) so a group's result says which went, not only how many.
        const which = moved.length <= 4 ? moved.join(", ") : `${moved.length} skills`;
        const summary = moved.length ? `${which} now load${moved.length === 1 ? "s" : ""} only in ${repos.join(", ")}` : "";
        // Package links now pointing at nothing (the repo's own copy serves them): said, to remove.
        const left = results.flatMap((mv) => mv.left ?? []);
        return {
          moved,
          text:
            [summary, ...(left.length ? [`${left.join(", ")} now point${left.length === 1 ? "s" : ""} at nothing: remove ${left.length === 1 ? "it" : "them"}`] : []), ...results.filter((mv) => !mv.moved).map((mv) => `${mv.name}: ${mv.reason}`)]
              .filter(Boolean)
              .join("; ") || "Nothing moved",
        };
      };
      const results = attempt();
      const { moved, text } = said(results);
      // Added, but git held a link back where it tracks the folder: ask once to link there, then finish the move.
      // Only for a skill that allowing those links would finish: added everywhere, nothing in the way, no copy git doesn't share.
      const finishable = (mv: (typeof results)[number]) =>
        !mv.moved && mv.changes.length > 0 && mv.changes.every(([, c]) => c.action !== "skipped" && !c.inTheWay?.length && !c.uncommitted?.length) && mv.changes.some(([, c]) => c.blocked?.length);
      const held = results.filter(finishable).flatMap((mv) => mv.changes.flatMap(([root, c]) => (c.blocked?.length ? [{ repo: label(root), name: mv.name, blocked: c.blocked }] : [])));
      if (held.length) {
        const ask = allowTracked(held);
        const names = [...new Set(held.map((h) => h.name))];
        return {
          message: text,
          then: {
            ...ask,
            label: `${ask.label}, then stop loading ${names.length === 1 ? "it" : "them"} globally`,
            // The retry is what says whether it's done: a skill still global after it is a failure, said as one.
            run: (w) => {
              const linked = resultSaid(ask.run(w));
              const retry = said(attempt(names));
              // What moved before the question, and the others that stayed global (for their own reasons), still said.
              const before = said(results.filter((mv) => mv.moved));
              const others = results.filter((mv) => !mv.moved && !names.includes(mv.name)).map((mv) => `${mv.name}: ${mv.reason}`);
              const text = [before.moved.length ? before.text : "", linked, retry.text, ...others].filter(Boolean).join("; ");
              return retry.moved.length === names.length ? text : failed(text);
            },
          },
        };
      }
      return moved.length ? text : failed(text);
    },
    createSkill: (name) => {
      const r = createSkill(name, "");
      return r.ok ? `Created ${name} in your library: edit its SKILL.md from Your skills` : failed(`${name}: ${r.reason}`);
    },
    replacePlugin: (p, repos) => {
      const id = p.id;
      // A different library skill by the same name stops it, before anything is copied in.
      const clashes = p.skills.filter((s) => {
        const mine = treeHash(librarySkillDir(s.name));
        return mine !== null && mine !== treeHash(s.path);
      });
      if (clashes.length) return failed(`${id} kept: your library has different ${clashes.map((s) => s.name).join(", ")}; update or delete ${clashes.length === 1 ? "it" : "them"} first`);
      // A repo that can't take one of them (its own different copy, the team's committed one, a folder that isn't
      // the repo's) stops it too, before anything is copied in: never half done.
      const cant = repos.flatMap((repo) =>
        p.skills.flatMap((s) => ((why) => (why ? [`${s.name} in ${repo}: ${withoutForceHint(why)}`] : []))(trackBlocker(rootOf(repo), s.name) ?? addRefusal(rootOf(repo), s.name, treeHash(s.path) ?? ""))),
      );
      if (cant.length) return failed(`${id} kept, nothing changed: ${cant.join("; ")}`);
      // Copies in, recording the plugin as their origin.
      const imported = p.skills.map((s) => ({ name: s.name, status: importSkill(s.path).status }));
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
      // The preview names the repos the app shows: a hidden one that tracks it isn't changed behind your back.
      const using = projectsUsing(name);
      // A repo whose skilllib.json can't be read (a merge conflict) may pin it: deleting it would strand that pin.
      // Checked first: such a repo isn't among the app's repos either, but it isn't hidden.
      const unreadable = readableRoots(using).unreadable.map((u) => u.root);
      if (unreadable.length) return failed(`${name} is pinned in ${unreadable.map((r) => basename(r)).join(", ")}, whose skilllib.json can't be read: fix it first, then delete`);
      const hidden = using.filter((root) => ![...roots.values()].includes(root));
      if (hidden.length) return failed(`${name} is also in ${hidden.map((r) => basename(r)).join(", ")}, which ${hidden.length === 1 ? "is" : "are"} hidden: unhide ${hidden.length === 1 ? "it" : "them"} (Settings) to delete it everywhere`);
      // Each copy (edits included) goes to the backups first. One behind a folder that links out of the repo isn't
      // the repo's: remove drops just its pin, touching nothing outside.
      const from: string[] = [];
      const left: string[] = [];
      for (const root of using) {
        const s = projectStatus(root).find((x) => x.name === name && x.managed);
        // Its copy to the backups first: only a skill folder in a folder really the repo's. Otherwise (a file of yours,
        // a folder outside the repo) remove drops just the pin and leaves what's there.
        if (s && isDir(s.path) && !notWritable(root, relative(root, dirname(s.path)).split(sep).join("/"))) removeUntracked(root, name, s.path);
        const c = removeSkill(root, name, { force: true });
        if (c.action === "skipped") return failed(`${name}: ${c.reason}${from.length ? `; removed from ${from.join(", ")} so far` : ""}`);
        const repo = nameOf(root);
        from.push(repo);
        // What was left there (a file of yours, a copy outside the repo): said, as remove says it.
        if (c.reason) left.push(`in ${repo}, ${c.reason}`);
      }
      const r = deleteLibrarySkill(name);
      if (!r.ok) return failed(`${name}: ${r.reason}`);
      return `Deleted ${name} from your library${from.length ? ` and from ${from.join(", ")}` : ""} (in Settings › Backups)${left.length ? `; ${left.join("; ")}` : ""}`;
    },
    restoreBackup: (i) => {
      // Copies moved out in one go (a global skill and its links) come back together, as `skilllib restore` does.
      const done = movedTogether(backups, backups[i]!).map((b) => [b, b.kind === "plugin" ? restorePlugin(b) : restoreBackup(b)] as const);
      const bad = done.filter(([, r]) => !r.ok);
      if (bad.length) return failed(bad.map(([b, r]) => `${b.name}: ${!r.ok ? r.reason : ""}`).join("; "));
      return done.map(([b, r]) => `Restored ${b.name} to ${r.ok ? tildify(r.to) : ""}`).join(" · ");
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
      // A missing opener (no xdg-open on a bare Linux) is said, never a crash.
      const r = spawnSync(cmd, [path], { stdio: "ignore", timeout: 10_000 });
      return r.error || (r.status !== 0 && process.platform !== "win32") ? failed(`Couldn't open ${tildify(path)} (${cmd} ${r.error ? "isn't available" : "failed"})`) : `Opened ${tildify(path)}`;
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
        // As doctor counts them: a plugin's copy (plugin:name, kept apart for the Plugins rows) counts for the skill.
        inProject: (root, skill) => Object.entries(usage[repoOf.get(root)!] ?? {}).reduce((n, [key, count]) => n + (skillOf(key) === skill ? count : 0), 0),
        total: (skill) => totals[skill] ?? 0,
        asUsed: (key) => totals[key] ?? 0,
        days: 30,
      });
    },
  };
}
