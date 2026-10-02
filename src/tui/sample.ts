/**
 * Sample data for tests and headless screen checks: a few repos, a library and what loads
 * everywhere, held in memory. Its ops change it in place; `reload()` hands back a fresh copy.
 */
import { harness, type HarnessId } from "../harnesses.js";
import type { LocalSkill, MachineSkill, Ops, Plugin, Project, RepoInfo, World } from "./world.js";

const READS_CLAUDE: HarnessId[] = ["claude-code", "cursor", "grok"];
const READS_AGENTS: HarnessId[] = ["cursor", "codex", "zed", "grok"];

/** Sample skills remember whether they're linked into the other folder, to work out which agents see them. */
type SampleSkill = LocalSkill & { linked: boolean };

function localAgents(s: SampleSkill, enabled: HarnessId[]): HarnessId[] {
  if (s.missing) return [];
  const reads = new Set([...(s.dir === ".claude/skills" || s.linked ? READS_CLAUDE : []), ...(s.dir === ".agents/skills" || s.linked ? READS_AGENTS : [])]);
  return enabled.filter((a) => reads.has(a));
}

const GLOBAL_READERS: Record<string, HarnessId[]> = {
  "~/.agents/skills": READS_AGENTS,
  "~/.codex/skills": ["codex", "cursor"],
  "~/.grok/skills": ["grok"],
};

const VENDOR_READERS: Record<Exclude<MachineSkill["source"], "global" | "skilllib">, HarnessId[]> = {
  cursor: ["cursor"],
  grok: ["grok"],
  plugin: ["claude-code", "cursor"],
  "claude.ai": READS_CLAUDE,
  system: READS_CLAUDE,
};

function machineAgents(m: MachineSkill, enabled: HarnessId[]): HarnessId[] {
  if (m.broken) return [];
  // skilllib's own skill: in ~/.claude/skills with a link in ~/.agents/skills, so every agent.
  if (m.source === "skilllib") return enabled;
  const reads = m.source === "global" ? (GLOBAL_READERS[m.where] ?? READS_CLAUDE) : VENDOR_READERS[m.source];
  return enabled.filter((a) => reads.includes(a));
}

type Skill = Omit<SampleSkill, "path" | "agents">;
const repo = (name: string, manifest: Project["manifest"], skills: Skill[]): Project => ({
  name,
  path: `~/Projects/${name}`,
  manifest,
  skills: skills.map((s) => ({ ...s, path: `~/Projects/${name}/${s.dir}/${s.name}`, agents: [] })),
});
const machine = (name: string, source: MachineSkill["source"], where: string, extra: Partial<MachineSkill> = {}): MachineSkill => ({
  name,
  source,
  where,
  path: source === "global" || source === "skilllib" ? `${where}/${name}` : where,
  links: [],
  agents: [],
  ...extra,
});

const plugin = (id: string, scope: string, skills: string[], extra: Partial<Plugin> = {}): Plugin => ({
  key: `${id}|${scope}|${extra.repo ?? ""}`,
  id,
  agent: scope === "cursor" ? "cursor" : "claude-code",
  scope,
  on: scope === "cursor" ? null : true,
  description: "",
  path: `~/.claude/plugins/cache/${id.split("@")[1]}/${id.split("@")[0]}`,
  skills: skills.map((name) => ({ name, path: `~/.claude/plugins/cache/${id.split("@")[1]}/${id.split("@")[0]}/skills/${name}` })),
  parts: [],
  ...extra,
});

/**
 * Uses per day from 30-day totals: each repo's total spread deterministically, weighted toward
 * recent days. The real app reads the days from Claude Code's transcripts.
 */
function spread(usage: World["usage"]): NonNullable<World["days"]> {
  return Object.fromEntries(
    Object.entries(usage).map(([repo, counts]) => [
      repo,
      Object.fromEntries(
        Object.entries(counts).map(([name, total]) => {
          const days = new Array<number>(30).fill(0);
          let seed = [...(name + repo)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0x7fffffff, 7);
          for (let n = total; n > 0; n--) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            const r = seed / 0x7fffffff;
            days[Math.floor(29 - 29 * r * r)]! += 1;
          }
          return [name, days];
        }),
      ),
    ]),
  );
}

