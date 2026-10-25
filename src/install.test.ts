import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setHarnesses } from "./config.js";
import { installGlobal, parseInstallSpec, findSkillDirs } from "./install.js";
import { importSkill, projectStatus } from "./library.js";
import { keptGlobal } from "./config.js";

let tmp: string;
let project: string;
const realHome = process.env.HOME;

function skill(dir: string, name = "alpha") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\nbody\n`);
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-install-")));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  setHarnesses(["claude-code"]);
  project = join(tmp, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("parseInstallSpec", () => {
  test("reads the forms skills.sh and GitHub use", () => {
    expect(parseInstallSpec("anthropics/skills")).toEqual({ owner: "anthropics", repo: "skills" });
    expect(parseInstallSpec("anthropics/skills@frontend-design")).toEqual({ owner: "anthropics", repo: "skills", skill: "frontend-design" });
    expect(parseInstallSpec("anthropics/skills/frontend-design")).toEqual({ owner: "anthropics", repo: "skills", skill: "frontend-design" });
    expect(parseInstallSpec("https://skills.sh/anthropics/skills/frontend-design")).toEqual({ owner: "anthropics", repo: "skills", skill: "frontend-design" });
    expect(parseInstallSpec("https://github.com/anthropics/skills")).toEqual({ owner: "anthropics", repo: "skills" });
    expect(parseInstallSpec("https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines")).toEqual({
      owner: "vercel-labs",
      repo: "agent-skills",
      skill: "skills/web-design-guidelines",
    });
    expect(parseInstallSpec("../skills")).toEqual({ local: expect.stringContaining("skills") });
    expect(parseInstallSpec("not a source")).toBeNull();
  });
});

describe("install", () => {
  test("a folder of skills lists each one, and not the ones nested inside a skill", () => {
    skill(join(tmp, "pack", "one"), "one");
    skill(join(tmp, "pack", "two"), "two");
    skill(join(tmp, "pack", "one", "nested"), "nested");
    expect(findSkillDirs(join(tmp, "pack")).map((d) => basename(d)).sort()).toEqual(["one", "two"]);
  });

  test("installs a local skill into this project", () => {
    skill(join(tmp, "src", "alpha"), "alpha");
    const out = execFileSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", join(tmp, "src", "alpha"), "--json"], {
      cwd: project,
      env: process.env,
      encoding: "utf-8",
    });
    const [row] = JSON.parse(out);
    expect(row).toMatchObject({ name: "alpha", status: "added", project: { action: "installed" } });
    expect(existsSync(join(project, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
    expect(projectStatus(project).map((s) => s.name)).toEqual(["alpha"]);
  });

  test("does not treat a repo's skills/ authoring folder as installed skills", () => {
    skill(join(project, "skills", "authored"), "authored");
    expect(projectStatus(project).map((s) => s.name)).toEqual([]);
  });

  test("--global puts one real copy where Claude reads and a link where Windsurf reads", () => {
    setHarnesses(["claude-code", "windsurf"]);
    skill(join(tmp, "src", "alpha"), "alpha");
    importSkill(join(tmp, "src", "alpha"));
    const placed = installGlobal("alpha");
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const real = join(tmp, ".claude", "skills", "alpha");
    const link = join(tmp, ".codeium", "windsurf", "skills", "alpha");
    expect(existsSync(join(real, "SKILL.md"))).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain("alpha");
    expect([...keptGlobal()]).toContain("alpha");
  });
});
