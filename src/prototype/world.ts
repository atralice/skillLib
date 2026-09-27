/**
 * Prototype of the redesigned TUI: an in-memory world (no disk access), the
 * skills each project can use, their health issues, and the fixes. Fixes
 * mutate the world; the UI keeps snapshots for undo.
 */
import type { HarnessId } from "../harnesses.js";

export type Source = "lib" | "repo" | "untracked" | "global" | "plugin" | "claude.ai" | "cursor";
export type Filter = "all" | "local" | "global" | "plugins" | "vendor";

export type LocalSkill = {
  name: string;
  source: "lib" | "repo" | "untracked";
  /** Folder with the real copy. */
  dir: ".claude/skills" | ".agents/skills";
  /** Also linked into the other folder, so every agent sees it. */
  linked: boolean;
  version?: number;
  edited?: boolean;
  missing?: boolean;
  git: "committed" | "ignored" | "new";
};

export type MachineSkill = {
  name: string;
  source: "global" | "plugin" | "claude.ai" | "cursor";
  /** Global folder, or plugin id for plugins. */
  where: string;
  kept?: boolean;
  broken?: boolean;
};

export type LibrarySkill = { name: string; description: string; latest: number };
export type Project = {
  name: string;
  path: string;
  /** Git remote, e.g. "github.com/atralice/web-app"; absent when there's none. */
  remote?: string;
  branch: string;
  /** Uncommitted files. */
  dirty: number;
  manifest: "committed" | "changed" | "none";
  skills: LocalSkill[];
  disabledPlugins: string[];
};
export type Backup = { name: string; from: string; at: string; skill: MachineSkill };

export type World = {
  agents: HarnessId[];
  projects: Project[];
  machine: MachineSkill[];
  library: LibrarySkill[];
  /** Uses in the last 30 days, per project, per skill. */
  usage: Record<string, Record<string, number>>;
  descriptions: Record<string, string>;
  backups: Backup[];
  /** Plugins you turned off everywhere, with their skills, so Settings can turn them back on. */
  pluginsOff: { id: string; skills: MachineSkill[] }[];
};

/** One skill as a project sees it. */
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
  run: (w: World) => string;
  /** Opens the repo picker; called with the repos you tick. */
  pickRepos?: (w: World, repos: string[]) => string;
  /** Repos the picker offers (default: all). */
  candidates?: (w: World) => string[];
};
export type Issue = {
  id: string;
  severity: Severity;
  title: string;
  /** Decisions never run from "fix all"; the first fix of an automatic issue is the recommended one. */
  decision: boolean;
  fixes: Fix[];
};

export const SEVERITY_RANK: Record<Severity, number> = { problem: 0, warning: 1, hint: 2 };

// ─── Where agents look ──────────────────────────────────

const READS_CLAUDE: HarnessId[] = ["claude-code", "cursor"];
const READS_AGENTS: HarnessId[] = ["cursor", "codex", "zed"];

function localAgents(s: LocalSkill, enabled: HarnessId[]): HarnessId[] {
  if (s.missing) return [];
  const reads = new Set([...(s.dir === ".claude/skills" || s.linked ? READS_CLAUDE : []), ...(s.dir === ".agents/skills" || s.linked ? READS_AGENTS : [])]);
  return enabled.filter((a) => reads.has(a));
}

export function machineAgents(m: MachineSkill, enabled: HarnessId[]): HarnessId[] {
  if (m.broken) return [];
  const reads: HarnessId[] =
    m.source === "global" ? (m.where === "~/.agents/skills" ? READS_AGENTS : READS_CLAUDE) : m.source === "cursor" ? ["cursor"] : ["claude-code"];
  return enabled.filter((a) => reads.includes(a));
}

export function filterOf(source: Source): Exclude<Filter, "all"> {
  return source === "lib" || source === "repo" || source === "untracked" ? "local" : source === "global" ? "global" : source === "plugin" ? "plugins" : "vendor";
}