export function sampleWorld(): World {
  const emptyRepos = ["billing", "blog", "cli-tools", "dotfiles", "design-system", "e2e-tests", "infra", "landing", "marketing-site", "playground", "scripts", "status-page"];
  const usage: World["usage"] = {
    "web-app": { "stripe-payments": 11, "react-patterns": 9, "api-conventions": 6, "deploy-preview": 4, "release-notes": 2, "commit-style": 8, "vercel-deploy": 3, "vercel:nextjs": 5, "pr-review": 4 },
    "api-server": { "stripe-payments": 3, "api-conventions": 7, "commit-style": 5, "railway:use-railway": 2 },
    "docs-site": { "writing-style": 6, "mdx-tips": 1, "brand-voice": 2 },
    "mobile-app": { "react-patterns": 2, "commit-style": 1 },
  };
  const info: Record<string, RepoInfo> = {
    "web-app": { remote: "github.com/atralice/web-app", branch: "main", dirty: 0 },
    "api-server": { remote: "github.com/atralice/api-server", branch: "feat/webhooks", dirty: 3 },
    "docs-site": { remote: "github.com/atralice/docs-site", branch: "main", dirty: 0 },
    "mobile-app": { remote: "github.com/atralice/mobile-app", branch: "main", dirty: 1 },
  };
  const w: World = {
    agents: ["claude-code", "cursor", "codex"],
    cwd: "web-app",
    projects: [
      repo("web-app", "committed", [
        { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: false, version: 2, library: "same", git: "ignored" },
        { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 1, library: "same", git: "ignored", cursorPlugin: "react-kit" },
        { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, edited: true, library: "same", git: "ignored" },
        { name: "seo-meta", source: "lib", dir: ".claude/skills", linked: true, version: 1, missing: true, library: "same", git: "ignored" },
        {
          name: "testing-guide",
          source: "lib",
          dir: ".claude/skills",
          linked: true,
          version: 3,
          library: "same",
          git: "ignored",
          dupes: { steps: [".agents/skills/testing-guide: duplicate copy → link"], git: [".agents/skills/testing-guide: duplicate copy → link"] },
        },
        { name: "deploy-preview", source: "repo", dir: ".agents/skills", linked: false, git: "committed" },
        { name: "release-notes", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "my-scratchpad", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
        { name: "vercel-deploy", source: "untracked", dir: ".claude/skills", linked: true, git: "new" },
      ]),
      repo("api-server", "changed", [
        { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: true, version: 2, library: "same", git: "ignored" },
        { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, library: "same", git: "ignored" },
        {
          name: "db-seed",
          source: "untracked",
          dir: ".claude/skills",
          linked: true,
          git: "ignored",
          dupes: {
            steps: [],
            git: [],
            differ: [
              { dir: "~/Projects/api-server/.claude/skills", label: ".claude/skills", runs: ["claude-code", "cursor"], canWin: true },
              { dir: "~/Projects/api-server/.agents/skills", label: ".agents/skills", runs: ["codex"], canWin: true },
            ],
          },
        },
      ]),
      repo("docs-site", "none", [
        { name: "writing-style", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "mdx-tips", source: "untracked", dir: ".claude/skills", linked: true, library: "same", git: "ignored" },
      ]),
      repo("mobile-app", "committed", [
        { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 2, library: "same", git: "ignored" },
        { name: "expo-release", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "pr-review", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
      ]),
      ...emptyRepos.map((name) => repo(name, "none", [])),
    ],
    machine: [
      machine("commit-style", "global", "~/.claude/skills", {
        installed: "2026-09-20 10:00",
        dupes: {
          steps: [],
          git: [],
          differ: [
            { dir: "~/.claude/skills", label: "~/.claude/skills", runs: ["claude-code", "cursor"], canWin: true },
            { dir: "~/.agents/skills", label: "~/.agents/skills", runs: ["codex"], canWin: true },
          ],
        },
      }),
      machine("stripe-payments", "global", "~/.claude/skills", { installed: "2026-09-20 10:00" }),
      machine("tailwind-tips", "global", "~/.agents/skills", { origin: "skills.sh: tailwindlabs/skills", dupes: { steps: ["~/.claude/skills/tailwind-tips: duplicate copy → link"], git: [] } }),
      machine("frontend-design", "global", "~/.claude/skills", { installed: "2026-09-20 10:00" }),
      machine("pr-review", "global", "~/.claude/skills", { kept: true }),
      machine("security-audit", "global", "~/.codex/skills", { installed: "2026-09-22 18:30" }),
      machine("old-helper", "global", "~/.claude/skills", { broken: true }),
      machine("vercel-deploy", "plugin", "vercel@claude-plugins-official"),
      machine("vercel-env", "plugin", "vercel@claude-plugins-official"),
      machine("nextjs", "plugin", "vercel@claude-plugins-official"),
      machine("frontend-design", "plugin", "frontend-design@claude-plugins-official"),
      machine("use-railway", "plugin", "railway@claude-plugins-official"),
      machine("brand-voice", "claude.ai", "claude.ai account"),
      machine("pdf", "claude.ai", "claude.ai account"),
      machine("create-rule", "cursor", "Cursor built-in"),
      machine("skilllib", "skilllib", "~/.claude/skills", { links: ["~/.agents/skills/skilllib"] }),
    ],
    plugins: [
      plugin("vercel@claude-plugins-official", "user", ["vercel-deploy", "vercel-env", "nextjs"], {
        version: "0.50.0",
        update: "0.51.0",
        description: "Build and deploy web apps and agents",
        parts: ["commands", "agents", "hooks", "MCP servers"],
      }),
      plugin("frontend-design@claude-plugins-official", "user", ["frontend-design"], { version: "1.0.0", description: "Frontend design skills" }),
      plugin("railway@claude-plugins-official", "user", ["use-railway"], { version: "1.5.2", description: "Deploy and manage apps on Railway", parts: ["MCP servers"] }),
      plugin("ponytail@ponytail", "user", ["ponytail"], { version: "4.10.0", on: false, description: "The laziest solution that works" }),
      plugin("stripe-tools@acme", "project", ["stripe-payments", "stripe-webhooks"], {
        repo: "api-server",
        projectPath: "~/Projects/api-server",
        version: "2.1.0",
        description: "Stripe helpers for the API team",
        parts: ["MCP servers"],
      }),
      plugin("railway@synced", "claude.ai", ["use-railway"], { version: "1.4.0", on: false, description: "Deploy and manage apps on Railway" }),
      plugin("react-kit@cursor-public", "cursor", ["react-patterns", "react-testing"], { version: "0.3.0", description: "React patterns for Cursor" }),
    ],
    library: [
      { name: "stripe-payments", latest: 2 },
      { name: "react-patterns", latest: 2 },
      { name: "api-conventions", latest: 1 },
      { name: "seo-meta", latest: 1 },
      { name: "testing-guide", latest: 3 },
      { name: "mdx-tips", latest: 1 },
      { name: "sql-migrations", latest: 1 },
    ],
    usage,
    days: spread(usage),
    descriptions: { ...DESCRIPTIONS },
    backups: [],
    roots: ["~/Projects"],
    hidden: [],
    agentsChosen: true,
    agentSkill: "installed",
    ops: undefined as unknown as Ops,
  };
  w.ops = sampleOps(w, info);
  seeAgents(w);
  return w;
}

/** Which agents load each skill, from the folders it's in. */
function seeAgents(w: World) {
  for (const p of w.projects) for (const s of p.skills) s.agents = localAgents(s as SampleSkill, w.agents);
  for (const m of w.machine) m.agents = machineAgents(m, w.agents);
}

function sampleOps(w: World, info: Record<string, RepoInfo>): Ops {
  const removed: MachineSkill[] = [];
  const skill = (repo: string, name: string) => w.projects.find((p) => p.name === repo)!.skills.find((s) => s.name === name) as SampleSkill;
  const lib = (name: string) => w.library.find((l) => l.name === name);
  const toLibrary = (name: string) => {
    const l = lib(name);
    if (l) l.latest += 1;
    else w.library.push({ name, latest: 1 });
  };
  const drop = (m: MachineSkill) => {
    w.machine.splice(w.machine.indexOf(w.machine.find((x) => x.path === m.path && x.source === m.source)!), 1);
    w.backups.unshift({ name: m.name, from: m.path, at: new Date().toTimeString().slice(0, 5) });
    removed.unshift(m);
  };
  const add = (repo: string, name: string) => {
    const p = w.projects.find((x) => x.name === repo)!;
    p.skills = p.skills.filter((s) => s.name !== name);
    const s: SampleSkill = { name, source: "lib", dir: ".claude/skills", path: `${p.path}/.claude/skills/${name}`, linked: true, agents: [], version: lib(name)?.latest ?? 1, library: "same", git: "ignored" };
    p.skills.push(s);
    seeAgents(w);
  };
  const done = (message: string) => (seeAgents(w), message);
  return {
    add: (repo, name) => (add(repo, name), `Added ${name} to ${repo}`),
    addTo: (repos, names) => {
      for (const r of repos) for (const n of names) add(r, n);
      return `Added ${names.length === 1 ? names[0] : `${names.length} skills`} to ${repos.join(", ")}`;
    },
    remove: (repo, name) => {
      const p = w.projects.find((x) => x.name === repo)!;
      p.skills = p.skills.filter((s) => s.name !== name);
      return `Removed ${name} from ${repo}`;
    },
    restore: (repo, name) => ((skill(repo, name).missing = false), done(`Restored ${name}`)),
    update: (repo, name) => ((skill(repo, name).version = lib(name)!.latest), `${name} updated to v${lib(name)!.latest}`),
    saveEdits: (repo, name) => {
      toLibrary(name);
      Object.assign(skill(repo, name), { version: lib(name)!.latest, edited: false });
      return `${name} v${lib(name)!.latest} saved to your library`;
    },
    discardEdits: (repo, name) => (Object.assign(skill(repo, name), { edited: false, source: "lib", version: skill(repo, name).version ?? lib(name)!.latest, library: "same" }), `${name} reset to the library version`),
    link: (repo, name) => ((skill(repo, name).linked = true), done(`${name} is now visible to every agent`)),
    track: (repo, name) => (Object.assign(skill(repo, name), { source: "lib", version: lib(name)!.latest, library: "same" }), `${name} is tracked`),
    importLocal: (repo, name) => (toLibrary(name), Object.assign(skill(repo, name), { source: "lib", version: lib(name)!.latest, library: "same" }), `${name} imported and tracked`),
    copyToLibrary: (repo, name) => (toLibrary(name), (skill(repo, name).library = "same"), `${name} copied into your library`),
    tidy: (repo, name, { keep } = {}) => {
      if (repo === null) for (const m of w.machine.filter((x) => x.name === name && x.dupes)) delete m.dupes;
      else Object.assign(skill(repo, name), { dupes: undefined, linked: true });
      return done(`${name}: one copy${keep ? ` (${keep})` : ""}, plus links`);
    },
    unloadGlobal: (m) => (lib(m.name) || toLibrary(m.name), drop(m), `${m.name} no longer loads globally (backed up)`),
    deleteGlobal: (m) => (drop(m), m.broken ? `Removed broken link ${m.name}` : `Deleted ${m.name} (backed up)`),
    keepGlobal: (name, keep) => {
      w.machine.find((x) => x.name === name && x.source === "global")!.kept = keep;
      return keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`;
    },
    linkGlobal: (m, agents) => {
      const x = w.machine.find((y) => y.path === m.path)!;
      x.agents = [...new Set([...x.agents, ...agents])];
      return `${m.name} now loads for ${agents.map((a) => harness(a).name).join(", ")} too`;
    },
    moveGlobal: (skills, repos) => {
      for (const m of skills) {
        lib(m.name) || toLibrary(m.name);
        for (const r of repos) add(r, m.name);
        drop(m);
      }
      return `${skills.length === 1 ? `${skills[0]!.name} now loads` : `${skills.length} skills now load`} only in ${repos.join(", ")} (original${skills.length === 1 ? "" : "s"} backed up)`;
    },
    createSkill: (name) => {
      w.descriptions[name] = "New skill: say when an agent should use it.";
      w.library.push({ name, latest: 1 });
      return `Created ${name} v1 (its SKILL.md would open in your editor)`;
    },
    pluginOffHere: (repo, id) => `${id} turned off in ${repo}; other repos keep it`,
    replacePlugin: (p, repos) => {
      for (const s of p.skills) if (!lib(s.name)) w.library.push({ name: s.name, latest: 1, origin: `plugin: ${p.id}` });
      for (const r of repos) for (const s of p.skills) add(r, s.name);
      w.machine = w.machine.filter((m) => !(m.source === "plugin" && m.where === p.id));
      w.plugins = w.plugins.filter((x) => x.key !== p.key);
      return `${p.skills.length} skills from ${p.id} are in your library${repos.length ? ` and in ${repos.join(", ")}` : ""}; ${p.id} is uninstalled`;
    },
    setPlugin: (p, on) => {
      w.plugins.find((x) => x.key === p.key)!.on = on;
      if (!on) w.machine = w.machine.filter((m) => !(m.source === "plugin" && m.where === p.id));
      else if (!p.repo) for (const s of p.skills) w.machine.push(machine(s.name, "plugin", p.id));
      return done(`${p.id} is ${on ? "on" : "off"}`);
    },
    uninstallPlugin: (p) => {
      w.plugins = w.plugins.filter((x) => x.key !== p.key);
      w.machine = w.machine.filter((m) => !(m.source === "plugin" && m.where === p.id));
      return `${p.id} is uninstalled (Settings › Backups reinstalls it)`;
    },
    updatePlugin: (p) => {
      const x = w.plugins.find((y) => y.key === p.key)!;
      x.version = x.update;
      delete x.update;
      return `${p.id} is updated; Claude Code uses the new version after a restart`;
    },
    deleteLibrary: (name) => {
      const from = w.projects.filter((p) => p.skills.some((s) => s.name === name && s.source === "lib")).map((p) => p.name);
      for (const p of w.projects) p.skills = p.skills.filter((s) => !(s.name === name && s.source === "lib"));
      w.library = w.library.filter((l) => l.name !== name);
      return `Deleted ${name} from your library${from.length ? ` and from ${from.join(", ")}` : ""}`;
    },
    restoreBackup: (i) => {
      const [b] = w.backups.splice(i, 1);
      w.machine.push(removed.splice(i, 1)[0]!);
      return done(`Restored ${b!.name} to ${b!.from}`);
    },
    setAgents: (ids) => ((w.agents = ids), done(`Agents: ${ids.join(", ")}`)),
    repoInfo: (repo) => info[repo] ?? { branch: "main", dirty: 0, remote: repo === "dotfiles" ? undefined : `github.com/atralice/${repo}` },
    installVersion: (repo, name, version) => ((skill(repo, name).version = version), `${name} v${version} in ${repo}`),
    versions: (name) => Array.from({ length: lib(name)?.latest ?? 0 }, (_, i) => ({ version: i + 1, date: `2026-09-${String(10 + i).padStart(2, "0")}` })),
    libraryFile: (name) => `~/.skilllib/library/${name}/SKILL.md`,
    addRoot: (path) => (w.roots.push(path), `Scanning ${path} too`),
    removeRoot: (path) => ((w.roots = w.roots.filter((r) => r !== path)), `Stopped scanning ${path}`),
    rescan: () => "Looked for repos again",
    hide: (repo) => {
      w.hidden.push(`~/Projects/${repo}`);
      w.projects = w.projects.filter((p) => p.name !== repo);
      return `Hid ${repo}`;
    },
    unhide: (path) => ((w.hidden = w.hidden.filter((h) => h !== path)), `${path} is back in the list`),
    openFolder: (path) => `Opened ${path} (not in the sample)`,
    copy: (_text, what) => `Copied ${what} (not in the sample)`,
    installAgentSkill: () => {
      w.agentSkill = "installed";
      if (!w.machine.some((m) => m.source === "skilllib")) w.machine.push(machine("skilllib", "skilllib", "~/.claude/skills", { links: ["~/.agents/skills/skilllib"] }));
      return done("Your agents can now use skilllib");
    },
    removeAgentSkill: () => {
      w.agentSkill = "missing";
      w.machine = w.machine.filter((m) => m.source !== "skilllib");
      return "Removed the skilllib skill";
    },
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
  "security-audit": "Audit a change for injection, auth and secrets issues before merge.",
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
  skilllib: "Agent skills (SKILL.md) loaded in this repo and the user's skill library, via the skilllib CLI.",
};
