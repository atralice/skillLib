import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setHarnesses } from "./config.js";
import { addSkill, importSkill, linkEverywhere, listBackups, projectStatus, restoreBackup } from "./library.js";
import { readManifest } from "./project.js";
import { applyTidy, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy } from "./tidy.js";
import { forgetLatest } from "./versions.js";

let tmp: string;
let project: string;
const realHome = process.env.HOME;

function writeSkill(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}
const at = (dir: string, name: string) => join(project, dir, "skills", name);
const isLink = (p: string) => lstatSync(p).isSymbolicLink();
const tidyAll = (opts: Parameters<typeof applyTidy>[1] = { git: "go" }) => planProjectTidy(project).plans.map((p) => applyTidy(p, opts));

beforeEach(() => {
  forgetLatest();
  tmp = mkdtempSync(join(tmpdir(), "skilllib-tidy-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  project = join(tmp, "project");
  mkdirSync(project);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("project tidy", () => {
  test("identical copies become one real copy plus a link, restorable from Health", () => {
    setHarnesses(["claude-code", "cursor", "codex"]);
    writeSkill(at(".claude", "flow"), "same");
    writeSkill(at(".agents", "flow"), "same");

    const [plan] = planProjectTidy(project).plans;
    expect(plan?.steps).toEqual([{ kind: "replace", path: at(".claude", "flow"), target: at(".agents", "flow") }]);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".claude", "flow"))).toBe(true);
    expect(isLink(at(".agents", "flow"))).toBe(false);
    expect(planProjectTidy(project).plans).toEqual([]);

    const backup = listBackups().find((b) => b.kind === "tidy-backup");
    expect(backup?.from).toBe(at(".claude", "flow"));
    expect(restoreBackup(backup!)).toMatchObject({ ok: true });
    expect(isLink(at(".claude", "flow"))).toBe(false);
  });

  test("a skill `npx skills` installed keeps its .agents/skills copy, matching its symlink layout", () => {
    setHarnesses(["claude-code", "cursor", "codex"]);
    writeSkill(at(".claude", "video-edit"), "same");
    writeSkill(at(".agents", "video-edit"), "same");
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "video-edit": { source: "genmedia-labs/skills" } } }));

    const [plan] = planProjectTidy(project).plans;
    expect(plan?.steps).toEqual([{ kind: "replace", path: at(".claude", "video-edit"), target: at(".agents", "video-edit") }]);
  });

  test("removes links no agent needs and repoints broken ones, but never adds links", () => {
    setHarnesses(["claude-code", "cursor", "codex"]);
    writeSkill(at(".agents", "refactor"), "r");
    mkdirSync(join(project, ".cursor", "skills"), { recursive: true });
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    symlinkSync("../../.agents/skills/refactor", at(".cursor", "refactor"));
    symlinkSync("../../nowhere/refactor", at(".claude", "refactor"));
    writeSkill(at(".claude", "local"), "l"); // Codex can't see it: that's "make usable", not tidy

    tidyAll();
    expect(existsSync(at(".cursor", "refactor"))).toBe(false);
    expect(existsSync(join(at(".claude", "refactor"), "SKILL.md"))).toBe(true);
    expect(existsSync(at(".agents", "local"))).toBe(false);
    expect(planProjectTidy(project).plans).toEqual([]);
  });

  test("copies that differ are reported with which agent runs which, and only fixed when you choose", () => {
    setHarnesses(["claude-code", "cursor", "codex"]);
    writeSkill(at(".claude", "deploy"), "claude version");
    writeSkill(at(".agents", "deploy"), "agents version");

    const report = planProjectTidy(project);
    expect(report.plans).toEqual([]);
    expect(report.conflicts).toEqual([
      {
        name: "deploy",
        root: project,
        copies: [
          { dir: join(project, ".claude", "skills"), path: at(".claude", "deploy"), runs: ["claude-code", "cursor"] },
          { dir: join(project, ".agents", "skills"), path: at(".agents", "deploy"), runs: ["codex"] },
        ],
      },
    ]);

    // A folder without a copy picks nothing: still a conflict.
    expect(planProjectTidy(project, { keep: { deploy: join(project, ".nope", "skills") } }).conflicts.map((c) => c.name)).toEqual(["deploy"]);
    const [plan] = planProjectTidy(project, { keep: { deploy: join(project, ".agents", "skills") } }).plans;
    // The copy it replaces isn't a duplicate: the step says so.
    expect(plan!.steps.map((s) => describeStep(s, project))).toEqual([".claude/skills/deploy: differing copy → link"]);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".claude", "deploy"))).toBe(true);
    expect(readFileSync(join(at(".claude", "deploy"), "SKILL.md"), "utf-8")).toContain("agents version");
  });

  test("never moves a managed copy and keeps the links skilllib.json records", () => {
    writeSkill(join(tmp, "src", "alpha"), "v1");
    importSkill(join(tmp, "src", "alpha"));
    setHarnesses(["claude-code", "codex"]);
    addSkill(project, "alpha");
    writeSkill(at(".cursor", "alpha"), "v1"); // a stray identical copy

    setHarnesses(["claude-code"]); // .agents/skills isn't needed any more, but a teammate may use Codex
    const [plan] = planProjectTidy(project).plans;
    expect(plan?.steps).toEqual([{ kind: "remove", path: at(".cursor", "alpha") }]);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".claude", "alpha"))).toBe(true);
    expect(readManifest(project).skills.alpha?.links).toEqual([".claude/skills"]);
  });

  test("a managed skill's duplicate becomes a link skilllib.json records, so sync keeps it", () => {
    writeSkill(join(tmp, "src", "alpha"), "v1");
    importSkill(join(tmp, "src", "alpha"));
    setHarnesses(["claude-code"]);
    addSkill(project, "alpha");
    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".agents", "alpha"), "v1");
    tidyAll();
    expect(isLink(at(".agents", "alpha"))).toBe(true);
    expect(readManifest(project).skills.alpha?.links).toEqual([".agents/skills"]);
  });

  test("skips a skill that links outside the repo", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(join(tmp, "elsewhere", "ext"), "e");
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    symlinkSync(join(tmp, "elsewhere", "ext"), at(".claude", "ext"));
    writeSkill(at(".agents", "ext"), "e");
    expect(planProjectTidy(project)).toMatchObject({ plans: [], skipped: [{ name: "ext", reason: ".claude/skills/ext links outside the repo" }] });
  });
});