export function project(w: World, name: string): Project {
  return w.projects.find((p) => p.name === name)!;
}

export function totalUses(w: World, name: string): number {
  return Object.values(w.usage).reduce((n, u) => n + (u[name] ?? 0), 0);
}

/**
 * Uses per day over the last 30 days (index 29 = today). The sample data only has 30-day totals,
 * so each repo's total is spread over the days deterministically, weighted toward recent days;
 * the real app reads the days from Claude Code's transcripts.
 */
export function dailyUses(w: World, name: string, onlyRepo?: string): number[] {
  const days = new Array<number>(30).fill(0);
  for (const [repo, counts] of Object.entries(w.usage)) {
    if (onlyRepo && repo !== onlyRepo) continue;
    let seed = [...(name + repo)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0x7fffffff, 7);
    for (let n = counts[name] ?? 0; n > 0; n--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = seed / 0x7fffffff;
      days[Math.floor(29 - 29 * r * r)]! += 1;
    }
  }
  return days;
}

/** Adds a brand-new skill to your library as v1. */
export function createSkill(w: World, name: string) {
  w.descriptions[name] = "New skill: say when an agent should use it.";
  w.library.push({ name, description: w.descriptions[name], latest: 1 });
}

/** Everything agents can use in a project: its own skills plus what loads everywhere. */
export function usable(w: World, projectName: string): Usable[] {
  const p = project(w, projectName);
  const uses = (n: string) => w.usage[projectName]?.[n] ?? 0;
  return [
    ...p.skills.map((s): Usable => ({ name: s.name, source: s.source, where: s.dir, agents: localAgents(s, w.agents), uses: uses(s.name), local: s })),
    ...w.machine
      .filter((m) => !(m.source === "plugin" && p.disabledPlugins.includes(m.where)))
      .filter((m) => m.source !== "cursor" || w.agents.includes("cursor"))
      .map((m): Usable => ({ name: m.name, source: m.source, where: m.where, agents: machineAgents(m, w.agents), uses: uses(m.name), machine: m })),
  ];
}

// ─── Mutations (each returns what happened) ─────────────

function lib(w: World, name: string): LibrarySkill | undefined {
  return w.library.find((l) => l.name === name);
}

export function importToLibrary(w: World, name: string) {
  if (!lib(w, name)) w.library.push({ name, description: w.descriptions[name] ?? "", latest: 1 });
}

function removeMachine(w: World, m: MachineSkill, why: string): string {
  w.machine = w.machine.filter((x) => x !== m);
  w.backups.unshift({ name: m.name, from: `${m.where}/${m.name}`, at: new Date().toTimeString().slice(0, 5), skill: m });
  return why;
}

export function addToProject(w: World, projectName: string, name: string): string {
  const p = project(w, projectName);
  p.skills = p.skills.filter((s) => s.name !== name);
  p.skills.push({ name, source: "lib", dir: ".claude/skills", linked: true, version: lib(w, name)?.latest ?? 1, git: "ignored" });
  return `Added ${name} to ${projectName}`;
}

export function removeFromProject(w: World, projectName: string, name: string): string {
  const p = project(w, projectName);
  p.skills = p.skills.filter((s) => s.name !== name);
  return `Removed ${name} from ${projectName}`;
}

export function moveGlobalToRepos(w: World, m: MachineSkill, repos: string[]): string {
  importToLibrary(w, m.name);
  for (const r of repos) addToProject(w, r, m.name);
  removeMachine(w, m, "");
  return `${m.name} now loads only in ${repos.length ? repos.join(", ") : "no repo"} (original backed up)`;
}

// ─── Health ─────────────────────────────────────────────

