import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { addSkill, importSkill, listBackups, restoreBackup } from "./library.js";
import { readManifest } from "./project.js";
import { applyTidy, gitVisibleSteps, planGlobalTidy, planProjectTidy } from "./tidy.js";
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
    expect(plan?.steps).toEqual([{ kind: "replace", path: at(".agents", "flow"), target: at(".claude", "flow") }]);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".agents", "flow"))).toBe(true);
    expect(isLink(at(".claude", "flow"))).toBe(false);
    expect(planProjectTidy(project).plans).toEqual([]);

    const backup = listBackups().find((b) => b.kind === "tidy-backup");
    expect(backup?.from).toBe(at(".agents", "flow"));
    expect(restoreBackup(backup!)).toMatchObject({ ok: true });
    expect(isLink(at(".agents", "flow"))).toBe(false);
  });

  test("removes links no agent needs and adds the ones missing", () => {
    setHarnesses(["claude-code", "cursor", "codex"]);
    writeSkill(at(".agents", "refactor"), "r");
    mkdirSync(join(project, ".cursor", "skills"), { recursive: true });
    symlinkSync("../../.agents/skills/refactor", at(".cursor", "refactor"));
    writeSkill(at(".claude", "local"), "l");

    tidyAll();
    expect(existsSync(at(".cursor", "refactor"))).toBe(false);
    expect(isLink(at(".claude", "refactor"))).toBe(true);
    expect(isLink(at(".agents", "local"))).toBe(true);
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

    const [plan] = planProjectTidy(project, { keep: { deploy: join(project, ".agents", "skills") } }).plans;
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
    expect(isLink(at(".agents", "alpha"))).toBe(true);
    expect(readManifest(project).skills.alpha?.links).toEqual([".agents/skills"]);
  });

  test("records new links for managed skills so sync keeps them", () => {
    writeSkill(join(tmp, "src", "alpha"), "v1");
    importSkill(join(tmp, "src", "alpha"));
    setHarnesses(["claude-code"]);
    addSkill(project, "alpha");
    setHarnesses(["claude-code", "codex"]);
    tidyAll();
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

  test("holds back a new link git would show until you say go", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(at(".claude", "mine"), "m");

    const [plan] = planProjectTidy(project).plans;
    expect(gitVisibleSteps(plan!)).toEqual([{ kind: "link", path: at(".agents", "mine"), target: at(".claude", "mine") }]);
    expect(applyTidy(plan!).held).toHaveLength(1);
    expect(existsSync(at(".agents", "mine"))).toBe(false);
    applyTidy(plan!, { git: "go" });
    expect(isLink(at(".agents", "mine"))).toBe(true);
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
    expect(report.skipped.map((s) => s.name)).toEqual(["tool"]);
  });
});
