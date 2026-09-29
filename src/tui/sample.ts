/**
 * Sample data for tests and headless screen checks: a few repos, a library and what loads
 * everywhere, held in memory. Its ops change it in place; `reload()` hands back a fresh copy.
 */
import type { HarnessId } from "../harnesses.js";
import type { LocalSkill, MachineSkill, Ops, Project, RepoInfo, World } from "./world.js";

const READS_CLAUDE: HarnessId[] = ["claude-code", "cursor"];
const READS_AGENTS: HarnessId[] = ["cursor", "codex", "zed"];

/** Sample skills remember whether they're linked into the other folder, to work out which agents see them. */
type SampleSkill = LocalSkill & { linked: boolean };

function localAgents(s: SampleSkill, enabled: HarnessId[]): HarnessId[] {
  if (s.missing) return [];
  const reads = new Set([...(s.dir === ".claude/skills" || s.linked ? READS_CLAUDE : []), ...(s.dir === ".agents/skills" || s.linked ? READS_AGENTS : [])]);
  return enabled.filter((a) => reads.has(a));
}

function machineAgents(m: MachineSkill, enabled: HarnessId[]): HarnessId[] {
  if (m.broken) return [];
  const reads: HarnessId[] =
    m.source === "global" ? (m.where === "~/.agents/skills" ? READS_AGENTS : READS_CLAUDE) : m.source === "cursor" ? ["cursor"] : READS_CLAUDE; // plugins and claude.ai reach Cursor too
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
  path: source === "global" ? `${where}/${name}` : where,
  links: [],
  agents: [],
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
    "web-app": { "stripe-payments": 11, "react-patterns": 9, "api-conventions": 6, "deploy-preview": 4, "release-notes": 2, "commit-style": 8, "vercel-deploy": 3, nextjs: 5, "pr-review": 4 },
    "api-server": { "stripe-payments": 3, "api-conventions": 7, "commit-style": 5, "use-railway": 2 },
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
      machine("old-helper", "global", "~/.claude/skills", { broken: true }),
      machine("vercel-deploy", "plugin", "vercel@claude-plugins-official", { pluginParts: ["commands", "agents", "hooks"] }),
      machine("vercel-env", "plugin", "vercel@claude-plugins-official", { pluginParts: ["commands", "agents", "hooks"] }),
      machine("nextjs", "plugin", "vercel@claude-plugins-official", { pluginParts: ["commands", "agents", "hooks"] }),
      machine("frontend-design", "plugin", "frontend-design@claude-plugins-official"),
      machine("use-railway", "plugin", "railway@claude-plugins-official"),
      machine("brand-voice", "claude.ai", "claude.ai account"),
      machine("pdf", "claude.ai", "claude.ai account"),
      machine("create-rule", "cursor", "Cursor built-in"),
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
    moveGlobal: (m, repos) => {
      lib(m.name) || toLibrary(m.name);
      for (const r of repos) add(r, m.name);
      drop(m);
      return `${m.name} now loads only in ${repos.join(", ")} (original backed up)`;
    },
    createSkill: (name) => {
      w.descriptions[name] = "New skill: say when an agent should use it.";
      w.library.push({ name, latest: 1 });
      return `Created ${name} v1 (its SKILL.md would open in your editor)`;
    },
    replacePlugin: (id, repos) => {
      const skills = w.machine.filter((m) => m.source === "plugin" && m.where === id);
      for (const m of skills) if (!lib(m.name)) w.library.push({ name: m.name, latest: 1, origin: `plugin: ${id}` });
      for (const r of repos) for (const m of skills) add(r, m.name);
      w.machine = w.machine.filter((m) => !skills.includes(m));
      return `${skills.length} skills from ${id} are in your library${repos.length ? ` and in ${repos.join(", ")}` : ""}; ${id} is uninstalled`;
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