/** What you can do with one of your global skills. */
export function globalFixes(m: MachineSkill): Fix[] {
  const find = (w: World) => w.machine.find((x) => x.name === m.name && x.source === "global")!;
  return [
    {
      label: "Move it to the repos that need it…",
      preview: `Pick repos. ${m.name} goes into your library and those repos, and stops loading globally (original backed up).`,
      run: () => "",
      pickRepos: (w, repos) => moveGlobalToRepos(w, find(w), repos),
    },
    m.kept
      ? { label: "Stop marking it as global on purpose", preview: `skilllib warns about ${m.name} again, like any global skill.`, run: (w) => ((find(w).kept = false), `${m.name} is no longer marked as global on purpose`) }
      : { label: "Keep it global on purpose", preview: `Mark ${m.name} as global on purpose. skilllib stops warning about it.`, run: (w) => ((find(w).kept = true), `${m.name} marked as global on purpose`) },
    { label: "Delete it", preview: `Remove ${m.where}/${m.name}. A backup is kept in Settings › Backups.`, run: (w) => removeMachine(w, find(w), `Deleted ${m.name} (backed up)`) },
  ];
}

export function pluginOffHere(plugin: string, projectName: string): Fix {
  return {
    label: `Turn off ${plugin} in this repo only`,
    preview: `Write "${plugin}": false to ${projectName}/.claude/settings.local.json. Your other repos keep the plugin.`,
    run: (w) => (project(w, projectName).disabledPlugins.push(plugin), `${plugin} turned off in ${projectName}`),
  };
}

/**
 * What Global offers for a skill beyond its issues. Everything acts on the machine-wide copy;
 * the only thing that reaches repos is "Move it to the repos…", and only the repos you tick.
 */
export function machineActions(m: MachineSkill): Fix[] {
  if (m.broken) return []; // its issue already offers "Remove the link"
  if (m.source === "global") return globalFixes(m);
  if (m.source === "plugin")
    return [
      {
        label: `Turn off ${m.where} everywhere`,
        preview: `Write "${m.where}": false to ~/.claude/settings.json. Its skills stop loading in every repo; Settings can turn it back on.`,
        run: (w) => {
          w.pluginsOff.push({ id: m.where, skills: w.machine.filter((x) => x.source === "plugin" && x.where === m.where) });
          w.machine = w.machine.filter((x) => !(x.source === "plugin" && x.where === m.where));
          return `${m.where} turned off everywhere`;
        },
      },
    ];
  return [];
}

function unreviewedGlobal(m: MachineSkill): Issue {
  return { id: `global:${m.name}`, severity: "warning", title: "Global, not reviewed: loads in every repo", decision: true, fixes: globalFixes(m) };
}

/** Issues on skills that load everywhere, independent of any project. */
export function machineIssues(w: World, m: MachineSkill): Issue[] {
  const issues: Issue[] = [];
  if (m.broken) {
    issues.push({
      id: `broken:${m.name}`,
      severity: "problem",
      title: "Broken link: points at a folder that no longer exists",
      decision: false,
      fixes: [{ label: "Remove the link", preview: `Remove ${m.where}/${m.name}.`, run: (w) => removeMachine(w, w.machine.find((x) => x === m || (x.name === m.name && x.broken))!, `Removed broken link ${m.name}`) }],
    });
    return issues;
  }
  const plugin = w.machine.find((x) => x.source === "plugin" && x.name === m.name);
  if (m.source === "global" && plugin) {
    issues.push({
      id: `dup-plugin:${m.name}`,
      severity: "problem",
      title: `Loaded twice: also in plugin ${plugin.where}`,
      decision: false,
      fixes: [
        {
          label: "Keep the plugin's copy, stop loading yours globally",
          preview: `Import ${m.name} into your library, then remove ${m.where}/${m.name} (backed up).`,
          run: (w) => {
            importToLibrary(w, m.name);
            return removeMachine(w, w.machine.find((x) => x.name === m.name && x.source === "global")!, `${m.name} now loads once, from the plugin`);
          },
        },
      ],
    });
  }
  if (m.source === "global" && !m.kept) issues.push(unreviewedGlobal(m));
  return issues;
}