describe("git", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
  beforeEach(() => {
    git("init", "-q");
    writeFileSync(join(project, ".gitignore"), ".claude/\n");
  });

  test("keeps the committed copy and changes nothing git sees", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".agents", "team"), "t");
    git("add", ".");
    writeSkill(at(".claude", "team"), "t");

    const [plan] = planProjectTidy(project).plans;
    expect(plan?.primary).toBe(at(".agents", "team"));
    expect(gitVisibleSteps(plan!)).toEqual([]);
    applyTidy(plan!);
    expect(isLink(at(".claude", "team"))).toBe(true);
  });

  test("holds back changes to committed files until you say go", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".claude", "both"), "b");
    writeSkill(at(".agents", "both"), "b");
    git("add", "-f", ".");

    const [plan] = planProjectTidy(project).plans;
    expect(gitVisibleSteps(plan!)).toEqual([{ kind: "replace", path: at(".claude", "both"), target: at(".agents", "both") }]);
    expect(applyTidy(plan!).held).toHaveLength(1);
    expect(isLink(at(".claude", "both"))).toBe(false);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".claude", "both"))).toBe(true);
  });
});

describe("global tidy", () => {
  const g = (dir: string, name: string) => join(tmp, dir, "skills", name);

  test("keeps the ~/.agents/skills copy and links the identical ~/.claude/skills one to it", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(g(".claude", "web"), "same");
    writeSkill(g(".agents", "web"), "same");
    writeSkill(g(".claude", "solo"), "only one copy: nothing to do");

    const { plans } = planGlobalTidy();
    expect(plans.map((p) => p.steps)).toEqual([[{ kind: "replace", path: g(".claude", "web"), target: g(".agents", "web") }]]);
    applyTidy(plans[0]!);
    expect(isLink(g(".claude", "web"))).toBe(true);
    expect(planGlobalTidy().plans).toEqual([]);
  });

  test("tidy never rewrites ~/.grok/skills, even when it matches ~/.agents/skills", () => {
    setHarnesses(["grok"]);
    writeSkill(g(".agents", "web"), "same");
    writeSkill(g(".grok", "web"), "same");
    expect(planGlobalTidy().plans.flatMap((p) => p.steps).filter((s) => s.path.includes(".grok"))).toEqual([]);
    expect(lstatSync(g(".grok", "web")).isSymbolicLink()).toBe(false);
  });

  test("reports differing copies and leaves Claude Code plugins in skill folders alone", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(g(".claude", "web"), "a");
    writeSkill(g(".agents", "web"), "b");
    writeSkill(g(".claude", "tool"), "t");
    writeSkill(g(".agents", "tool"), "t");
    mkdirSync(join(g(".claude", "tool"), ".claude-plugin"));
    writeFileSync(join(g(".claude", "tool"), ".claude-plugin", "plugin.json"), "{}");

    const report = planGlobalTidy();
    expect(report.plans).toEqual([]);
    expect(report.conflicts.map((c) => [c.name, c.copies.map((x) => x.runs)])).toEqual([["web", [["claude-code"], ["codex"]]]]);
    // Keeping a folder with no copy of it never replaces one differing copy with another.
    const unknown = planGlobalTidy({ keep: { web: join(tmp, ".nope", "skills") } });
    expect([unknown.plans, unknown.conflicts.map((c) => c.name)]).toEqual([[], ["web"]]);
    const kept = planGlobalTidy({ keep: { web: join(tmp, ".agents", "skills") } });
    expect(kept.plans.flatMap((p) => p.steps.map((s) => describeStep(s, null)))).toEqual([`${g(".claude", "web").replace(tmp, "~").replace(/\\/g, "/")}: differing copy → link`]);
    expect(report.skipped.map((s) => s.name)).toEqual(["tool"]);
  });
});

