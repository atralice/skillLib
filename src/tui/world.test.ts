import { expect, test } from "bun:test";
import { sampleWorld } from "./sample.js";
import { addRows, agentSkillIssue, assignGroups, failed, isFailure, pluginIssues, pluginSwitchFix, replacePluginFix, groupCandidates, groupLabel, issuesOf, machineActions, machineIssues, projectIssues, runAll, said, usable, type Fix, type Result, type World } from "./world.js";

const ids = (w: World, p: string) => projectIssues(w, p).map((x) => x.issue.id);

test("sample data shows every kind of issue", () => {
  const w = sampleWorld();
  const found = new Set([...w.projects.flatMap((p) => ids(w, p.name)), ...w.machine.flatMap((m) => machineIssues(w, m).map((i) => i.id))].map((id) => id.split(":")[0]));
  for (const kind of ["missing", "twice-g", "kept-g", "twice-p", "copies", "conflict", "cursor-plugin", "edited", "outdated", "blind", "local", "unused", "global", "dup-plugin", "copies-g", "conflict-g", "broken", "blind-global"])
    expect(found).toContain(kind);
});

test("a skill added a minute ago isn't called unused", () => {
  const w = sampleWorld();
  const p = w.projects.find((p) => ids(w, p.name).some((id) => id.startsWith("unused:")))!;
  const id = ids(w, p.name).find((id) => id.startsWith("unused:"))!;
  p.skills.find((s) => s.name === id.slice("unused:".length))!.added = Date.now() - 60_000;
  expect(ids(w, p.name)).not.toContain(id);
});

test("keeping the repo copy unloads the global one and clears the duplicate", () => {
  const w = sampleWorld();
  const stripe = usable(w, "web-app").find((u) => u.local && u.name === "stripe-payments")!;
  issuesOf(w, "web-app", stripe).find((i) => i.id === "twice-g:stripe-payments")!.fixes[0]!.run(w);
  expect(ids(w, "web-app")).not.toContain("twice-g:stripe-payments");
  expect(w.machine.some((m) => m.name === "stripe-payments")).toBe(false);
  expect(w.backups[0]?.name).toBe("stripe-payments");
});

test("add box: library skills not usable here yet, then create", () => {
  const w = sampleWorld();
  const names = (q: string) => addRows(w, "web-app", q).filter((r) => !r.header && !r.create && !r.agent).map((r) => r.name);
  expect(names("")).toEqual(["mdx-tips", "sql-migrations"]);
  expect(names("sql")).toEqual(["sql-migrations"]);
  expect(addRows(w, "web-app", "stripe-payments").filter((r) => !r.header)).toEqual([]);
  // Created first; it goes into the repo only after you've edited it, so the repo never gets the template.
  const create = addRows(w, "web-app", "gql-schema").find((r) => r.create)!;
  create.run!(w);
  expect(usable(w, "web-app").some((u) => u.name === "gql-schema")).toBe(false);
  create.afterEdit!(w);
  expect(usable(w, "web-app").some((u) => u.name === "gql-schema" && u.source === "lib")).toBe(true);
  expect(addRows(w, null, "brand-new").find((r) => r.create)!.afterEdit).toBeUndefined();
});

test("Global only offers fixes that act on global skills, never on a repo", () => {
  // Moving to repos needs you to tick them, so it's left out.
  const fixes = (w: World, i: number) => [...machineIssues(w, w.machine[i]!).flatMap((x) => x.fixes), ...machineActions(w.machine[i]!)].filter((f) => !f.pickRepos);
  const before = sampleWorld();
  before.machine.forEach((_, i) =>
    fixes(before, i).forEach((_, j) => {
      const w = sampleWorld();
      fixes(w, i)[j]!.run(w);
      expect(w.projects).toEqual(sampleWorld().projects);
    }),
  );
});

test("differing global copies: your call which to keep, the other becomes a link", () => {
  const w = sampleWorld();
  const commit = w.machine.find((m) => m.name === "commit-style")!;
  const issue = machineIssues(w, commit).find((i) => i.id === "conflict-g:commit-style")!;
  expect(issue.title).toBe("Copies differ: ~/.claude/skills (Claude Code, Cursor) vs ~/.agents/skills (Codex)");
  expect(issue.decision).toBe(true);
  expect(issue.fixes.map((f) => f.label)).toEqual(["Keep the ~/.claude/skills copy", "Keep the ~/.agents/skills copy"]);
  issue.fixes[1]!.run(w);
  expect(machineIssues(w, commit).map((i) => i.id)).not.toContain("conflict-g:commit-style");
});

