import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setHarnesses } from "./config.js";
import { dropOutsideLinks, installGlobal, nameRootSkill, parseInstallSpec, findSkillDirs } from "./install.js";
import { importSkill, librarySkillDir, projectStatus } from "./library.js";
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

  test.skipIf(process.platform === "win32")("a downloaded repo's links that point outside it are left out, and the files they point to stay", () => {
    const dl = join(tmp, "dl");
    skill(join(dl, "repo", "leaky"), "leaky");
    mkdirSync(join(dl, "repo", "shared"));
    writeFileSync(join(dl, "repo", "shared", "ref.md"), "inside");
    writeFileSync(join(tmp, "outside.txt"), "private");
    mkdirSync(join(tmp, "outside-dir"));
    writeFileSync(join(tmp, "outside-dir", "a.txt"), "private");
    symlinkSync(join(tmp, "outside.txt"), join(dl, "repo", "leaky", "file-out"));
    symlinkSync(join(tmp, "outside-dir"), join(dl, "repo", "leaky", "dir-out"));
    symlinkSync(join(tmp, "nothing-here"), join(dl, "repo", "leaky", "dangling"));
    symlinkSync(join(dl, "repo", "shared", "ref.md"), join(dl, "repo", "leaky", "ref.md"));

    expect(dropOutsideLinks(dl).map((p) => basename(p)).sort()).toEqual(["dangling", "dir-out", "file-out"]);
    expect(readFileSync(join(tmp, "outside.txt"), "utf-8")).toBe("private");
    expect(existsSync(join(tmp, "outside-dir", "a.txt"))).toBe(true);

    importSkill(join(dl, "repo", "leaky"));
    const inLibrary = librarySkillDir("leaky");
    expect(existsSync(join(inLibrary, "file-out"))).toBe(false);
    expect(existsSync(join(inLibrary, "dir-out"))).toBe(false);
    expect(readFileSync(join(inLibrary, "ref.md"), "utf-8")).toBe("inside");
  });

  test("install --json exits 1 when the library already has a different version of the skill", () => {
    const src = join(tmp, "src", "alpha");
    skill(src, "alpha");
    const run = () => spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src, "--json"], { cwd: project, env: process.env, encoding: "utf-8" });
    expect(run().status).toBe(0);
    writeFileSync(join(src, "SKILL.md"), "---\nname: alpha\ndescription: d\n---\nanother body\n");
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(second.stdout)[0]).toMatchObject({ name: "alpha", status: "exists" });
  });

  test("in a real git repo the pin is personal: the row says so, and nothing says to commit skilllib.json", () => {
    const repo = join(tmp, "real");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    const src = join(tmp, "src", "alpha");
    skill(src, "alpha");
    const json = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src, "--json"], { cwd: repo, env: process.env, encoding: "utf-8" });
    expect(json.status).toBe(0);
    expect(existsSync(join(repo, "skilllib.json"))).toBe(false);
    expect(JSON.parse(json.stdout)[0].project).toMatchObject({ action: "installed", personal: true, dirs: [".claude/skills"] });
    const text = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), "install", src], { cwd: repo, env: process.env, encoding: "utf-8" });
    expect(text.stdout + text.stderr).not.toContain("Commit skilllib.json");
  });

  test("a downloaded repo that is one skill takes the name in its SKILL.md, or the repo's name when it has none", () => {
    const dl = join(tmp, "dl");
    skill(join(dl, "skills-abc123"), "frontend-design");
    const named = nameRootSkill(dl, join(dl, "skills-abc123"), "skills");
    expect(named).toBe(join(dl, "frontend-design"));
    expect(findSkillDirs(named).map((d) => basename(d))).toEqual(["frontend-design"]);

    const dl2 = join(tmp, "dl2");
    mkdirSync(join(dl2, "tool-abc123"), { recursive: true });
    writeFileSync(join(dl2, "tool-abc123", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    expect(nameRootSkill(dl2, join(dl2, "tool-abc123"), "tool")).toBe(join(dl2, "tool"));

    // A repo of several skills has no SKILL.md at its root: its folder keeps its name.
    const dl3 = join(tmp, "dl3");
    skill(join(dl3, "pack-abc123", "one"), "one");
    expect(nameRootSkill(dl3, join(dl3, "pack-abc123"), "pack")).toBe(join(dl3, "pack-abc123"));
  });
});
