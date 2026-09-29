import { expect, test } from "bun:test";
import { sampleWorld } from "./sample.js";
import { addRows, assignGroups, replacePluginFix, groupCandidates, groupLabel, issuesOf, machineActions, machineIssues, projectIssues, usable, type World } from "./world.js";

const ids = (w: World, p: string) => projectIssues(w, p).map((x) => x.issue.id);

test("sample data shows every kind of issue", () => {
  const w = sampleWorld();
  const found = new Set([...ids(w, "web-app"), ...w.machine.flatMap((m) => machineIssues(w, m).map((i) => i.id))].map((id) => id.split(":")[0]));
  for (const kind of ["missing", "twice-g", "twice-p", "edited", "outdated", "blind", "local", "unused", "global", "dup-plugin", "broken"]) expect(found).toContain(kind);
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
  addRows(w, "web-app", "gql-schema").find((r) => r.create)!.run!(w);
  expect(usable(w, "web-app").some((u) => u.name === "gql-schema" && u.source === "lib")).toBe(true);
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

test("two of your own global copies of one skill: either can go", () => {
  const w = sampleWorld();
  w.ops.keepGlobal("commit-style", true);
  w.machine.push({ ...w.machine.find((m) => m.name === "commit-style")!, where: "~/.cursor/skills", path: "~/.cursor/skills/commit-style" });
  const issue = machineIssues(w, w.machine[0]!).find((i) => i.id === "dup-global:commit-style")!;
  expect(issue.fixes.map((f) => f.label)).toEqual(["Delete the copy in ~/.claude/skills", "Delete the copy in ~/.cursor/skills"]);
  issue.fixes[1]!.run(w);
  expect(w.machine.filter((m) => m.name === "commit-style").map((m) => m.where)).toEqual(["~/.claude/skills"]);
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
  const fix = replacePluginFix(w, "vercel@claude-plugins-official");
  expect(fix.preview).toContain("Copies its 3 skills");
  expect(fix.preticked!(w)).toEqual(["web-app"]);
  fix.pickRepos!(w, []);
  expect(w.machine.some((m) => m.source === "plugin" && m.where === "vercel@claude-plugins-official")).toBe(false);
  expect(w.library.filter((l) => l.origin === "plugin: vercel@claude-plugins-official").map((l) => l.name)).toEqual(["vercel-deploy", "vercel-env", "nextjs"]);
});
