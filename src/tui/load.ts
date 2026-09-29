/**
 * The TUI's World from disk: your repos, library and global skills, with ops that call
 * library.ts and config.ts. Usage comes separately (loadUsage): reading transcripts is slow.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { projectOfFactory } from "../commands.js";
import { addRoot, allowTrackedLinks, discoverProjects, enabledHarnesses, harnessesChosen, keptGlobal, readConfig, removeRoot, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "../config.js";
import { copyText } from "../review.js";
import { gitInfo, relativeTo, type GitInfo } from "../git.js";
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
  syncProject,
  unloadGlobal,
  updateProject,
  type Backup,
  type Change,
  type ProjectSkill,
} from "../library.js";
import { userHome } from "../paths.js";
import { findProjectRoot, isProjectCandidate } from "../project.js";
import { readSkillInfo } from "../skills.js";
import { claudeBinary, cursorPluginSkills, pluginBackups, recordRemovedPlugin, restorePlugin } from "../plugins.js";
import { libraryOrigins, machineSkills, recordOrigin, setPluginEnabled, type SourcedSkill } from "../sources.js";
import { applyTidy, copyLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type TidyReport } from "../tidy.js";
import { scanUsage } from "../usage.js";
import { forgetLatest, latestVersion, versionHistory } from "../versions.js";
import type { Dupes, Fix, LocalSkill, MachineSkill, Ops, Project, RepoInfo, Result, World } from "./world.js";

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
    "folder missing": { missing: true },
    "not in library": { library: "missing" },
  };
  const other: Partial<Record<ProjectSkill["state"], Partial<LocalSkill>>> = {
    "untracked copy of library skill": { source: "untracked", library: "same" },
    "untracked, differs from library": { source: "untracked", library: "differs" },
    "local only": { source: "untracked" },
    "repo skill": { source: "repo" },
    "repo skill, in library": { source: "repo", library: "same" },
    "repo skill, differs from library": { source: "repo", library: "differs" },
  };
  return {
    name: s.name,
    source: "lib",
    dir: s.location,
    path: s.path,
    agents: s.visibility.map((v) => v.id),
    ...(s.managed ? { library: "same" as const, version: s.version ?? undefined, ...managed[s.state] } : other[s.state]),
    git: git ? git.of(relativeTo(root, s.path)) : null,
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
    source: global ? "global" : s.kind === "plugin" ? "plugin" : s.kind === "claude.ai" ? "claude.ai" : "cursor",
    where: global ? tildify(dirname(s.path)) : s.kind === "claude.ai" ? "claude.ai account" : s.kind === "built-in" ? `${s.origin} built-in` : s.origin,
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
  const cwdRoot = findProjectRoot();
  const here = isProjectCandidate(cwdRoot) && (existsSync(join(cwdRoot, ".git")) || existsSync(join(cwdRoot, "skilllib.json"))) ? cwdRoot : null;
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
  const machine = machineSkills(agents).map((s) => {
    descriptions[s.name] ??= s.description;
    const m = machineSkill(s, kept);
    if (m.source !== "global" || m.broken) return m;
    const dupes = globalDupes.get(m.name);
    const plugin = cursorPlugin.get(m.name);
    return { ...m, ...(dupes ? { dupes } : {}), ...(plugin ? { cursorPlugin: plugin } : {}) };
  });
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
  return `${c.action === "installed" ? "Added" : "Updated"} ${c.name}${c.to ? ` v${c.to}` : ""} in ${repo}`;
}

function realOps(roots: Map<string, string>, backups: Backup[]): Ops {
  const rootOf = (repo: string) => roots.get(repo)!;
  const find = (repo: string, name: string) => projectStatus(rootOf(repo)).find((s) => s.name === name);
  const info = new Map<string, RepoInfo>();

  /** A change, asking before adding links in folders git tracks. */
  const withLinks = (c: Change, repo: string, name: string): Result => {
    if (!c.blocked?.length) return said(c, repo);
    return { message: said(c, repo), then: allowTracked(repo, name, c.blocked) };
  };
  const allowTracked = (repo: string, name: string, blocked: string[]): Fix => ({
    label: `Also link it in ${blocked.join(", ")}`,
    preview: `${blocked.join(", ")} is committed in ${repo}: the links will show in git status. skilllib remembers this for ${repo}.`,
    run: (w) => {
      allowTrackedLinks(rootOf(repo));
      return w.ops.link(repo, name, true);
    },
  });
  /** Local edits in the way: offer to go ahead and lose them. */
  const orForce = (c: Change, repo: string, label: string, force: () => Change): Result =>
    c.action === "skipped" && c.reason?.includes("edits")
      ? { message: said(c, repo), then: { label, preview: `Your edits to ${c.name} in ${repo} are lost.`, run: () => said(force(), repo) } }
      : said(c, repo);
  const toLibrary = (path: string) => {
    const r = importSkill(path, { force: true });
    return r.status === "unchanged" ? `${r.name} is already the same in your library` : `${r.name} v${latestVersion(r.name)?.version} is in your library`;
  };

  return {
    add: (repo, name) => withLinks(addSkill(rootOf(repo), name), repo, name),
    remove: (repo, name) => {
      const s = find(repo, name);
      if (!s) return `${name} isn't in ${repo}`;
      if (s.state.startsWith("repo skill")) return `${name} is the repo's own (committed by your team): skilllib doesn't delete it`;
      if (!s.managed) return (removeUntracked(rootOf(repo), name, s.path), `Removed ${name} from ${repo} (in Settings › Backups)`);
      return orForce(removeSkill(rootOf(repo), name), repo, "Remove it anyway", () => removeSkill(rootOf(repo), name, { force: true }));
    },
    restore: (repo, name) => {
      const c = syncProject(rootOf(repo)).find((x) => x.name === name);
      return c ? said(c, repo) : `${name} is already in place`;
    },
    update: (repo, name) => {
      const c = updateProject(rootOf(repo), [name])[0];
      return c ? orForce(c, repo, "Update anyway", () => updateProject(rootOf(repo), [name], { force: true })[0]!) : `${name} is up to date`;
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
      const s = find(repo, name)!;
      const r = s.managed ? relinkDependency(rootOf(repo), name, { allowTracked: allow }) : linkEverywhere(rootOf(repo), name, s.location, { allowTracked: allow });
      const message = r.created.length ? `${name}: linked in ${r.created.join(", ")}` : `${name}: nothing to link`;
      return r.blocked.length && !allow ? { message, then: allowTracked(repo, name, r.blocked) } : message;
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
      const message = r.applied.length ? `${name}: ${steps(r.applied)}` : `${name}: nothing changed yet`;
      if (!r.held.length) return message;
      return {
        message,
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
      return r.ok ? `${m.name} no longer loads globally (in Settings › Backups)` : `${m.name}: ${r.reason}`;
    },
    deleteGlobal: (m) => {
      const r = deleteGlobal(m.path, m.links);
      return r.ok ? (m.broken ? `Removed the broken link ${m.name}` : `Deleted ${m.name} (in Settings › Backups)`) : `${m.name}: ${r.reason}`;
    },
    keepGlobal: (name, keep) => (setKeepGlobal([name], keep), keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`),
    moveGlobal: (m, repos, group) => {
      // Your library already has a different skill by that name: moving this one would swap in the other.
      if (importSkill(m.path).status === "exists") return `${m.name}: your library has a different ${m.name}; nothing moved (update your library from this copy first)`;
      if (group) recordOrigin(m.name, `group: ${group}`);
      const results = repos.map((r) => [r, addSkill(rootOf(r), m.name)] as const);
      const skipped = results.filter(([, c]) => c.action === "skipped");
      // Only stop loading it globally once every repo you picked has it.
      if (skipped.length)
        return `${m.name}: not added to ${skipped.map(([r, c]) => `${r} (${c.reason})`).join(", ")}, so it still loads globally`;
      const blocked = results.filter(([, c]) => c.blocked?.length).map(([r]) => r);
      const r = unloadGlobal(m.path, m.links);
      if (!r.ok) return `${m.name}: ${r.reason}`;
      return `${m.name} now loads only in ${repos.join(", ")}${blocked.length ? ` (some agents can't see it in ${blocked.join(", ")}: git tracks the folder)` : ""}`;
    },
    createSkill: (name) => {
      const r = createSkill(name, "");
      return r.ok ? `Created ${name} in your library: edit its SKILL.md from Your skills` : `${name}: ${r.reason}`;
    },
    replacePlugin: (id, repos) => {
      const skills = machineSkills().filter((s) => s.kind === "plugin" && s.origin === id && !s.broken);
      // Copies in (recording "plugin: <id>" as their origin); a different library skill by the same name stops it.
      const clashes = skills.filter((s) => importSkill(s.path).status === "exists").map((s) => s.name);
      if (clashes.length) return `${id} kept: your library has different ${clashes.join(", ")}; update or delete ${clashes.length === 1 ? "it" : "them"} first`;
      const skipped = repos.flatMap((r) => skills.flatMap((s) => {
        const c = addSkill(rootOf(r), s.name);
        return c.action === "skipped" ? [`${s.name} in ${r} (${c.reason})`] : [];
      }));
      // Only remove the plugin once every repo you picked has its skills.
      if (skipped.length) return `${id} kept: not added ${skipped.join(", ")}`;
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
        return `${copied}; couldn't turn ${id} off (${why}; ${(e as Error).message}): turn it off with /plugin`;
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
      if (!r.ok) return `${name}: ${r.reason}`;
      return `Deleted ${name} from your library${from.length ? ` and from ${from.join(", ")}` : ""} (in Settings › Backups)`;
    },
    restoreBackup: (i) => {
      const b = backups[i]!;
      const r = b.kind === "plugin" ? restorePlugin(b) : restoreBackup(b);
      return r.ok ? `Restored ${b.name} to ${tildify(r.to)}` : `${b.name}: ${r.reason}`;
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
