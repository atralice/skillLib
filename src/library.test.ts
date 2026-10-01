import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSkill, importSkill, nestedSkills, projectStatus, removeSkill, syncProject, updateProject } from "./library.js";
import { forgetLatest, latestVersion, versionHistory } from "./versions.js";
import { readManifest } from "./project.js";
import { setHarnesses } from "./config.js";
import { execFileSync } from "node:child_process";

let tmp: string;
let project: string;

function writeSkill(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}

const lib = (name: string) => join(tmp, "home", "library", name);
const local = (name: string) => join(project, ".claude", "skills", name);
const stateOf = (name: string) => projectStatus(project).find((s) => s.name === name)?.state;

const realHome = process.env.HOME;

beforeEach(() => {
  forgetLatest();
  tmp = mkdtempSync(join(tmpdir(), "skilllib-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  setHarnesses(["claude-code"]);
  project = join(tmp, "project");
  mkdirSync(project);
  writeSkill(join(tmp, "src", "alpha"), "v1");
  importSkill(join(tmp, "src", "alpha"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("library", () => {
  test("add copies the skill and records it", () => {
    expect(addSkill(project, "alpha")).toEqual({ name: "alpha", action: "installed", to: 1 });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v1");
    expect(Object.keys(readManifest(project).skills)).toEqual(["alpha"]);
    expect(stateOf("alpha")).toBe("ok");
    expect(addSkill(project, "missing")).toMatchObject({ action: "skipped" });
  });

  test("library changes become versions; update moves to the newest, keeping local edits unless forced", () => {
    addSkill(project, "alpha");
    expect(readManifest(project).skills.alpha?.version).toBe(1);
    writeSkill(lib("alpha"), "v2");
    forgetLatest();
    expect(projectStatus(project)[0]).toMatchObject({ state: "update available", version: 1, latest: 2 });
    expect(syncProject(project)).toEqual([]);
    expect(updateProject(project)).toEqual([{ name: "alpha", action: "updated", from: 1, to: 2 }]);
    expect(stateOf("alpha")).toBe("ok");

    writeSkill(lib("alpha"), "v3");
    forgetLatest();
    writeSkill(local("alpha"), "mine");
    expect(stateOf("alpha")).toBe("edited locally, update available");
    expect(updateProject(project)[0]).toMatchObject({ action: "skipped" });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("mine");

    updateProject(project, undefined, { force: true });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v3");
    expect(versionHistory("alpha").map((v) => v.version)).toEqual([1, 2, 3]);
  });

  test("sync installs the exact recorded version even after the library moved on", () => {
    addSkill(project, "alpha");
    writeSkill(lib("alpha"), "v2");
    forgetLatest();
    latestVersion("alpha");
    rmSync(local("alpha"), { recursive: true });

    expect(syncProject(project)).toEqual([{ name: "alpha", action: "installed", from: 1, to: 1 }]);
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v1");
    expect(addSkill(project, "alpha", { version: 1 })).toMatchObject({ to: 1 });
  });

  test("reads 0.3 manifests that stored only a hash", () => {
    addSkill(project, "alpha");
    const { hash } = readManifest(project).skills.alpha!;
    writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: hash } }));
    expect(readManifest(project).skills.alpha).toEqual({ version: 1, hash });
    expect(stateOf("alpha")).toBe("ok");
  });

  test("importing a project's edited copy updates the library", () => {
    addSkill(project, "alpha");
    writeSkill(local("alpha"), "improved");
    expect(importSkill(local("alpha"))).toEqual({ name: "alpha", status: "exists" });
    expect(importSkill(local("alpha"), { force: true })).toEqual({ name: "alpha", status: "updated" });
    expect(readFileSync(join(lib("alpha"), "SKILL.md"), "utf-8")).toContain("improved");
  });

  test("restores a deleted folder and reports unmanaged skills", () => {
    addSkill(project, "alpha");
    forgetLatest();
    rmSync(local("alpha"), { recursive: true });
    expect(stateOf("alpha")).toBe("folder missing");
    syncProject(project);
    expect(stateOf("alpha")).toBe("ok");

    writeSkill(local("handmade"), "hi");
    expect(stateOf("handmade")).toBe("local only");
  });

  test("won't overwrite an unmanaged folder or delete edits without --force", () => {
    writeSkill(local("alpha"), "handwritten");
    expect(addSkill(project, "alpha")).toMatchObject({ action: "skipped" });
    expect(addSkill(project, "alpha", { force: true })).toMatchObject({ action: "updated" });

    writeSkill(local("alpha"), "edited");
    expect(removeSkill(project, "alpha")).toMatchObject({ action: "skipped" });
    expect(removeSkill(project, "alpha", { force: true })).toEqual({ name: "alpha", action: "removed" });
    expect(existsSync(local("alpha"))).toBe(false);
  });

  test("copies symlinked skills as real files so edits never reach the original", () => {
    const original = join(tmp, "agents", "linked");
    writeSkill(original, "original");
    mkdirSync(join(tmp, "global"));
    symlinkSync(original, join(tmp, "global", "linked"));

    importSkill(join(tmp, "global", "linked"));
    addSkill(project, "linked");
    expect(lstatSync(lib("linked")).isSymbolicLink()).toBe(false);
    expect(lstatSync(local("linked")).isSymbolicLink()).toBe(false);

    writeSkill(lib("linked"), "changed in library");
    writeSkill(local("linked"), "changed in project");
    expect(readFileSync(join(original, "SKILL.md"), "utf-8")).toContain("original");
  });
});

describe("moving skills out of the way", () => {
  test("delete moves an unused library skill to trash and refuses while installed", async () => {
    const { deleteLibrarySkill } = await import("./library.js");
    const { rememberProjects } = await import("./project.js");
    addSkill(project, "alpha");
    rememberProjects([project]);
    expect(deleteLibrarySkill("alpha")).toMatchObject({ ok: false });

    removeSkill(project, "alpha");
    const result = deleteLibrarySkill("alpha");
    expect(result.ok).toBe(true);
    expect(existsSync(lib("alpha"))).toBe(false);
    if (result.ok) expect(existsSync(join(result.movedTo, "SKILL.md"))).toBe(true);
  });

  test("unloading a global skill needs it in the library, keeps symlink targets intact, and moves its links too", async () => {
    const { unloadGlobal, restoreBackup, listBackups } = await import("./library.js");
    const { machineSkills } = await import("./sources.js");
    const agents = join(tmp, ".agents", "skills", "linked");
    writeSkill(agents, "original");
    mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
    symlinkSync(agents, join(tmp, ".claude", "skills", "linked"));
    setHarnesses(["claude-code", "cursor", "codex"]);

    const [linked] = machineSkills().filter((m) => m.name === "linked");
    expect(linked).toMatchObject({ path: agents, harnesses: ["claude-code", "cursor", "codex"], links: [join(tmp, ".claude", "skills", "linked")] });
    expect(unloadGlobal(agents)).toEqual({ ok: false, reason: "import it into the library first" });

    importSkill(agents);
    expect(unloadGlobal(agents, linked!.links).ok).toBe(true);
    expect(machineSkills().filter((m) => m.name === "linked")).toEqual([]);
    expect(existsSync(join(tmp, ".claude", "skills", "linked"))).toBe(false);

    for (const b of listBackups()) restoreBackup(b);
    expect(readFileSync(join(agents, "SKILL.md"), "utf-8")).toContain("original");
    expect(lstatSync(join(tmp, ".claude", "skills", "linked")).isSymbolicLink()).toBe(true);
  });
});

describe("harnesses", () => {
  test("repo skills in .agents/skills load in Codex and Cursor but not Claude Code until linked", async () => {
    const { linkEverywhere, unlinkEverywhere } = await import("./library.js");
    setHarnesses(["claude-code", "cursor", "codex"]);
    const repo = (name: string) => join(project, ".agents", "skills", name);
    writeSkill(repo("team-flow"), "team");

    const status = () => projectStatus(project).find((s) => s.name === "team-flow");
    expect(status()).toMatchObject({
      state: "repo skill",
      location: ".agents/skills",
      visibility: [
        { id: "claude-code", paths: 0 },
        { id: "cursor", paths: 1 },
        { id: "codex", paths: 1 },
      ],
    });

    expect(linkEverywhere(project, "team-flow", ".agents/skills")).toEqual({ created: [".claude/skills"], blocked: [] });
    expect(lstatSync(local("team-flow")).isSymbolicLink()).toBe(true);
    // One skill, reported once; Cursor now reaches it through two folders.
    expect(projectStatus(project).filter((s) => s.name === "team-flow")).toHaveLength(1);
    expect(status()?.visibility).toEqual([
      { id: "claude-code", paths: 1 },
      { id: "cursor", paths: 2 },
      { id: "codex", paths: 1 },
    ]);
    expect(unlinkEverywhere(project, "team-flow")).toEqual([".claude/skills"]);
    expect(existsSync(repo("team-flow"))).toBe(true);
  });

  test("with Claude Code and Codex, the real copy goes in .agents/skills and Claude Code gets a link, like npx skills", () => {
    setHarnesses(["claude-code", "codex"]);
    expect(addSkill(project, "alpha")).toMatchObject({ action: "installed", to: 1 });
    expect(readManifest(project).skills.alpha).toMatchObject({ dir: ".agents/skills", links: [".claude/skills"] });
    expect(lstatSync(join(project, ".agents", "skills", "alpha")).isDirectory()).toBe(true);
    expect(lstatSync(local("alpha")).isSymbolicLink()).toBe(true);
    expect(projectStatus(project)[0]?.visibility).toEqual([
      { id: "claude-code", paths: 1 },
      { id: "codex", paths: 1 },
    ]);

    removeSkill(project, "alpha");
    expect(existsSync(join(project, ".agents", "skills", "alpha"))).toBe(false);
    expect(existsSync(local("alpha"))).toBe(false);
  });

  test("won't write links into a git-tracked folder without consent", () => {
    execFileSync("git", ["init", "-q"], { cwd: project });
    writeSkill(local("team"), "t");
    execFileSync("git", ["add", "."], { cwd: project });
    setHarnesses(["claude-code", "codex"]);

    expect(addSkill(project, "alpha")).toMatchObject({ action: "installed", blocked: [".claude/skills"] });
    expect(existsSync(local("alpha"))).toBe(false);
    expect(addSkill(project, "alpha", { allowTracked: true })).toMatchObject({ action: "updated" });
    expect(existsSync(join(local("alpha"), "SKILL.md"))).toBe(true);
  });

  test("without Claude Code, the one real copy goes in .agents/skills, which Cursor and Codex both read", () => {
    setHarnesses(["cursor", "codex"]);
    addSkill(project, "alpha");
    const agents = join(project, ".agents", "skills", "alpha");
    expect(lstatSync(agents).isDirectory()).toBe(true);
    expect(existsSync(local("alpha"))).toBe(false);
    expect(readManifest(project).skills.alpha).toMatchObject({ dir: ".agents/skills" });
    expect(readManifest(project).skills.alpha?.links).toBeUndefined();
    expect(projectStatus(project)[0]).toMatchObject({
      location: ".agents/skills",
      state: "ok",
      visibility: [
        { id: "cursor", paths: 1 },
        { id: "codex", paths: 1 },
      ],
    });

    // A teammate with Claude Code gets a link into .claude/skills; the copy stays put.
    setHarnesses(["claude-code", "cursor", "codex"]);
    expect(syncProject(project)).toEqual([]);
    addSkill(project, "alpha");
    expect(lstatSync(local("alpha")).isSymbolicLink()).toBe(true);
    expect(readManifest(project).skills.alpha).toMatchObject({ dir: ".agents/skills", links: [".claude/skills"] });

    removeSkill(project, "alpha");
    expect(existsSync(agents)).toBe(false);
    expect(existsSync(local("alpha"))).toBe(false);
  });

  test("tracking an untracked copy keeps it where it is instead of making a second one", () => {
    setHarnesses(["cursor", "codex"]);
    writeSkill(local("alpha"), "v1");
    expect(stateOf("alpha")).toBe("untracked copy of library skill");

    expect(addSkill(project, "alpha")).toMatchObject({ action: "updated", to: 1 });
    expect(lstatSync(local("alpha")).isDirectory()).toBe(true);
    expect(lstatSync(join(project, ".agents", "skills", "alpha")).isSymbolicLink()).toBe(true);
    expect(readManifest(project).skills.alpha).toMatchObject({ links: [".agents/skills"] });
    expect(readManifest(project).skills.alpha?.dir).toBeUndefined();
  });

  test("tracking a copy that's already linked into .agents/skills keeps the one real copy", () => {
    setHarnesses(["cursor", "codex"]);
    writeSkill(local("alpha"), "v1");
    mkdirSync(join(project, ".agents", "skills"), { recursive: true });
    symlinkSync("../../.claude/skills/alpha", join(project, ".agents", "skills", "alpha"));

    addSkill(project, "alpha");
    expect(lstatSync(local("alpha")).isDirectory()).toBe(true);
    expect(lstatSync(join(project, ".agents", "skills", "alpha")).isSymbolicLink()).toBe(true);
    expect(readManifest(project).skills.alpha).toMatchObject({ links: [".agents/skills"] });
    expect(projectStatus(project)[0]?.visibility).toEqual([
      { id: "cursor", paths: 2 },
      { id: "codex", paths: 1 },
    ]);
  });

  test("installDirs picks the fewest folders that reach every agent", async () => {
    const { installDirs } = await import("./harnesses.js");
    expect(installDirs(["claude-code"])).toEqual([".claude/skills"]);
    expect(installDirs(["claude-code", "cursor"])).toEqual([".claude/skills"]);
    expect(installDirs(["cursor"])).toEqual([".agents/skills"]);
    expect(installDirs(["codex"])).toEqual([".agents/skills"]);
    expect(installDirs(["cursor", "codex", "zed"])).toEqual([".agents/skills"]);
    // Claude Code reads only .claude/skills, Codex only .agents/skills: both are unavoidable.
    expect(installDirs(["claude-code", "cursor", "codex", "zed"])).toEqual([".agents/skills", ".claude/skills"]);
    expect(installDirs([])).toEqual([".claude/skills"]);
  });

  test("linkAll makes every skill usable by every enabled agent without copying anything", async () => {
    const { linkAll } = await import("./library.js");
    setHarnesses(["claude-code", "cursor"]);
    writeSkill(join(project, ".agents", "skills", "team-a"), "a");
    writeSkill(join(project, ".agents", "skills", "team-b"), "b");
    addSkill(project, "alpha");

    const res = linkAll(project);
    expect(res.linked.map((l) => [l.name, l.into])).toEqual([
      ["team-a", [".claude/skills"]],
      ["team-b", [".claude/skills"]],
    ]);
    expect(projectStatus(project).every((s) => s.visibility.every((v) => v.paths > 0))).toBe(true);
    expect(lstatSync(local("team-a")).isSymbolicLink()).toBe(true);
    expect(linkAll(project).linked).toEqual([]);
  });

  test("Zed only reads .agents/skills, so the copy goes there and Claude Code gets a link", () => {
    setHarnesses(["claude-code", "zed"]);
    addSkill(project, "alpha");
    expect(readManifest(project).skills.alpha).toMatchObject({ dir: ".agents/skills", links: [".claude/skills"] });
    expect(projectStatus(project)[0]?.visibility).toEqual([
      { id: "claude-code", paths: 1 },
      { id: "zed", paths: 1 },
    ]);
  });

  test("changing harnesses never moves existing installs", () => {
    addSkill(project, "alpha");
    setHarnesses(["codex"]);
    expect(projectStatus(project)[0]).toMatchObject({ location: ".claude/skills", state: "ok" });
    expect(syncProject(project)).toEqual([]);
  });
});

test("nested skill folders in a monorepo are found apart from the repo's own, with who loads them", () => {
  setHarnesses(["claude-code", "codex", "cursor"]);
  writeSkill(join(project, "packages", "web", ".claude", "skills", "lint"), "web");
  writeSkill(join(project, "packages", "api", ".agents", "skills", "lint"), "api");
  writeSkill(join(project, "packages", "web", ".claude", "skills", "alpha"), "v1");
  writeSkill(join(project, "node_modules", "dep", ".claude", "skills", "junk"), "x");
  writeSkill(join(project, ".agents", "skills", "shared"), "x");
  mkdirSync(join(project, "packages", "api", ".claude", "skills"), { recursive: true });
  symlinkSync(join(project, ".agents", "skills", "shared"), join(project, "packages", "api", ".claude", "skills", "shared"));
  mkdirSync(join(project, "vendored", ".git"), { recursive: true }); // a repo of its own
  writeSkill(join(project, "vendored", ".claude", "skills", "theirs"), "x");

  expect(projectStatus(project).map((s) => s.name)).toEqual(["shared"]);
  expect(nestedSkills(project).map((s) => [s.location, s.name, s.state, s.visibility])).toEqual([
    ["packages/api/.agents/skills", "lint", "repo skill", [{ id: "claude-code", paths: 0 }, { id: "cursor", paths: 1 }, { id: "codex", paths: 1 }]],
    ["packages/web/.claude/skills", "alpha", "untracked copy of library skill", [{ id: "claude-code", paths: 1 }, { id: "cursor", paths: 0 }, { id: "codex", paths: 0 }]],
    ["packages/web/.claude/skills", "lint", "local only", [{ id: "claude-code", paths: 1 }, { id: "cursor", paths: 0 }, { id: "codex", paths: 0 }]],
  ]);
});
