/**
 * Sample data for tests and headless screen checks: a few repos, a library and what loads
 * everywhere, held in memory. Its ops change it in place; `reload()` hands back a fresh copy.
 */
import type { HarnessId } from "../harnesses.js";
import type { Choice, Issue as Found } from "../health.js";
import type { LocalSkill, MachineSkill, Ops, Plugin, Project, World } from "./world.js";

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
  const w: World = {
    agents: ["claude-code", "cursor", "codex"],
    cwd: "web-app",
    projects: [
      repo("web-app", "committed", [
        { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: false, version: 2, git: "ignored" },
        { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 1, git: "ignored" },
        { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, edited: true, git: "ignored" },
        { name: "seo-meta", source: "lib", dir: ".claude/skills", linked: true, version: 1, missing: true, git: "ignored" },
        { name: "testing-guide", source: "lib", dir: ".claude/skills", linked: true, version: 3, git: "ignored" },
        { name: "deploy-preview", source: "repo", dir: ".agents/skills", linked: false, git: "committed" },
        { name: "release-notes", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "my-scratchpad", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
        { name: "vercel-deploy", source: "untracked", dir: ".claude/skills", linked: true, git: "new" },
      ]),
      repo("api-server", "changed", [
        { name: "stripe-payments", source: "lib", dir: ".claude/skills", linked: true, version: 2, git: "ignored" },
        { name: "api-conventions", source: "lib", dir: ".claude/skills", linked: true, version: 1, git: "ignored" },
        { name: "db-seed", source: "untracked", dir: ".claude/skills", linked: true, others: [".agents/skills"], git: "ignored" },
      ]),
      repo("docs-site", "none", [
        { name: "writing-style", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "mdx-tips", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
      ]),
      repo("mobile-app", "committed", [
        { name: "react-patterns", source: "lib", dir: ".claude/skills", linked: true, version: 2, git: "ignored" },
        { name: "expo-release", source: "repo", dir: ".agents/skills", linked: true, git: "committed" },
        { name: "pr-review", source: "untracked", dir: ".claude/skills", linked: true, git: "ignored" },
      ]),
      ...emptyRepos.map((name) => repo(name, "none", [])),
    ],
    machine: [
      machine("commit-style", "global", "~/.claude/skills", { installed: "2026-09-20 10:00" }),
      machine("stripe-payments", "global", "~/.claude/skills", { installed: "2026-09-20 10:00" }),
      machine("tailwind-tips", "global", "~/.agents/skills", { origin: "skills.sh: tailwindlabs/skills" }),
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
      // A plugin's skills copied in; its namesake came in earlier, before origins were recorded.
      { name: "lean", latest: 1 },
      { name: "lean-review", latest: 1, origin: "plugin: lean@lean" },
      { name: "lean-audit", latest: 1, origin: "plugin: lean@lean" },
    ],
    usage,
    days: spread(usage),
    descriptions: { ...DESCRIPTIONS },
    backups: [],
    roots: ["~/Projects"],
    hidden: [],
    agentsChosen: true,
    agentSkill: "installed",
    issues: [],
    ops: undefined as unknown as Ops,
  };
  const found = sampleIssues(w);
  w.issues = found.issues;
  w.ops = { ...sampleOps(w), usageIssues: () => found.unused };
  seeAgents(w);
  return w;
}

/**
 * What doctor would say about the sample, written out (health.ts reads the disk, and this is in memory).
 * A fix or choice makes the change, roughly, and its issue goes away.
 */
function sampleIssues(w: World): { issues: Found[]; unused: Found[] } {
  const issues: Found[] = [];
  const unused: Found[] = [];
  const root = (repo: string) => `~/Projects/${repo}`;
  const skill = (repo: string, name: string) => w.projects.find((p) => p.name === repo)!.skills.find((s) => s.name === name)! as SampleSkill;
  const global = (name: string) => w.machine.find((m) => m.name === name && m.source === "global")!;
  const drop = (m: MachineSkill) => {
    w.machine = w.machine.filter((x) => x !== m);
    w.backups.unshift({ name: m.name, from: m.path, at: "10:00" });
  };
  type Act = { label: string; hint?: string; change?: () => void; said?: string };
  const add = (list: Found[], i: Omit<Found, "fix" | "choices"> & { fix?: Act; choices?: Act[] }) => {
    const choice = ({ label, hint, change, said }: Act): Choice => ({
      label,
      ...(hint ? { hint } : {}),
      run: () => {
        change?.();
        for (const l of [w.issues, unused]) if (l.some((x) => x.id === i.id)) l.splice(l.findIndex((x) => x.id === i.id), 1);
        seeAgents(w);
        return said ?? `${label}: done`;
      },
    });
    list.push({ ...i, fix: i.fix && choice(i.fix), choices: i.choices?.map(choice) });
  };
  const at = (repo: string | null, ...skills: string[]) => skills.map((s) => ({ root: repo && root(repo), skill: s }));
  const plugin = (id: string) => w.plugins.find((p) => p.id === id)!;
  const off = (id: string) => () => {
    plugin(id).on = false;
    w.machine = w.machine.filter((m) => !(m.source === "plugin" && m.where === id));
  };

  add(issues, {
    id: "broken:old-helper",
    severity: "problem",
    title: "old-helper: broken link in ~/.claude/skills",
    detail: "It points at a folder that no longer exists, so it loads nothing.",
    fix: { label: "Remove the link", change: () => drop(w.machine.find((m) => m.name === "old-helper")!), said: "Removed broken link old-helper" },
    at: at(null, "old-helper"),
  });
  add(issues, {
    id: "plugin:vercel@claude-plugins-official",
    severity: "problem",
    title: "vercel-deploy: also in the Claude Code plugin vercel@claude-plugins-official",
    detail:
      "Claude Code loads both (the plugin's as /vercel:vercel-deploy). Your skill wins. The plugin's other 2 skills are copied into Your skills first, so nothing is lost. It also brings commands, agents, hooks, MCP servers: removing it drops those, turning it off pauses them. Or keep it and turn it off only in web-app.",
    choices: [
      { label: "Turn the plugin vercel@claude-plugins-official off", hint: "stays installed", change: off("vercel@claude-plugins-official") },
      { label: "Remove the plugin vercel@claude-plugins-official", hint: "also removes its commands, agents, hooks, MCP servers", change: off("vercel@claude-plugins-official") },
      { label: "Turn the plugin vercel@claude-plugins-official off in web-app only", hint: "other repos keep it; in .claude/settings.local.json, a local-only file" },
    ],
    at: [...at("web-app", "vercel-deploy"), ...at(null, "vercel-deploy")],
    plugin: "vercel@claude-plugins-official",
  });
  add(issues, {
    id: "plugin:frontend-design@claude-plugins-official",
    severity: "problem",
    title: "frontend-design: also in the Claude Code plugin frontend-design@claude-plugins-official",
    detail: "Claude Code loads both (the plugin's as /frontend-design:frontend-design). Your skill wins.",
    choices: [
      { label: "Remove the plugin frontend-design@claude-plugins-official", hint: "restorable with skilllib restore", change: off("frontend-design@claude-plugins-official") },
      { label: "Turn the plugin frontend-design@claude-plugins-official off", hint: "stays installed", change: off("frontend-design@claude-plugins-official") },
    ],
    at: at(null, "frontend-design"),
    plugin: "frontend-design@claude-plugins-official",
  });
  add(issues, {
    id: `plugin:${root("api-server")}:stripe-tools@acme`,
    severity: "problem",
    title: "stripe-payments: also in the Claude Code plugin stripe-tools@acme, on in api-server",
    detail: "api-server's Claude Code settings turn the plugin on, so Claude Code loads both there (the plugin's as /stripe-tools:stripe-payments). Your skill wins.",
    choices: [
      { label: "Turn the plugin stripe-tools@acme off in api-server only", hint: "other repos keep it; in .claude/settings.local.json, a local-only file", change: off("stripe-tools@acme") },
      { label: "Remove your stripe-payments from api-server", hint: "the plugin's copy stays; Your skills keeps yours", change: () => w.ops.remove("api-server", "stripe-payments") },
    ],
    at: at("api-server", "stripe-payments"),
    plugin: "stripe-tools@acme",
  });
  add(issues, {
    id: "plugin-update:vercel@claude-plugins-official",
    severity: "suggestion",
    title: "vercel@claude-plugins-official: update available (0.50.0 → 0.51.0)",
    detail: "Updates can bring new commands, hooks or MCP servers. If the marketplace asks to run a command, skilllib stops and you update it yourself. Claude Code uses the new version after a restart.",
    choices: [{ label: "Update to 0.51.0", hint: "runs claude plugin update vercel@claude-plugins-official", change: () => void delete plugin("vercel@claude-plugins-official").update }],
    plugin: "vercel@claude-plugins-official",
    pluginAt: null,
  });
  add(issues, {
    id: "cursor-plugin:react-kit",
    severity: "suggestion",
    title: "react-patterns: also in the Cursor plugin react-kit",
    detail: "Cursor lists both copies when that plugin is on. Your skill wins: turn the plugin off in Cursor (Settings → Plugins).",
    at: [...at("web-app", "react-patterns"), ...at("mobile-app", "react-patterns")],
    plugin: "react-kit",
  });
  add(issues, {
    id: "tidy:global",
    severity: "suggestion",
    title: "1 global skill with duplicate copies",
    detail: "tailwind-tips: each keeps one copy (in ~/.agents/skills when there's one) and the others become links. Restorable with skilllib restore.",
    fix: { label: "Keep one copy of each", said: "1 global skill now has one copy" },
    at: at(null, "tailwind-tips"),
  });
  add(issues, {
    id: "conflict:global:commit-style",
    severity: "problem",
    title: "commit-style in your global folders: the copies differ",
    detail: "Your agents run different versions: ~/.claude/skills (Claude Code, Cursor) vs ~/.agents/skills (Codex). Keep one; the others become links to it and are restorable with skilllib restore.",
    choices: [
      { label: "Keep the ~/.claude/skills copy", hint: "the others become links to it" },
      { label: "Keep the ~/.agents/skills copy", hint: "the others become links to it" },
    ],
    at: at(null, "commit-style"),
  });
  add(issues, {
    id: "review:global",
    severity: "suggestion",
    title: "5 global skills of yours load in every repo",
    detail:
      "commit-style, stripe-payments, tailwind-tips, frontend-design, security-audit. Move each to the repos that need it (skilllib global move <name> --to <repo>...), or mark the ones you want everywhere as global on purpose (skilllib global keep <name>).",
    at: at(null, "commit-style", "stripe-payments", "tailwind-tips", "frontend-design", "security-audit"),
  });
  add(issues, {
    id: "usable:global",
    severity: "suggestion",
    title: "1 global skill not usable by Claude Code",
    detail: "security-audit (only Codex, Cursor). Link it for every agent, or move it to the repos that need it (skilllib global move), which works for every agent too.",
    choices: [{ label: "Link it for Claude Code", hint: "links only; nothing is copied or moved", change: () => void (global("security-audit").links = ["~/.claude/skills/security-audit"]) }],
    at: at(null, "security-audit"),
  });
  add(issues, {
    id: "twice:stripe-payments",
    severity: "suggestion",
    title: "stripe-payments: in web-app, api-server and also loaded globally",
    detail: "The project copies are enough; the global one loads it in every other project too. Stop loading it globally, or keep it global on purpose (skilllib global keep).",
    choices: [{ label: "Stop loading it globally", hint: "restorable with skilllib restore", change: () => drop(global("stripe-payments")), said: "stripe-payments no longer loads globally" }],
    at: [...at("web-app", "stripe-payments"), ...at("api-server", "stripe-payments"), ...at(null, "stripe-payments")],
  });
  add(issues, {
    id: "twice:pr-review",
    severity: "suggestion",
    title: "pr-review: in mobile-app, and you keep it global",
    detail: "The global copy already loads there, so the project copies are extra. Claude Code runs the global one anyway. mobile-app has its own copy: remove it in the repo, or stop keeping pr-review global.",
    at: [...at("mobile-app", "pr-review"), ...at(null, "pr-review")],
  });
  add(issues, {
    id: `sync:${root("web-app")}`,
    severity: "problem",
    title: "web-app: 1 skill pinned but not installed",
    detail: "seo-meta: the folder is missing",
    fix: { label: "Sync the project", change: () => void (skill("web-app", "seo-meta").missing = false), said: "web-app: restored 1 skill" },
    at: at("web-app", "seo-meta"),
  });
  add(issues, {
    id: `update:${root("web-app")}`,
    severity: "suggestion",
    title: "web-app: 1 skill out of date",
    detail: "react-patterns (v1 → v2)",
    choices: [{ label: "Update to the newest versions", hint: "replaces each copy with your library's newest", change: () => void (skill("web-app", "react-patterns").version = 2), said: "web-app: updated 1 skill" }],
    at: at("web-app", "react-patterns"),
  });
  const tidy = { said: "web-app: tidied 1 skill" };
  add(issues, {
    id: `tidy:${root("web-app")}`,
    severity: "suggestion",
    title: "web-app: 1 skill with extra copies or links",
    detail: "testing-guide: .agents/skills/testing-guide: duplicate copy → link. Git would see 1 of these change: .agents/skills/testing-guide: duplicate copy → link.",
    choices: [
      { label: "Tidy, but keep git as it is", hint: "skips the 1 change git would see", ...tidy },
      { label: "Tidy everything", hint: "1 change will show in git status", ...tidy },
    ],
    at: at("web-app", "testing-guide"),
  });
  add(issues, {
    id: `conflict:${root("api-server")}:db-seed`,
    severity: "problem",
    title: "db-seed in api-server: the copies differ",
    detail: "Your agents run different versions: .claude/skills (Claude Code, Cursor) vs .agents/skills (Codex). Keep one; the others become links to it and are restorable with skilllib restore.",
    choices: [
      { label: "Keep the .claude/skills copy", hint: "the others become links to it" },
      { label: "Keep the .agents/skills copy", hint: "the others become links to it" },
    ],
    at: at("api-server", "db-seed"),
  });
  // A link to a folder that's gone, with no copy of the skill in the repo: it has no row but its issue's.
  add(issues, {
    id: `broken:${root("api-server")}:.claude/skills/old-lint`,
    severity: "problem",
    title: "old-lint: broken link in api-server/.claude/skills",
    detail: "It points at a folder that no longer exists, so it loads nothing.",
    fix: { label: "Remove the link", said: "Removed the broken link .claude/skills/old-lint in api-server" },
    at: at("api-server", "old-lint"),
  });
  add(issues, {
    id: `usable:${root("web-app")}`,
    severity: "suggestion",
    title: "web-app: 2 skills not usable by Codex, Claude Code",
    detail: "stripe-payments (not Codex), deploy-preview (not Claude Code). Adding links makes the one real copy reach every agent you use; nothing is copied or moved.",
    fix: {
      label: "Add the links",
      change: () => ["stripe-payments", "deploy-preview"].forEach((n) => (skill("web-app", n).linked = true)),
      said: "web-app: linked 2 skills for Codex, Claude Code",
    },
    at: at("web-app", "stripe-payments", "deploy-preview"),
  });
  add(issues, {
    id: `edited:${root("web-app")}:api-conventions`,
    severity: "suggestion",
    title: "api-conventions in web-app has local edits",
    detail: "It no longer matches v1 from Your skills. Save the edits as a new version so your other repos can get them, or discard them. Keeping them is fine too: skilllib never overwrites edits.",
    choices: [
      { label: "Save as a new version in Your skills", hint: "becomes v2; web-app uses it", change: () => Object.assign(skill("web-app", "api-conventions"), { edited: false, version: ++w.library.find((l) => l.name === "api-conventions")!.latest }) },
      { label: "Discard the edits", hint: "back to v1; the edited copy is restorable with skilllib restore", change: () => void (skill("web-app", "api-conventions").edited = false) },
    ],
    at: at("web-app", "api-conventions"),
  });
  const track = (repo: string, name: string) => () => {
    if (!w.library.some((l) => l.name === name)) w.library.push({ name, latest: 1 });
    Object.assign(skill(repo, name), { source: "lib", version: 1 });
  };
  for (const [repo, name] of [["web-app", "my-scratchpad"], ["web-app", "vercel-deploy"], ["mobile-app", "pr-review"]] as const)
    add(issues, {
      id: `local:${root(repo)}:${name}`,
      severity: "suggestion",
      title: `${name} in ${repo} isn't in your library`,
      detail: "Import it into the library to reuse it in other projects and keep it backed up. The repo then tracks it in skilllib.json.",
      choices: [{ label: "Import into the library", hint: `${repo} then tracks it`, change: track(repo, name), said: `${name} imported and tracked in ${repo}` }],
      at: at(repo, name),
    });
  add(issues, {
    id: `adopt:${root("docs-site")}:mdx-tips`,
    severity: "suggestion",
    title: "mdx-tips in docs-site isn't tracked",
    detail: "It's identical to the library copy; track it (in skilllib.json) so future library changes reach it.",
    choices: [{ label: "Track it", hint: "adds it to docs-site's skilllib.json", change: track("docs-site", "mdx-tips"), said: "mdx-tips tracked in docs-site" }],
    at: at("docs-site", "mdx-tips"),
  });

  // Usage's: skills unused in 30 days.
  const team = " The repo's own skills are the team's: remove those in the repo if nobody needs them.";
  add(unused, {
    id: `unused:${root("web-app")}`,
    severity: "suggestion",
    title: "web-app: 2 skills unused in 30 days",
    detail: `testing-guide, my-scratchpad: no Claude Code session in web-app used them. Each one's name and description still takes context in every session there.${team}`,
    choices: [{ label: "Remove the 1 skill skilllib installed from web-app", hint: "Your skills keeps them; edited ones stay", change: () => w.ops.remove("web-app", "testing-guide"), said: "web-app: removed testing-guide" }],
    at: at("web-app", "testing-guide", "my-scratchpad"),
  });
  add(unused, {
    id: `unused:${root("mobile-app")}`,
    severity: "suggestion",
    title: "mobile-app: 2 skills unused in 30 days",
    detail: `expo-release, pr-review: no Claude Code session in mobile-app used them. Each one's name and description still takes context in every session there.${team}`,
    at: at("mobile-app", "expo-release", "pr-review"),
  });
  for (const [id, at, skills, where] of [
    ["frontend-design@claude-plugins-official", null, ["frontend-design"], ""],
    ["stripe-tools@acme", root("api-server"), ["stripe-payments", "stripe-webhooks"], " in api-server"],
  ] as const) {
    const name = id.split("@")[0];
    add(unused, {
      id: `plugin-unused:${at ? `${at}:` : ""}${id}`,
      severity: "suggestion",
      title: `${id}${where}: its skills weren't used in 30 days`,
      detail: `No Claude Code session used ${skills.map((s) => `/${name}:${s}`).join(", ")}. Each one's name and description still takes context in every session.`,
      choices: [
        { label: `Turn the plugin ${id} off`, hint: "stays installed", change: off(id) },
        { label: `Uninstall the plugin ${id}`, hint: "its data stays; restorable with skilllib restore", change: off(id) },
      ],
      plugin: id,
      pluginAt: at,
    });
  }
  add(unused, {
    id: "unused:library",
    severity: "suggestion",
    title: "4 skills in Your skills: in no repo, unused in 30 days",
    detail: "lean, lean-audit, lean-review, sql-migrations. They load nowhere, so they take no context: add the ones you want to a repo, or delete the ones you've outgrown.",
    choices: [{ label: "Delete all 4 from Your skills", hint: "restorable with skilllib restore", change: () => void (w.library = w.library.filter((l) => !["lean", "lean-audit", "lean-review", "sql-migrations"].includes(l.name))), said: "Deleted 4 skills from Your skills" }],
    at: at(null, "lean", "lean-audit", "lean-review", "sql-migrations"),
  });
  return { issues, unused };
}

/** Which agents load each skill, from the folders it's in. */
function seeAgents(w: World) {
  for (const p of w.projects) for (const s of p.skills) s.agents = localAgents(s as SampleSkill, w.agents);
  for (const m of w.machine) m.agents = machineAgents(m, w.agents);
}

function sampleOps(w: World): Omit<Ops, "usageIssues"> {
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
    const s: SampleSkill = { name, source: "lib", dir: ".claude/skills", path: `${p.path}/.claude/skills/${name}`, linked: true, agents: [], version: lib(name)?.latest ?? 1, git: "ignored" };
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
    update: (repo, name) => ((skill(repo, name).version = lib(name)!.latest), `${name} updated to v${lib(name)!.latest}`),
    pin: (repo, name, personal) => ((skill(repo, name).personal = personal), personal ? `${name} is now personal in ${repo}` : `${name} is now pinned in ${repo}'s skilllib.json`),
    copyToLibrary: (_repo, name) => (toLibrary(name), `${name} copied into your library`),
    deleteGlobal: (m) => (drop(m), m.broken ? `Removed broken link ${m.name}` : `Deleted ${m.name} (backed up)`),
    keepGlobal: (name, keep) => {
      w.machine.find((x) => x.name === name && x.source === "global")!.kept = keep;
      return keep ? `${name} marked as global on purpose` : `${name} is no longer marked as global on purpose`;
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
  lean: "The simplest change that works: question the task, reach for what's built in.",
  "lean-review": "Review a diff for code that could be deleted or simplified.",
  "lean-audit": "Audit a repo for dependencies and abstractions it doesn't need.",
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