/** Issues for one skill as seen from a project. */
export function issuesOf(w: World, projectName: string, u: Usable): Issue[] {
  const all = usable(w, projectName);
  if (u.machine) {
    const issues = machineIssues(w, u.machine);
    // A local copy of the same skill: the fix lives on the local row.
    if (u.source === "global" && all.some((x) => x.local && x.name === u.name))
      issues.unshift({ id: `twice-g:${u.name}`, severity: "problem", title: "Loaded twice: this repo has its own copy", decision: false, fixes: [] });
    if (u.source === "plugin" && all.some((x) => x.local && x.name === u.name))
      issues.unshift({ id: `twice-p:${u.name}`, severity: "problem", title: "Same name as a skill in this repo", decision: false, fixes: [] });
    return issues;
  }
  const s = u.local!;
  const issues: Issue[] = [];
  const p = project(w, projectName);
  const g = w.machine.find((m) => m.source === "global" && m.name === s.name && !m.broken);
  const plugin = w.machine.find((m) => m.source === "plugin" && m.name === s.name && !p.disabledPlugins.includes(m.where));
  const l = lib(w, s.name);

  if (s.missing)
    issues.push({
      id: `missing:${s.name}`,
      severity: "problem",
      title: "Listed in skilllib.json but the folder is missing",
      decision: false,
      fixes: [{ label: "Restore it (sync)", preview: `Reinstall ${s.name} v${s.version} into ${s.dir}.`, run: () => ((s.missing = false), `Restored ${s.name}`) }],
    });
  if (g) {
    issues.push({
      id: `twice-g:${s.name}`,
      severity: "problem",
      title: `Loaded twice: also global in ${g.where}`,
      decision: false,
      fixes: [
        {
          label: "Keep this repo's copy, stop loading it globally",
          preview: `Import ${s.name} into your library if needed, then remove ${g.where}/${s.name} (backed up). Other repos stop seeing it.`,
          run: (w) => {
            importToLibrary(w, s.name);
            return removeMachine(w, w.machine.find((m) => m.source === "global" && m.name === s.name)!, `${s.name} now loads once here, and no longer globally`);
          },
        },
        ...(s.source !== "repo"
          ? [{ label: "Keep it global, remove it from this repo", preview: `Delete ${s.dir}/${s.name} in ${projectName}.`, run: (w: World) => removeFromProject(w, projectName, s.name) }]
          : []),
      ],
    });
  }
  if (plugin)
    issues.push({
      id: `twice-p:${s.name}`,
      severity: "problem",
      title: `Same name as a skill in plugin ${plugin.where}`,
      decision: true,
      fixes: [
        ...(s.source !== "repo"
          ? [{ label: "Remove this repo's copy, use the plugin's", preview: `Delete ${s.dir}/${s.name} in ${projectName}.`, run: (w: World) => removeFromProject(w, projectName, s.name) }]
          : []),
        pluginOffHere(plugin.where, projectName),
      ],
    });
  if (s.source === "lib" && s.edited)
    issues.push({
      id: `edited:${s.name}`,
      severity: "warning",
      title: `Edited here: differs from library v${s.version}`,
      decision: true,
      fixes: [
        {
          label: `Save as v${(l?.latest ?? 0) + 1} in your library`,
          preview: `Your library gets v${(l?.latest ?? 0) + 1} with these edits. Other repos can update to it.`,
          run: (w) => {
            const ll = lib(w, s.name)!;
            ll.latest += 1;
            s.version = ll.latest;
            s.edited = false;
            return `${s.name} v${ll.latest} saved to your library`;
          },
        },
        { label: "Discard the edits", preview: `Replace ${s.dir}/${s.name} with library v${s.version} (edits backed up).`, run: () => ((s.edited = false), `${s.name} reset to v${s.version}`) },
      ],
    });
  if (s.source === "lib" && l && s.version! < l.latest && !s.edited)
    issues.push({
      id: `outdated:${s.name}`,
      severity: "warning",
      title: `Update available: v${s.version} → v${l.latest}`,
      decision: false,
      fixes: [{ label: `Update to v${l.latest}`, preview: `Replace ${s.dir}/${s.name} with library v${l.latest}.`, run: (w) => ((s.version = lib(w, s.name)!.latest), `${s.name} updated to v${s.version}`) }],
    });
  const blind = w.agents.filter((a) => !u.agents.includes(a));
  if (!s.missing && blind.length)
    issues.push({
      id: `blind:${s.name}`,
      severity: "warning",
      title: `${blind.map(agentName).join(", ")} can't see it`,
      decision: false,
      fixes: [
        {
          label: `Link it into ${s.dir === ".claude/skills" ? ".agents/skills" : ".claude/skills"}`,
          preview: `Add a link (nothing is copied or moved), so ${blind.map(agentName).join(", ")} load it too.`,
          run: () => ((s.linked = true), `${s.name} is now visible to every agent`),
        },
      ],
    });
  if (s.source === "untracked" && l)
    issues.push({
      id: `adopt:${s.name}`,
      severity: "hint",
      title: "Same as your library skill, but not tracked",
      decision: false,
      fixes: [{ label: "Track it", preview: `Record ${s.name} v${l.latest} in skilllib.json so library updates reach it.`, run: () => ((s.source = "lib"), (s.version = l.latest), `${s.name} is tracked`) }],
    });
  if (s.source === "untracked" && !l && !plugin)
    issues.push({
      id: `local:${s.name}`,
      severity: "hint",
      title: "Only exists in this repo",
      decision: false,
      fixes: [
        {
          label: "Import it into your library",
          preview: `Copy ${s.name} into your library as v1 and track it here, so other repos can use it.`,
          run: (w) => (importToLibrary(w, s.name), (s.source = "lib"), (s.version = 1), `${s.name} imported and tracked`),
        },
      ],
    });
  if (s.source === "lib" && u.uses === 0 && !s.missing)
    issues.push({
      id: `unused:${s.name}`,
      severity: "hint",
      title: "Not used here in 30 days",
      decision: true,
      fixes: [{ label: "Remove it from this repo", preview: `Delete ${s.dir}/${s.name} in ${projectName}. Your library keeps it.`, run: (w) => removeFromProject(w, projectName, s.name) }],
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

export function projectIssues(w: World, projectName: string): { skill: Usable; issue: Issue }[] {
  return usable(w, projectName).flatMap((u) => issuesOf(w, projectName, u).map((issue) => ({ skill: u, issue })));
}

export function agentName(id: HarnessId): string {
  return { "claude-code": "Claude Code", cursor: "Cursor", codex: "Codex", zed: "Zed" }[id];
}

// ─── Adding skills ──────────────────────────────────────

/** Substring, or word initials ("cfw" → cloudflare-workers). */
export function matches(name: string, query: string): boolean {
  const q = query.toLowerCase();
  return name.toLowerCase().includes(q) || name.split(/[-_.]/).map((w) => w[0] ?? "").join("").startsWith(q);
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
  run?: (w: World) => string;
};

/**
 * The add box for `target` (a repo, or your library when null): library skills the repo
 * doesn't have yet, then "create" and "write with an agent" for the name you typed.
 * Only the library for now; GitHub and skills.sh come later.
 */
export function addRows(w: World, target: string | null, q: string): AddRow[] {
  const taken = new Set(target ? usable(w, target).map((u) => u.name) : []);
  const hit = (name: string, description: string) => !q || matches(name, q) || (q.length >= 3 && description.toLowerCase().includes(q));
  const library: AddRow[] = target
    ? w.library
        .filter((l) => !taken.has(l.name) && hit(l.name, l.description))
        .map((l) => ({ key: `lib:${l.name}`, name: l.name, note: `v${l.latest}`, description: l.description, run: (w) => addToProject(w, target, l.name) }))
    : [];
  const exists = q !== "" && (taken.has(q) || w.library.some((l) => l.name === q));
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
            createSkill(w, q);
            if (target) addToProject(w, target, q);
            return `Created ${q} v1${target ? ` in ${target}` : ""} (its SKILL.md would open in your editor)`;
          },
        },
        { key: "agent", agent: true, name: q ? `✦ Write "${q}" with an agent` : "✦ Write a new skill with an agent", note: "", description: "" },
      ];
  const group = (title: string, rows: AddRow[]): AddRow[] => (rows.length ? [{ key: `#${title}`, header: title, name: "", note: "", description: "" }, ...rows] : []);
  return [...group("Your library", library), ...group("New", fresh)];
}

