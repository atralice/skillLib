import { expect, test } from "bun:test";
import { sampleWorld } from "./sample.js";
import { addRows, assignGroups, failed, isFailure, issueOf, issuesAt, libraryIssues, machineActions, pluginIssues, pluginSwitchFix, pluginUses, replacePluginFix, groupCandidates, groupLabel, repoIssues, runAll, said, usable, type Fix, type Result, type World } from "./world.js";

test("add box: library skills not usable here yet, then create", () => {
  const w = sampleWorld();
  const names = (q: string) => addRows(w, "web-app", q).filter((r) => !r.header && !r.create && !r.agent).map((r) => r.name);
  expect(names("")).toEqual(["mdx-tips", "sql-migrations", "⧉ lean plugin", "lean", "lean-review", "lean-audit"]);
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

test("add box: a plugin's skills under one row that adds them all, its namesake included", () => {
  const w = sampleWorld();
  const group = addRows(w, "web-app", "").find((r) => r.members?.length! > 1)!;
  expect(group.members).toEqual(["lean", "lean-review", "lean-audit"]);
  expect(group.note).toBe("3 skills");
  group.run!(w);
  expect(usable(w, "web-app").filter((u) => u.name.startsWith("lean")).map((u) => u.source)).toEqual(["lib", "lib", "lib"]);
  // What's left of a group once the repo has some of it: one skill is just a skill.
  const w2 = sampleWorld();
  w2.ops.addTo(["web-app"], ["lean", "lean-review"]);
  const rows = addRows(w2, "web-app", "");
  expect(rows.some((r) => r.members?.length! > 1)).toBe(false);
  expect(rows.find((r) => r.name === "lean-audit")!.inGroup).toBeUndefined();
  // Searching narrows the group, never regroups it.
  expect(addRows(sampleWorld(), "web-app", "lean-").find((r) => r.members?.length! > 1)!.members).toEqual(["lean-review", "lean-audit"]);
});

test("Global's actions act on global skills, never on a repo", () => {
  // Moving to repos needs you to tick them, so it's left out.
  const fixes = (w: World, i: number) => machineActions(w.machine[i]!).filter((f) => !f.pickRepos);
  const before = sampleWorld();
  before.machine.forEach((_, i) =>
    fixes(before, i).forEach((_, j) => {
      const w = sampleWorld();
      fixes(w, i)[j]!.run(w);
      expect(w.projects).toEqual(sampleWorld().projects);
    }),
  );
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
  // In your library, a plugin's namesake imported without an origin still groups with the plugin's skills.
  const lib = assignGroups(w.library.map((l) => groupCandidates(w, l)));
  expect(w.library.filter((_, i) => lib[i]?.key === "plugin:lean@lean").map((l) => l.name)).toEqual(["lean", "lean-review", "lean-audit"]);
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

test("fix all counts what it applied, and names what failed", () => {
  const w = sampleWorld();
  const fix = (r: Result): Fix => ({ label: "", preview: "", run: () => r });
  expect(runAll(w, [fix("a"), fix("b")])).toBe("Applied 2 fixes (anything removed is in Settings › Backups)");
  const bad = runAll(w, [fix("a"), fix(failed("y: nope"))]);
  expect(isFailure(bad)).toBe(true);
  expect(said(bad)).toBe("Applied 1 of 2 fixes (anything removed is in Settings › Backups) · couldn't: y: nope");
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

test("a plugin's uses are its own (plugin:skill), per repo too", () => {
  const w = sampleWorld();
  const byId = (id: string) => w.plugins.find((p) => p.id === id)!;
  expect(pluginUses(w, byId("vercel@claude-plugins-official"))).toBe(5);
  expect(pluginUses(w, byId("vercel@claude-plugins-official"), "web-app")).toBe(5);
  expect(pluginUses(w, byId("vercel@claude-plugins-official"), "api-server")).toBe(0);
  // Claude Code records both railway installs as railway:use-railway, so they share a count.
  expect(pluginUses(w, byId("railway@synced"))).toBe(2);
  expect(replacePluginFix(byId("railway@claude-plugins-official")).preticked!(w)).toEqual(["api-server"]);
});

test("doctor's issues in the app: the fix is the ★ one, choices are your call, a fix that throws is a failure", () => {
  const w = sampleWorld();
  const fixed = issueOf({ id: "x", severity: "problem", title: "t", detail: "What it is.", fix: { label: "Fix it", run: () => "fixed" } });
  expect([fixed.decision, fixed.fixes.map((f) => f.label), fixed.fixes[0]!.preview]).toEqual([false, ["Fix it"], "What it is."]);
  expect(fixed.fixes[0]!.run(w)).toBe("fixed");
  const choice = issueOf({
    id: "y",
    severity: "suggestion",
    title: "t",
    detail: "What it is.",
    choices: [
      { label: "One", hint: "the first", run: () => "one" },
      {
        label: "Two",
        run: () => {
          throw new Error("two: no");
        },
      },
    ],
  });
  expect([choice.decision, choice.fixes.map((f) => f.label), choice.fixes[0]!.preview]).toEqual([true, ["One", "Two"], "The first. What it is."]);
  expect(choice.fixes[1]!.run(w)).toEqual(failed("two: no"));
  // Nothing skilllib can do: still your call, with no fix to run.
  expect(issueOf({ id: "z", severity: "suggestion", title: "t", detail: "d" })).toMatchObject({ decision: true, fixes: [] });
});

test("each of doctor's issues shows on the rows it names: a repo's, Global's, a plugin's, your library's", () => {
  const w = sampleWorld();
  const ids = (issues: { id: string }[]) => issues.map((i) => i.id);
  // A repo copy also loaded globally: on every repo's row, and on Global's.
  expect(ids(issuesAt(w, "web-app", "stripe-payments"))).toContain("twice:stripe-payments");
  expect(ids(issuesAt(w, "api-server", "stripe-payments"))).toContain("twice:stripe-payments");
  expect(ids(issuesAt(w, null, "stripe-payments"))).toContain("twice:stripe-payments");
  // A repo's grouped issue is on each skill it names, and counts once for the repo.
  expect(ids(issuesAt(w, "web-app", "deploy-preview"))).toEqual(["usable:~/Projects/web-app"]);
  expect(ids(repoIssues(w, "web-app")).filter((id) => id === "usable:~/Projects/web-app")).toHaveLength(1);
  // Plugins: Claude Code's by id, Cursor's by name.
  const plugin = (id: string) => ids(pluginIssues(w, w.plugins.find((p) => p.id === id)!));
  expect(plugin("vercel@claude-plugins-official")).toEqual(["plugin:vercel@claude-plugins-official", "plugin-update:vercel@claude-plugins-official"]);
  expect(plugin("react-kit@cursor-public")).toEqual(["cursor-plugin:react-kit"]);
  expect(plugin("railway@claude-plugins-official")).toEqual([]);
  // Your skills only shows the library's own: in no repo, unused (from usage, which the app adds once it's read).
  w.issues = [...w.issues, ...w.ops.usageIssues(w)];
  expect(ids(libraryIssues(w, "sql-migrations"))).toEqual(["unused:library"]);
  // An install's own issue is only on that install's row.
  expect(plugin("stripe-tools@acme")).toEqual(["plugin:~/Projects/api-server:stripe-tools@acme", "plugin-unused:~/Projects/api-server:stripe-tools@acme"]);
  expect(ids(pluginIssues(w, { ...w.plugins.find((p) => p.id === "stripe-tools@acme")!, projectPath: undefined }))).toEqual(["plugin:~/Projects/api-server:stripe-tools@acme"]);
  // Each issue's view is made once.
  expect(issuesAt(w, "web-app", "seo-meta")[0]).toBe(issuesAt(w, "web-app", "seo-meta")[0]);
  expect(libraryIssues(w, "stripe-payments")).toEqual([]);
});

test("a fix runs doctor's choice, and the issue goes", () => {
  const w = sampleWorld();
  const [stop] = issuesAt(w, "web-app", "stripe-payments").find((i) => i.id === "twice:stripe-payments")!.fixes;
  expect(stop!.run(w)).toBe("stripe-payments no longer loads globally");
  expect(issuesAt(w, "web-app", "stripe-payments").map((i) => i.id)).not.toContain("twice:stripe-payments");
  expect(w.machine.some((m) => m.name === "stripe-payments" && m.source === "global")).toBe(false);
});