test("identical copies are fixed automatically; differing ones and Cursor plugins are your call", () => {
  const w = sampleWorld();
  const issue = (repo: string, name: string, id: string) => issuesOf(w, repo, usable(w, repo).find((u) => u.local && u.name === name)!).find((i) => i.id === `${id}:${name}`)!;
  const copies = issue("web-app", "testing-guide", "copies");
  expect(copies.decision).toBe(false);
  expect(copies.fixes[0]!.preview).toContain("skilllib asks before that one");
  expect(issue("api-server", "db-seed", "conflict").decision).toBe(true);
  expect(issue("web-app", "react-patterns", "cursor-plugin").decision).toBe(true);
  // While copies differ, comparing one of them with your library says nothing.
  expect(ids(w, "api-server")).not.toContain("local:db-seed");
  copies.fixes[0]!.run(w);
  expect(ids(w, "web-app")).not.toContain("copies:testing-guide");
});

test("a repo copy of a skill you keep global is the extra one", () => {
  const w = sampleWorld();
  const pr = usable(w, "mobile-app").find((u) => u.local && u.name === "pr-review")!;
  const issue = issuesOf(w, "mobile-app", pr).find((i) => i.id === "kept-g:pr-review")!;
  expect(ids(w, "mobile-app")).not.toContain("twice-g:pr-review");
  expect(issue.fixes.map((f) => f.label)).toEqual(["Remove this repo's copy, keep it global", "Stop loading it globally after all"]);
  issue.fixes[0]!.run(w);
  expect(ids(w, "mobile-app")).not.toContain("kept-g:pr-review");
  expect(w.machine.some((m) => m.name === "pr-review")).toBe(true);
});

test("related skills group by source, then install time, then first word", () => {
  const w = sampleWorld();
  const machine = w.machine.map((m): Parameters<typeof groupCandidates>[1] => ({ name: m.name, source: m.source, where: m.where, agents: m.agents, uses: 0, machine: m }));
  const groups = assignGroups(machine.map((u) => groupCandidates(w, u)));
  const members = (key: string) => machine.filter((_, i) => groups[i]?.key === key).map((u) => u.name);
  expect(members("plugin:vercel@claude-plugins-official")).toEqual(["vercel-deploy", "vercel-env", "nextjs"]);
  expect(members("claude.ai")).toEqual(["brand-voice", "pdf"]);
  expect(members("time:global:2026-09-20 10:00")).toEqual(["commit-style", "stripe-payments", "frontend-design"]);
  // One of a kind stays on its own: no group of one.
  expect(groups[machine.findIndex((u) => u.name === "create-rule")]).toBeUndefined();
  expect(groupLabel({ key: "time:global:x", label: "installed together 2026-09-20" }, ["cloudflare", "cloudflare-one", "wrangler"])).toBe("cloudflare + 2 more · installed together 2026-09-20");
});

test("replacing a plugin: its skills join your library, grouped by the plugin", () => {
  const w = sampleWorld();
  const fix = replacePluginFix(w.plugins.find((p) => p.id === "vercel@claude-plugins-official")!);
  expect(fix.preview).toContain("Copies its 3 skills");
  expect(fix.preticked!(w)).toEqual(["web-app"]);
  fix.pickRepos!(w, []);
  expect(w.machine.some((m) => m.source === "plugin" && m.where === "vercel@claude-plugins-official")).toBe(false);
  expect(w.library.filter((l) => l.origin === "plugin: vercel@claude-plugins-official").map((l) => l.name)).toEqual(["vercel-deploy", "vercel-env", "nextjs"]);
});

test("a global skill only Codex loads: Claude Code can't see it, and a link fixes that", () => {
  const w = sampleWorld();
  const audit = w.machine.find((m) => m.name === "security-audit")!;
  // Not reviewed yet: linking it is one of your choices, next to moving it to repos.
  const review = machineIssues(w, audit).find((i) => i.id === "global:security-audit")!;
  expect(review.short).toBe("Not reviewed · Claude Code can't see it");
  expect(review.decision).toBe(true);
  expect(review.fixes.map((f) => f.label)).toEqual(["Move it to the repos that need it…", "Link it for Claude Code", "Keep it global on purpose", "Delete it"]);
  // Kept global on purpose: the link is the plain fix.
  review.fixes[2]!.run(w);
  const blind = machineIssues(w, audit).find((i) => i.id === "blind-global:security-audit")!;
  expect(blind.decision).toBe(false);
  blind.fixes[0]!.run(w);
  expect(machineIssues(w, audit)).toEqual([]);
  // A duplicate copy elsewhere is tidy's job first, not a missing link.
  const tailwind = w.machine.find((m) => m.name === "tailwind-tips")!;
  expect(machineIssues(w, tailwind).map((i) => i.short)).not.toContain("Not reviewed · Claude Code can't see it");
});