// ─── Sample data ────────────────────────────────────────

export function sampleWorld(): World {
  const emptyRepos = ["billing", "blog", "cli-tools", "dotfiles", "design-system", "e2e-tests", "infra", "landing", "marketing-site", "playground", "scripts", "status-page"];
  return {
    agents: ["claude-code", "cursor", "codex"],
    projects: [
      {
        name: "web-app",
        remote: "github.com/atralice/web-app", branch: "main", dirty: 0, manifest: "committed",
        path: "~/Projects/web-app",
        disabledPlugins: [],
        skills: [
          { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: false, version: 2, git: "ignored" },
          { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 1, git: "ignored" },
          { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, edited: true, git: "ignored" },
          { name: "seo-meta", source: "lib", dir: ".claude/skills", linked: true, version: 1, missing: true, git: "ignored" },
          { name: "testing-guide", source: "lib", dir: ".claude/skills", linked: true, version: 3, git: "ignored" },
          { name: "deploy-preview", source: "repo", dir: ".agents/skills", linked: false, git: "committed" },
          { name: "release-notes", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
          { name: "my-scratchpad", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
          { name: "vercel-deploy", source: "untracked", dir: ".claude/skills", linked: true, git: "new" },
        ],
      },
      {
        name: "api-server",
        remote: "github.com/atralice/api-server", branch: "feat/webhooks", dirty: 3, manifest: "changed",
        path: "~/Projects/api-server",
        disabledPlugins: [],
        skills: [
          { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: true, version: 2, git: "ignored" },
          { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, git: "ignored" },
          { name: "db-seed", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
        ],
      },
      {
        name: "docs-site",
        remote: "github.com/atralice/docs-site", branch: "main", dirty: 0, manifest: "none",
        path: "~/Projects/docs-site",
        disabledPlugins: [],
        skills: [
          { name: "writing-style", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
          { name: "mdx-tips", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
        ],
      },
      {
        name: "mobile-app",
        remote: "github.com/atralice/mobile-app", branch: "main", dirty: 1, manifest: "committed",
        path: "~/Projects/mobile-app",
        disabledPlugins: [],
        skills: [
          { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 2, git: "ignored" },
          { name: "expo-release", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        ],
      },
      ...emptyRepos.map((name): Project => ({
        name,
        path: `~/Projects/${name}`,
        ...(name === "dotfiles" ? {} : { remote: `github.com/atralice/${name}` }),
        branch: "main",
        dirty: 0,
        manifest: "none",
        disabledPlugins: [],
        skills: [],
      })),
    ],
    machine: [
      { name: "commit-style", source: "global", where: "~/.claude/skills" },
      { name: "stripe-payments", source: "global", where: "~/.claude/skills" },
      { name: "tailwind-tips", source: "global", where: "~/.agents/skills" },
      { name: "frontend-design", source: "global", where: "~/.claude/skills" },
      { name: "pr-review", source: "global", where: "~/.claude/skills", kept: true },
      { name: "old-helper", source: "global", where: "~/.claude/skills", broken: true },
      { name: "vercel-deploy", source: "plugin", where: "vercel@claude-plugins-official" },
      { name: "vercel-env", source: "plugin", where: "vercel@claude-plugins-official" },
      { name: "nextjs", source: "plugin", where: "vercel@claude-plugins-official" },
      { name: "frontend-design", source: "plugin", where: "frontend-design@claude-plugins-official" },
      { name: "use-railway", source: "plugin", where: "railway@claude-plugins-official" },
      { name: "brand-voice", source: "claude.ai", where: "claude.ai account" },
      { name: "pdf", source: "claude.ai", where: "claude.ai account" },
      { name: "create-rule", source: "cursor", where: "Cursor built-in" },
    ],
    library: [
      { name: "stripe-payments", description: "", latest: 2 },
      { name: "react-patterns", description: "", latest: 2 },
      { name: "api-conventions", description: "", latest: 1 },
      { name: "seo-meta", description: "", latest: 1 },
      { name: "testing-guide", description: "", latest: 3 },
      { name: "mdx-tips", description: "", latest: 1 },
      { name: "sql-migrations", description: "", latest: 1 },
    ].map((l) => ({ ...l, description: DESCRIPTIONS[l.name] ?? "" })),
    usage: {
      "web-app": { "stripe-payments": 11, "react-patterns": 9, "api-conventions": 6, "deploy-preview": 4, "release-notes": 2, "commit-style": 8, "vercel-deploy": 3, nextjs: 5, "pr-review": 4 },
      "api-server": { "stripe-payments": 3, "api-conventions": 7, "commit-style": 5, "use-railway": 2 },
      "docs-site": { "writing-style": 6, "mdx-tips": 1, "brand-voice": 2 },
      "mobile-app": { "react-patterns": 2, "commit-style": 1 },
    },
    descriptions: DESCRIPTIONS,
    backups: [],
    pluginsOff: [],
  };
}

const DESCRIPTIONS: Record<string, string> = {
  "stripe-payments": "Stripe Checkout, Payment Links, webhooks and subscriptions with trials and proration.",
  "react-patterns": "Component patterns for React 19: composition, server components, suspense boundaries.",
  "api-conventions": "Our REST conventions: resource naming, pagination, error shapes, idempotency keys.",
  "seo-meta": "Page titles, Open Graph and structured data for marketing pages.",
  "testing-guide": "How we write unit and e2e tests: fixtures, factories, Playwright selectors.",
  "deploy-preview": "Deploy a preview environment for a branch and post the URL to the PR.",
  "release-notes": "Write release notes from merged PRs in the team's voice.",
  "my-scratchpad": "Personal notes and snippets for this repo.",
  "vercel-deploy": "Deploy this app to Vercel with the right env and region.",
  "writing-style": "Docs voice and tone: short sentences, second person, no marketing words.",
  "mdx-tips": "MDX components and frontmatter used across the docs site.",
  "sql-migrations": "Write reversible SQL migrations and backfills safely.",
  "db-seed": "Seed a local Postgres with realistic fixtures for the API.",
  "expo-release": "Ship an Expo build to TestFlight and the Play Store.",
  "commit-style": "Conventional commits with a short imperative subject and a why-focused body.",
  "tailwind-tips": "Tailwind v4 utilities, theming with CSS variables, container queries.",
  "frontend-design": "Distinctive, production-grade frontend design that avoids generic AI aesthetics.",
  "pr-review": "Review a pull request for correctness, tests and naming before merge.",
  "old-helper": "",
  "vercel-env": "Manage Vercel environment variables.",
  nextjs: "Next.js App Router guidance.",
  "use-railway": "Operate Railway infrastructure.",
  "brand-voice": "Write in the company's brand voice.",
  pdf: "Read, create and edit PDF files.",
  "create-rule": "Create a Cursor rule from a conversation.",
};
