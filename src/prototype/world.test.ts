import { expect, test } from "bun:test";
import { addRows, issuesOf, machineActions, machineIssues, projectIssues, sampleWorld, usable, type World } from "./world.js";

const ids = (w: ReturnType<typeof sampleWorld>, p: string) => projectIssues(w, p).map((x) => x.issue.id);

test("sample web-app shows every kind of issue", () => {
  const found = new Set(ids(sampleWorld(), "web-app").map((id) => id.split(":")[0]));
  for (const kind of ["missing", "twice-g", "twice-p", "edited", "outdated", "blind", "local", "unused", "global", "dup-plugin", "broken"]) expect(found).toContain(kind);
});

test("keeping the repo copy unloads the global one and clears the duplicate", () => {
  const w = sampleWorld();
  const stripe = usable(w, "web-app").find((u) => u.local && u.name === "stripe-payments")!;
  const dup = issuesOf(w, "web-app", stripe).find((i) => i.id === "twice-g:stripe-payments")!;
  dup.fixes[0]!.run(w);
  expect(ids(w, "web-app")).not.toContain("twice-g:stripe-payments");
  expect(w.machine.some((m) => m.name === "stripe-payments")).toBe(false);
  expect(w.backups[0]?.name).toBe("stripe-payments");
});

test("turning a plugin off in one repo leaves it on elsewhere", () => {
  const w = sampleWorld();
  const vd = usable(w, "web-app").find((u) => u.local && u.name === "vercel-deploy")!;
  issuesOf(w, "web-app", vd).find((i) => i.id.startsWith("twice-p"))!.fixes.at(-1)!.run(w);
  expect(usable(w, "web-app").some((u) => u.source === "plugin" && u.name === "nextjs")).toBe(false);
  expect(usable(w, "api-server").some((u) => u.source === "plugin" && u.name === "nextjs")).toBe(true);
});

test("add box: library skills not usable here yet, then create", () => {
  const w = sampleWorld();
  const names = (q: string) => addRows(w, "web-app", q).filter((r) => !r.header && !r.create && !r.agent).map((r) => r.name);
  expect(names("")).toEqual(["mdx-tips", "sql-migrations"]);
  expect(names("sql")).toEqual(["sql-migrations"]);
  expect(addRows(w, "web-app", "stripe-payments").filter((r) => !r.header)).toEqual([]);
  const create = addRows(w, "web-app", "gql-schema").find((r) => r.create)!;
  create.run!(w);
  expect(usable(w, "web-app").some((u) => u.name === "gql-schema" && u.source === "lib")).toBe(true);
});

test("Global only offers fixes that act on global skills, never on a repo", () => {
  const base = sampleWorld();
  const fixes = (w: World, i: number) => {
    const m = w.machine[i]!;
    return [...machineIssues(w, m).flatMap((x) => x.fixes), ...machineActions(m)].filter((f) => !f.pickRepos); // moving to repos needs you to tick them
  };
  base.machine.forEach((_, i) => {
    fixes(base, i).forEach((_, j) => {
      const w = structuredClone(base);
      fixes(w, i)[j]!.run(w);
      expect(w.projects).toEqual(base.projects);
    });
  });
});

test("repo fixes change the world they're given, not the one they were built from", () => {
  const base = sampleWorld();
  const react = usable(base, "web-app").find((u) => u.local && u.name === "react-patterns")!;
  const update = issuesOf(base, "web-app", react).find((i) => i.id.startsWith("outdated"))!.fixes[0]!;
  const w = structuredClone(base);
  update.run(w);
  expect(usable(w, "web-app").find((u) => u.name === "react-patterns")!.local!.version).toBe(2);
  expect(react.local!.version).toBe(1);
});