test("the skilllib skill: Health offers it when your agents don't have it, and it's your call", () => {
  const w = sampleWorld();
  expect(agentSkillIssue(w)).toBeNull();
  w.agentSkill = "missing";
  const issue = agentSkillIssue(w)!;
  expect(issue.decision).toBe(true);
  expect(issue.fixes.map((f) => f.label)).toEqual(["Install the skilllib skill for your agents"]);
  issue.fixes[0]!.run(w);
  expect(agentSkillIssue(w)).toBeNull();
  // An old copy is only refreshed: fix all may do that.
  w.agentSkill = "outdated";
  expect(agentSkillIssue(w)!.decision).toBe(false);
  expect(agentSkillIssue(w)!.fixes[0]!.label).toBe("Update the skilllib skill");
  // No agents picked: nowhere to install it.
  w.agents = [];
  expect(agentSkillIssue(w)).toBeNull();
});

test("stopping a global skill from loading changes every repo: a decision that names the repos that use it", () => {
  const w = sampleWorld();
  // api-server uses stripe-payments without a copy of its own: it would lose it.
  const api = w.projects.find((p) => p.name === "api-server")!;
  api.skills = api.skills.filter((s) => s.name !== "stripe-payments");
  const stripe = usable(w, "web-app").find((u) => u.local && u.name === "stripe-payments")!;
  const twice = issuesOf(w, "web-app", stripe).find((i) => i.id === "twice-g:stripe-payments")!;
  expect(twice.decision).toBe(true);
  expect(twice.fixes[0]!.preview).toContain("Every other repo stops seeing it, and api-server used it in the last 30 days.");
  // Keeping the plugin's copy instead of yours changes what every repo runs too.
  const frontend = w.machine.find((m) => m.name === "frontend-design" && m.source === "global")!;
  expect(machineIssues(w, frontend).find((i) => i.id === "dup-plugin:frontend-design")!.decision).toBe(true);
});

test("fix all says what it held back and why, and what failed", () => {
  const w = sampleWorld();
  const fix = (r: Result): Fix => ({ label: "", preview: "", run: () => r });
  const ask = fix({ message: "shared-skill: held back .claude/skills/shared-skill: duplicate copy → link, because git tracks it", then: fix("done") });
  expect(runAll(w, [fix("a"), fix("b")])).toBe("Applied 2 fixes (anything removed is in Settings › Backups)");
  const held = runAll(w, [fix("a"), ask]);
  expect(isFailure(held)).toBe(false);
  expect(said(held)).toBe(
    "Applied 1 of 2 fixes (anything removed is in Settings › Backups) · shared-skill: held back .claude/skills/shared-skill: duplicate copy → link, because git tracks it (fix it on its own to go ahead)",
  );
  const broken: Fix = {
    label: "",
    preview: "",
    run: () => {
      throw new Error("x: gone");
    },
  };
  const bad = runAll(w, [fix(failed("y: nope")), broken]);
  expect(isFailure(bad)).toBe(true);
  expect(said(bad)).toBe("Applied 0 of 2 fixes · couldn't: y: nope; x: gone");
});

test("importing a repo's skill or tracking it writes to skilllib.json: your call, never in fix all (#49)", () => {
  const w = sampleWorld();
  const issue = (repo: string, name: string, id: string) => issuesOf(w, repo, usable(w, repo).find((u) => u.local && u.name === name)!).find((i) => i.id === `${id}:${name}`);
  expect(issue("docs-site", "mdx-tips", "adopt")!.decision).toBe(true);
  expect(issue("mobile-app", "pr-review", "local")!.decision).toBe(true);
});

test("plugin issues are always your call: fix-all never turns plugins on or off, or updates them", () => {
  const w = sampleWorld();
  const issues = w.plugins.flatMap((p) => pluginIssues(w, p).map((i) => [p.id, i.short, i.decision] as const));
  expect(issues).toEqual([
    ["vercel@claude-plugins-official", "Update to 0.51.0", true],
    ["frontend-design@claude-plugins-official", "Repeats 1 of yours", true],
    ["frontend-design@claude-plugins-official", "Unused 30 days", true],
    ["stripe-tools@acme", "Repeats 1 of yours", true],
    ["react-kit@cursor-public", "Repeats 1 of yours", true],
  ]);
  // Off plugins load nothing: no duplicates, nothing unused.
  expect(pluginIssues(w, w.plugins.find((p) => p.id === "ponytail@ponytail")!)).toEqual([]);
});

test("turning a plugin off takes its skills out of what loads everywhere; on brings them back", () => {
  const w = sampleWorld();
  const vercel = () => w.plugins.find((p) => p.id === "vercel@claude-plugins-official")!;
  const loaded = () => w.machine.filter((m) => m.where === "vercel@claude-plugins-official").map((m) => m.name);
  expect(pluginSwitchFix(vercel(), false).preview).toContain("Runs claude plugin disable vercel@claude-plugins-official --scope user");
  pluginSwitchFix(vercel(), false).run(w);
  expect(vercel().on).toBe(false);
  expect(loaded()).toEqual([]);
  pluginSwitchFix(vercel(), true).run(w);
  expect(loaded()).toEqual(["vercel-deploy", "vercel-env", "nextjs"]);
});