describe("folders that aren't one agent's", () => {
  test("the team's .agents/skills copy stays the repo skill when Cursor's folder has a copy too", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".agents", "team"), "x");
    writeSkill(at(".cursor", "team"), "x");
    expect(projectStatus(project).map((s) => [s.location, s.state])).toEqual([[".agents/skills", "repo skill"]]);
  });

  test("Cursor's links go in .agents/skills, and tidy never touches .grok/skills (Grok's folder)", () => {
    setHarnesses(["cursor"]);
    writeSkill(at(".claude", "solo"), "x");
    linkEverywhere(project, "solo", ".claude/skills");
    expect(existsSync(at(".cursor", "solo"))).toBe(false);

    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".agents", "g"), "same");
    writeSkill(at(".grok", "g"), "same");
    expect(planProjectTidy(project).plans.flatMap((p) => p.steps).filter((s) => s.path.includes(".grok"))).toEqual([]);
  });

  test("Codex runs every copy it reads; Cursor runs the one it picks first", () => {
    setHarnesses(["codex", "cursor"]);
    writeSkill(at(".agents", "x"), "one");
    writeSkill(at(".codex", "x"), "two");
    const [conflict] = planProjectTidy(project).conflicts;
    expect(conflict?.copies.map((c) => [relative(project, c.dir).replace(/\\/g, "/"), c.runs])).toEqual([
      [".agents/skills", ["codex"]],
      [".codex/skills", ["cursor", "codex"]],
    ]);
  });
});
