import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { writeState } from "./paths.js";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { addSkill, blindWithoutGlobal, createSkill, discardEdits, importSkill, linkAll, listBackups, nestedSkills, projectStatus, removeSkill, removeUntracked, restoreBackup, stash, syncProject, updateProject } from "./library.js";
import { moveGlobalSkills } from "./move.js";
import { planProjectTidy } from "./tidy.js";
import { forgetLatest, latestVersion, versionHistory } from "./versions.js";
import { copySkill, readSkillInfo, treeHash } from "./skills.js";
import { readManifest, rememberProjects } from "./project.js";
import { setHarnesses } from "./config.js";
import { tildify } from "./output.js";
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
  delete process.env.CODEX_HOME;
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
    // Not skilllib's before: installed (over a backup of what was there), not updated.
    expect(addSkill(project, "alpha", { force: true })).toMatchObject({ action: "installed" });

    writeSkill(local("alpha"), "edited");
    expect(removeSkill(project, "alpha")).toMatchObject({ action: "skipped" });
    expect(removeSkill(project, "alpha", { force: true })).toMatchObject({ name: "alpha", action: "removed", backedUp: expect.any(String) });
    expect(existsSync(local("alpha"))).toBe(false);
  });

  test("remove --force backs local edits up before removing the skill", () => {
    addSkill(project, "alpha");
    writeSkill(local("alpha"), "my edit");
    expect(removeSkill(project, "alpha")).toMatchObject({ action: "skipped", reason: expect.stringContaining("local edits") });
    const removed = removeSkill(project, "alpha", { force: true });
    expect(removed.action).toBe("removed");
    expect(readFileSync(join(removed.backedUp!, "SKILL.md"), "utf-8")).toContain("my edit");
    expect(existsSync(local("alpha"))).toBe(false);
    // An unedited copy has nothing to keep.
    addSkill(project, "alpha");
    expect(removeSkill(project, "alpha", { force: true })).toEqual({ name: "alpha", action: "removed" });
  });

  test("update --force and sync --force back local edits up before overwriting them", () => {
    addSkill(project, "alpha");
    writeSkill(lib("alpha"), "v2");
    forgetLatest();
    writeSkill(local("alpha"), "my edit");

    const updated = updateProject(project, ["alpha"], { force: true })[0]!;
    expect(updated).toMatchObject({ action: "updated", from: 1, to: 2 });
    expect(readFileSync(join(updated.backedUp!, "SKILL.md"), "utf-8")).toContain("my edit");
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v2");

    // Same version: sync puts it back, and says so ("reset", not "updated").
    writeSkill(local("alpha"), "another edit");
    expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: expect.stringContaining("local edits") }]);
    const [reset] = syncProject(project, { force: true });
    expect(reset).toMatchObject({ action: "reset", from: 2, to: 2 });

    // `skilllib restore` brings the edits back where they were.
    const backups = listBackups().filter((b) => b.kind === "edit-backup");
    expect(backups.map((b) => b.from)).toEqual([local("alpha"), local("alpha")]);
    expect(backups[0]!.path).toBe(reset!.backedUp!); // newest first, even within the same minute
    expect(restoreBackup(backups[0]!)).toMatchObject({ ok: true });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("another edit");
  });

  test("forced installs back up only what the library doesn't have", () => {
    addSkill(project, "alpha");
    writeSkill(lib("alpha"), "v2");
    forgetLatest();
    // An older library version isn't an edit: nothing to back up.
    expect(updateProject(project, ["alpha"], { force: true })[0]).not.toHaveProperty("backedUp");
    rmSync(local("alpha"), { recursive: true });
    expect(syncProject(project, { force: true })).toEqual([expect.objectContaining({ action: "installed" })]);
    expect(listBackups()).toEqual([]);
  });

  test("sync says when the library doesn't have a pinned skill", () => {
    addSkill(project, "alpha");
    rmSync(local("alpha"), { recursive: true });
    process.env.SKILLLIB_HOME = join(tmp, "other-home");
    forgetLatest();
    expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: expect.stringContaining("not in your library") }]);
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

  test("backups say where they came from: the library, or the repo folder a copy was in", async () => {
    const { backupFrom, deleteLibrarySkill, removeUntracked } = await import("./library.js");
    writeSkill(join(project, ".cursor", "skills", "mine"), "only here");
    removeUntracked(project, "mine", join(project, ".cursor", "skills", "mine"));
    expect(deleteLibrarySkill("alpha")).toMatchObject({ ok: true });
    const from = Object.fromEntries(listBackups().map((b) => [b.name, backupFrom(b)]));
    expect(from).toEqual({ mine: tildify(join(project, ".cursor", "skills")), alpha: "library (deleted)" });
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

    expect(linkEverywhere(project, "team-flow", ".agents/skills")).toEqual({ created: [".claude/skills"], blocked: [], uncommitted: [], inTheWay: [] });
    expect(lstatSync(local("team-flow")).isSymbolicLink()).toBe(true);
    // One skill, reported once; Cursor now reaches it through two folders.
    expect(projectStatus(project).filter((s) => s.name === "team-flow")).toHaveLength(1);
    expect(status()?.visibility).toEqual([
      { id: "claude-code", paths: 1 },
      { id: "cursor", paths: 2 },
      { id: "codex", paths: 1 },
    ]);
    // A link to a copy stays; once the copy is gone, the link points at nothing and goes.
    expect(unlinkEverywhere(project, "team-flow")).toEqual([]);
    rmSync(repo("team-flow"), { recursive: true });
    expect(unlinkEverywhere(project, "team-flow")).toEqual([".claude/skills"]);
    expect(lstatSync(local("team-flow"), { throwIfNoEntry: false })).toBeUndefined();
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
    writeSkill(join(project, ".agents", "skills", "other"), "o");
    execFileSync("git", ["add", "."], { cwd: project });
    setHarnesses(["claude-code", "codex"]);

    expect(addSkill(project, "alpha")).toMatchObject({ action: "installed", blocked: [".claude/skills"] });
    expect(existsSync(local("alpha"))).toBe(false);
    expect(addSkill(project, "alpha", { allowTracked: true })).toMatchObject({ action: "relinked" });
    expect(existsSync(join(local("alpha"), "SKILL.md"))).toBe(true);
  });

  test("add never links a copy git doesn't share into a folder git tracks, even when allowed (as link does)", () => {
    execFileSync("git", ["init", "-q"], { cwd: project });
    writeSkill(local("team"), "t"); // .claude/skills is tracked; .agents/skills, where the real copy goes, isn't
    execFileSync("git", ["add", "."], { cwd: project });
    setHarnesses(["claude-code", "codex"]);

    const c = addSkill(project, "alpha", { allowTracked: true });
    expect(c).toMatchObject({ action: "installed", uncommitted: [".claude/skills"] });
    expect(c.blocked).toBeUndefined();
    expect(existsSync(local("alpha"))).toBe(false);
    expect(readManifest(project).skills.alpha?.links).toBeUndefined();
  });

  test("Codex and Zed share .agents/skills: a folder held back is listed once", async () => {
    const { linkEverywhere } = await import("./library.js");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
    git("init", "-q");
    writeSkill(local("team"), "t");
    writeSkill(join(project, ".agents", "skills", "other"), "o");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    writeSkill(join(project, ".cursor", "skills", "mine"), "in a folder git doesn't track");
    setHarnesses(["claude-code", "codex", "zed"]);

    expect(linkEverywhere(project, "team", ".claude/skills")).toEqual({ created: [], blocked: [".agents/skills"], uncommitted: [], inTheWay: [] });
    expect(linkEverywhere(project, "mine", ".cursor/skills", { allowTracked: true })).toEqual({ created: [], blocked: [], uncommitted: [".claude/skills", ".agents/skills"], inTheWay: [] });
  });

  test("never links a skill git doesn't share into a folder git tracks, even when allowed", async () => {
    const { linkAll, linkEverywhere } = await import("./library.js");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(project, ".gitignore"), ".codex/skills/\n");
    writeSkill(local("team"), "t");
    writeSkill(join(project, ".agents", "skills", "shared"), "s");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    writeSkill(join(project, ".cursor", "skills", "mine"), "only on this machine"); // folder git doesn't track
    writeSkill(join(project, ".codex", "skills", "ignored"), "gitignored");
    writeSkill(join(project, ".agents", "skills", "fresh"), "new in a committed folder");
    setHarnesses(["claude-code", "cursor", "codex"]);

    expect(linkEverywhere(project, "mine", ".cursor/skills", { allowTracked: true })).toEqual({ created: [], blocked: [], uncommitted: [".claude/skills", ".agents/skills"], inTheWay: [] });
    expect(linkEverywhere(project, "ignored", ".codex/skills", { allowTracked: true })).toEqual({ created: [], blocked: [], uncommitted: [".claude/skills"], inTheWay: [] });
    // Not yet committed, but in a folder the repo commits: it goes in with the link.
    expect(linkEverywhere(project, "fresh", ".agents/skills", { allowTracked: true })).toEqual({ created: [".claude/skills"], blocked: [], uncommitted: [], inTheWay: [] });
    expect(existsSync(local("mine"))).toBe(false);

    const res = linkAll(project, { allowTracked: true });
    expect(res.linked.map((l) => l.name)).toEqual(["shared", "team"]);
    expect(res.uncommitted).toEqual(["ignored", "mine"]);
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

    expect(addSkill(project, "alpha")).toMatchObject({ action: "installed", to: 1 });
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
    expect(installDirs(["grok"])).toEqual([".agents/skills"]);
    expect(installDirs(["claude-code", "grok"])).toEqual([".claude/skills"]);
    expect(installDirs(["claude-code", "cursor", "codex", "zed", "grok"])).toEqual([".agents/skills", ".claude/skills"]);
    expect(installDirs([])).toEqual([".claude/skills"]);
  });

  test("Grok reads .claude/skills, so an install is not also linked into .grok/skills", () => {
    setHarnesses(["claude-code", "grok"]);
    addSkill(project, "alpha");
    expect(readManifest(project).skills.alpha?.links ?? []).toEqual([]);
    expect(existsSync(join(project, ".grok", "skills", "alpha"))).toBe(false);
    expect(projectStatus(project)[0]?.visibility).toEqual([
      { id: "claude-code", paths: 1 },
      { id: "grok", paths: 1 },
    ]);
  });

  test("a skill in .grok/skills is a repo skill Grok loads, and Claude gets a link", async () => {
    const { linkEverywhere } = await import("./library.js");
    setHarnesses(["claude-code", "grok"]);
    writeSkill(join(project, ".grok", "skills", "team-flow"), "team");

    expect(projectStatus(project).find((s) => s.name === "team-flow")).toMatchObject({
      state: "repo skill",
      location: ".grok/skills",
      visibility: [
        { id: "claude-code", paths: 0 },
        { id: "grok", paths: 1 },
      ],
    });
    expect(linkEverywhere(project, "team-flow", ".grok/skills")).toEqual({ created: [".claude/skills"], blocked: [], uncommitted: [], inTheWay: [] });
    expect(lstatSync(local("team-flow")).isSymbolicLink()).toBe(true);
  });

  test("a skill only Grok misses is linked into .agents/skills", async () => {
    const { linkEverywhere } = await import("./library.js");
    setHarnesses(["grok"]);
    writeSkill(join(project, ".codex", "skills", "only-codex"), "x");
    expect(linkEverywhere(project, "only-codex", ".codex/skills")).toEqual({ created: [".agents/skills"], blocked: [], uncommitted: [], inTheWay: [] });
    expect(lstatSync(join(project, ".agents", "skills", "only-codex")).isSymbolicLink()).toBe(true);
    expect(projectStatus(project).find((s) => s.name === "only-codex")?.visibility).toEqual([{ id: "grok", paths: 1 }]);
  });

  test("add and remove leave a skill committed in .grok/skills where the team put it", () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
    setHarnesses(["claude-code", "grok"]);
    writeSkill(join(project, ".grok", "skills", "alpha"), "v1");
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "team");

    expect(addSkill(project, "alpha")).toMatchObject({ action: "installed", to: 1 });
    expect(readManifest(project).skills.alpha?.dir).toBeUndefined();
    expect(readFileSync(join(project, ".grok", "skills", "alpha", "SKILL.md"), "utf-8")).toContain("v1");

    expect(removeSkill(project, "alpha")).toMatchObject({ action: "removed" });
    expect(existsSync(local("alpha"))).toBe(false);
    expect(readFileSync(join(project, ".grok", "skills", "alpha", "SKILL.md"), "utf-8")).toContain("v1");
  });

  test("removing a copy drops a .grok link that points at it or already dangles, and leaves a real .grok folder", async () => {
    const { removeUntracked, unlinkEverywhere } = await import("./library.js");
    setHarnesses(["claude-code", "grok"]);
    const copy = local("mine");
    writeSkill(copy, "only here");
    mkdirSync(join(project, ".grok", "skills"), { recursive: true });
    symlinkSync(copy, join(project, ".grok", "skills", "mine"));
    writeSkill(join(project, ".grok", "skills", "team"), "stays");

    removeUntracked(project, "mine", copy);
    expect(existsSync(copy)).toBe(false);
    expect(() => lstatSync(join(project, ".grok", "skills", "mine"))).toThrow();
    expect(readFileSync(join(project, ".grok", "skills", "team", "SKILL.md"), "utf-8")).toContain("stays");

    const elsewhere = join(project, ".agents", "skills", "other");
    writeSkill(elsewhere, "kept");
    symlinkSync(elsewhere, join(project, ".grok", "skills", "other"));
    symlinkSync(join(project, "missing"), join(project, ".grok", "skills", "gone"));
    expect(unlinkEverywhere(project, "other")).toEqual([]);
    expect(lstatSync(join(project, ".grok", "skills", "other")).isSymbolicLink()).toBe(true);
    expect(unlinkEverywhere(project, "gone")).toEqual([".grok/skills"]);
    expect(() => lstatSync(join(project, ".grok", "skills", "gone"))).toThrow();
  });

  test("a nested .grok/skills copy is a repo skill only Grok loads", () => {
    setHarnesses(["claude-code", "grok"]);
    writeSkill(join(project, "packages", "web", ".grok", "skills", "web-flow"), "w");
    expect(nestedSkills(project).map((s) => [s.location, s.name, s.state, s.visibility])).toEqual([
      [
        "packages/web/.grok/skills",
        "web-flow",
        "repo skill",
        [
          { id: "claude-code", paths: 0 },
          { id: "grok", paths: 1 },
        ],
      ],
    ]);
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
  writeSkill(join(project, "packages", "api", ".codex", "skills", "deploy"), "api");
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
    ["packages/api/.codex/skills", "deploy", "local only", [{ id: "claude-code", paths: 0 }, { id: "cursor", paths: 1 }, { id: "codex", paths: 1 }]],
    // Cursor reads nested .claude folders too (its third-party setting, on by default).
    ["packages/web/.claude/skills", "alpha", "untracked copy of library skill", [{ id: "claude-code", paths: 1 }, { id: "cursor", paths: 1 }, { id: "codex", paths: 0 }]],
    ["packages/web/.claude/skills", "lint", "local only", [{ id: "claude-code", paths: 1 }, { id: "cursor", paths: 1 }, { id: "codex", paths: 0 }]],
  ]);
});

describe("damaged folders and pins from another library", () => {
  // A link to nothing: Windows needs privileges for file symlinks, so this runs elsewhere.
  test.skipIf(process.platform === "win32")("a link to nothing inside a skill doesn't break hashing or copying", () => {
    const dir = join(tmp, "src", "alpha");
    symlinkSync(join(tmp, "nowhere"), join(dir, "gone"));
    expect(treeHash(dir)).toBeString();
    const to = join(tmp, "copy");
    copySkill(dir, to);
    expect(existsSync(join(to, "SKILL.md"))).toBe(true);
    expect(lstatSync(join(to, "gone"), { throwIfNoEntry: false })).toBeUndefined();
  });

  test("copying from a folder that's gone leaves the target as it was", () => {
    const to = join(tmp, "keep");
    writeSkill(to, "mine");
    expect(() => copySkill(join(tmp, "missing"), to)).toThrow();
    expect(readFileSync(join(to, "SKILL.md"), "utf-8")).toContain("mine");
  });

  test("sync installs the pinned content by its hash, even when the pinned number is other content here", () => {
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    // A teammate's library numbered this content 1; in this one, 1 is "v1".
    writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 1, hash: latestVersion("alpha")!.hash } } }));
    syncProject(project);
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v2");
  });
});

describe("round 2: sync, discard, remove and state files never lose a copy", () => {
  const manifest = () => JSON.parse(readFileSync(join(project, "skilllib.json"), "utf-8"));
  const pin = (hash: string) => writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { ...manifest().skills.alpha, hash } } }));

  test("a missing link is put back; the pinned copy isn't replaced by newer library content", () => {
    setHarnesses(["claude-code", "codex"]);
    addSkill(project, "alpha"); // real copy in .agents/skills, a link in .claude/skills
    const pinned = manifest().skills.alpha.hash;
    rmSync(join(project, ".claude", "skills", "alpha"));
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    expect(syncProject(project)).toEqual([{ name: "alpha", action: "relinked", to: 1 }]);
    expect(readFileSync(join(project, ".claude", "skills", "alpha", "SKILL.md"), "utf-8")).toContain("v1");
    expect(manifest().skills.alpha.hash).toBe(pinned);
  });

  test("a pin this library has no copy of is skipped, never filled with other content", () => {
    addSkill(project, "alpha");
    pin("0000000000000000");
    rmSync(local("alpha"), { recursive: true });
    const [c] = syncProject(project);
    expect(c).toMatchObject({ name: "alpha", action: "skipped" });
    expect(c!.reason).toContain("no copy of the version skilllib.json pins");
    expect(existsSync(local("alpha"))).toBe(false);
  });

  test("discarding edits when the pin can't be met leaves the edited copy in place", () => {
    addSkill(project, "alpha");
    writeSkill(local("alpha"), "my edits");
    pin("0000000000000000");
    expect(discardEdits(project, "alpha").action).toBe("skipped");
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("my edits");
  });

  test("removing a copy your library has no version of keeps it in a backup", () => {
    addSkill(project, "alpha");
    writeSkill(local("alpha"), "a teammate's version");
    pin(treeHash(local("alpha"))!); // pinned as it is, from another library
    const r = removeSkill(project, "alpha");
    expect(r.action).toBe("removed");
    expect(r.backedUp).toBeString();
    expect(readFileSync(join(r.backedUp!, "SKILL.md"), "utf-8")).toContain("a teammate's version");
  });

  test("a damaged version index is an error, and no stored version is written over", () => {
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    expect(latestVersion("alpha")!.version).toBe(2);
    const index = join(tmp, "home", "store", "alpha", "versions.json");
    writeFileSync(index, readFileSync(index, "utf-8").slice(0, 20));
    forgetLatest();
    expect(() => versionHistory("alpha")).toThrow("isn't valid JSON");
    expect(() => latestVersion("alpha")).toThrow("isn't valid JSON");
    expect(readFileSync(join(tmp, "home", "store", "alpha", "1", "SKILL.md"), "utf-8")).toContain("v1");
  });

  test("a project backup whose origin was lost isn't restored to a guessed place", () => {
    addSkill(project, "alpha");
    stash(local("alpha"), "edit-backup");
    rmSync(join(tmp, "home", "edit-backup", "index.json"));
    const [backup] = listBackups().filter((b) => b.kind === "edit-backup");
    const r = restoreBackup(backup!);
    expect(r.ok).toBe(false);
    expect(existsSync(join(tmp, ".claude", "skills", "alpha"))).toBe(false);
  });
});

describe("round 3", () => {
  test("sync never repoints a recorded link that reaches other content, only one to nothing", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(join(tmp, "src", "beta"), "beta");
    importSkill(join(tmp, "src", "beta"));
    addSkill(project, "alpha");
    addSkill(project, "beta");
    const link = join(project, ".claude", "skills", "alpha");
    rmSync(link);
    symlinkSync(join(project, ".agents", "skills", "beta"), link, "junction");
    // Repointing it would change what Claude Code runs, with nothing backed up: sync says so and leaves it.
    expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: ".claude/skills/alpha links to a different copy: move it, then sync" }]);
    expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain("beta");
    // A link to nothing is put back.
    rmSync(link);
    symlinkSync(join(tmp, "nowhere"), link, "junction");
    expect(syncProject(project).map((c) => [c.name, c.action])).toEqual([["alpha", "relinked"]]);
    expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain("v1");
  });

  test("a backup index that can't be read stops a stash before anything moves", () => {
    addSkill(project, "alpha");
    mkdirSync(join(tmp, "home", "edit-backup"), { recursive: true });
    writeFileSync(join(tmp, "home", "edit-backup", "index.json"), "{ not json");
    expect(() => stash(local("alpha"), "edit-backup")).toThrow("isn't valid JSON");
    expect(existsSync(join(local("alpha"), "SKILL.md"))).toBe(true);
  });

  test.skipIf(process.platform === "win32")("a state file that's a link is written where it points, keeping its permissions", () => {
    const real = join(tmp, "dotfiles", "config.json");
    mkdirSync(join(tmp, "dotfiles"));
    writeFileSync(real, "{}\n", { mode: 0o600 });
    symlinkSync(real, join(tmp, "home", "linked.json"));
    writeState(join(tmp, "home", "linked.json"), { roots: [] });
    expect(lstatSync(join(tmp, "home", "linked.json")).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, "utf-8"))).toEqual({ roots: [] });
    expect(statSync(real).mode & 0o777).toBe(0o600);
  });
});

test("update backs up a pinned copy your library has no version of before replacing it", () => {
  addSkill(project, "alpha");
  writeSkill(local("alpha"), "another library's version");
  const hash = treeHash(local("alpha"))!;
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 7, hash } } }));
  writeSkill(join(tmp, "src", "alpha"), "v2");
  importSkill(join(tmp, "src", "alpha"), { force: true });
  const [c] = updateProject(project, ["alpha"]);
  expect(c?.backedUp).toBeString();
  expect(readFileSync(join(c!.backedUp!, "SKILL.md"), "utf-8")).toContain("another library's version");
});

test("tracking an untracked copy adds only the links your agents need from where it is", () => {
  setHarnesses(["grok"]);
  writeSkill(local("alpha"), "v1"); // the library's content, untracked in .claude/skills
  addSkill(project, "alpha");
  // Grok reads .claude/skills itself: no .agents/skills link.
  expect(existsSync(join(project, ".agents", "skills", "alpha"))).toBe(false);
  expect(readManifest(project).skills.alpha?.links).toBeUndefined();
});

describe("round 8", () => {
  test("a new skill's description with a colon stays valid frontmatter", () => {
    createSkill("deployer", "Use when: deploying");
    expect(readSkillInfo(join(tmp, "home", "library", "deployer")).description).toBe("Use when: deploying");
  });

  test.skipIf(process.platform === "win32")("removing an untracked copy that's a link backs it up instead of failing", () => {
    writeSkill(join(tmp, "dev", "bar"), "bar");
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    symlinkSync(join(tmp, "dev", "bar"), join(project, ".claude", "skills", "bar"));
    const to = removeUntracked(project, "bar", join(project, ".claude", "skills", "bar"));
    expect(lstatSync(join(project, ".claude", "skills", "bar"), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(to, { throwIfNoEntry: false })).toBeDefined();
  });

  test("discarding edits says where they went", () => {
    addSkill(project, "alpha");
    writeSkill(local("alpha"), "my edits");
    const c = discardEdits(project, "alpha");
    expect(c.action).toBe("reset");
    expect(readFileSync(join(c.backedUp!, "SKILL.md"), "utf-8")).toContain("my edits");
  });
});

describe("round 10", () => {
  test.skipIf(process.platform === "win32")("a skill with a link back to itself hashes and copies without looping", () => {
    const dir = join(tmp, "src", "alpha");
    symlinkSync(".", join(dir, "self"));
    expect(treeHash(dir)).toBeString();
    copySkill(dir, join(tmp, "copy"));
    expect(existsSync(join(tmp, "copy", "SKILL.md"))).toBe(true);
  });

  test("add refuses a name that isn't one folder name", () => {
    for (const name of [".", "..", "", "a/b"]) expect(addSkill(project, name).action).toBe("skipped");
    expect(existsSync(join(project, "skilllib.json"))).toBe(false);
  });

  test("a skilllib.json holding null is an error that names it, not a crash", () => {
    writeFileSync(join(project, "skilllib.json"), "null");
    expect(() => readManifest(project)).toThrow("isn't a skilllib.json");
  });
});

test("a skilllib.json key that isn't a skill name is ignored, never read as a path", () => {
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { ".": { version: 1, hash: "x" }, "../library": { version: 1, hash: "y" } } }));
  expect(readManifest(project).skills).toEqual({});
  expect(projectStatus(project)).toEqual([]);
});

test("a skilllib.json whose skills is a list is an error, not pins named 0 and 1", () => {
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: ["foo", "bar"] }));
  expect(() => readManifest(project)).toThrow("isn't a skilllib.json");
});

describe("round 13", () => {
  test("a skilllib.json whose dir or links leave the repo is an error, never followed", () => {
    for (const dep of [{ dir: "../../.claude/skills" }, { links: ["../../.agents/skills"] }, { dir: "" }]) {
      writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 1, hash: latestVersion("alpha")!.hash, ...dep } } }));
      expect(() => readManifest(project)).toThrow("isn't a skill folder");
    }
  });

  test("a copy that's another library version than the pin is out of sync, and sync fixes it without --force", () => {
    addSkill(project, "alpha"); // v1
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    updateProject(project); // the folder and pin go to v2
    // A pull brings back a v1 pin while the (gitignored) folder keeps v2.
    writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 1, hash: versionHistory("alpha")[0]!.hash } } }));
    expect(projectStatus(project).find((s) => s.name === "alpha")?.state).toBe("out of sync");
    expect(syncProject(project).map((c) => c.action)).toEqual(["updated"]);
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v1");
  });
});

describe("round 14", () => {
  test("a pin whose version number came from another library is judged by its hash", () => {
    addSkill(project, "alpha"); // v1
    writeSkill(join(tmp, "src", "alpha"), "v2");
    importSkill(join(tmp, "src", "alpha"), { force: true });
    const v1 = versionHistory("alpha")[0]!.hash;
    writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 9, hash: v1 } } }));
    const s = projectStatus(project).find((x) => x.name === "alpha")!;
    expect(s.version).toBe(1);
    expect(s.state).toBe("update available");
  });

  test("sync can restore just the named skills", () => {
    writeSkill(join(tmp, "src", "beta"), "beta");
    importSkill(join(tmp, "src", "beta"));
    addSkill(project, "alpha");
    addSkill(project, "beta");
    rmSync(local("alpha"), { recursive: true });
    rmSync(local("beta"), { recursive: true });
    expect(syncProject(project, { names: ["alpha"] }).map((c) => c.name)).toEqual(["alpha"]);
    expect(existsSync(local("beta"))).toBe(false);
  });
});

test("a file where a skills folder goes is ignored, not a crash", () => {
  mkdirSync(join(project, ".cursor"), { recursive: true });
  writeFileSync(join(project, ".cursor", "skills"), "x");
  expect(() => projectStatus(project)).not.toThrow();
});

test("sync restores what skilllib.json pins and never rewrites it", () => {
  setHarnesses(["claude-code"]);
  addSkill(project, "alpha");
  const pinned = JSON.stringify({ skills: { alpha: { version: 9, hash: latestVersion("alpha")!.hash } } }); // a number from another library
  writeFileSync(join(project, "skilllib.json"), pinned);
  setHarnesses(["claude-code", "codex"]); // an agent that would want another link
  rmSync(local("alpha"), { recursive: true });
  expect(syncProject(project).map((c) => [c.name, c.action, c.from, c.to])).toEqual([["alpha", "installed", 1, 1]]);
  expect(readFileSync(join(project, "skilllib.json"), "utf-8")).toBe(pinned);
  expect(existsSync(join(local("alpha"), "SKILL.md"))).toBe(true);
});

test("add never writes through a .claude/skills link that leads out of the repo", () => {
  const outside = join(tmp, "elsewhere");
  mkdirSync(outside);
  mkdirSync(join(project, ".claude"));
  symlinkSync(outside, join(project, ".claude", "skills"));
  expect(addSkill(project, "alpha")).toMatchObject({ action: "skipped", reason: ".claude/skills links out of the repo (to ~/elsewhere), so skilllib doesn't install there" });
  expect(existsSync(join(outside, "alpha"))).toBe(false);
  expect(readManifest(project).skills).toEqual({});
});

test("a file where one agent's skills folder goes stops add, link and sync there, with nothing half done", () => {
  setHarnesses(["claude-code", "codex"]);
  mkdirSync(join(project, ".claude"));
  writeFileSync(join(project, ".claude", "skills"), "x");
  expect(addSkill(project, "alpha")).toMatchObject({ action: "skipped", reason: ".claude/skills is a file, not a folder, so skilllib doesn't install there" });
  expect(existsSync(join(project, ".agents", "skills", "alpha"))).toBe(false);
  expect(existsSync(join(project, "skilllib.json"))).toBe(false);

  // A pin from before the file was there: sync says why, and never throws.
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 1, hash: latestVersion("alpha")!.hash, dir: ".agents/skills", links: [".claude/skills"] } } }));
  expect(syncProject(project)).toEqual([expect.objectContaining({ name: "alpha", action: "skipped", reason: ".claude/skills is a file, not a folder: move it, then sync" })]);
});

test("update reports the version a pin's hash names, not skilllib.json's number", () => {
  addSkill(project, "alpha");
  writeSkill(lib("alpha"), "v2");
  forgetLatest();
  latestVersion("alpha");
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 9, hash: versionHistory("alpha")[0]!.hash } } }));
  expect(updateProject(project)).toEqual([{ name: "alpha", action: "updated", from: 1, to: 2 }]);
});

test("a .claude that links out of the repo is never written through, even before .claude/skills exists", () => {
  mkdirSync(join(tmp, "ext"));
  symlinkSync(join(tmp, "ext"), join(project, ".claude"));
  expect(addSkill(project, "alpha")).toMatchObject({ action: "skipped", reason: ".claude links out of the repo (to ~/ext), so skilllib doesn't install there" });
  expect(existsSync(join(tmp, "ext", "skills"))).toBe(false);
});

test("a skills folder that links to your global skills isn't the repo's: tidy and remove leave it alone", () => {
  setHarnesses(["claude-code"]);
  writeSkill(join(project, ".claude", "skills", "foo"), "same");
  writeSkill(join(tmp, ".agents", "skills", "foo"), "same");
  mkdirSync(join(project, ".agents"));
  symlinkSync(join(tmp, ".agents", "skills"), join(project, ".agents", "skills"));
  expect(planProjectTidy(project).plans).toEqual([]);
  expect(() => removeUntracked(project, "foo", join(project, ".agents", "skills", "foo"))).toThrow(".agents/skills isn't a folder in the repo");
  expect(existsSync(join(tmp, ".agents", "skills", "foo", "SKILL.md"))).toBe(true);
});

test("what's in the way of a link is said, and keeps a global skill loading; a link to nothing is replaced", () => {
  setHarnesses(["claude-code", "codex"]);
  mkdirSync(join(project, ".claude", "skills"), { recursive: true });
  writeFileSync(join(project, ".claude", "skills", "alpha"), "notes");
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [project]);
  expect(mv).toMatchObject({ moved: false });
  expect(mv!.changes[0]![1].inTheWay).toEqual([".claude/skills/alpha"]);
  expect(existsSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
  expect(readFileSync(join(project, ".claude", "skills", "alpha"), "utf-8")).toBe("notes");
  expect(linkAll(project).inTheWay).toEqual([".claude/skills/alpha"]);

  rmSync(join(project, ".claude", "skills", "alpha"));
  symlinkSync(join(tmp, "nowhere"), join(project, ".claude", "skills", "alpha"));
  removeSkill(project, "alpha");
  expect(addSkill(project, "alpha").inTheWay).toBeUndefined();
  expect(readFileSync(join(project, ".claude", "skills", "alpha", "SKILL.md"), "utf-8")).toContain("v1");
});

test("a file where a managed skill's folder goes is never deleted, and status doesn't crash on it", () => {
  addSkill(project, "alpha");
  rmSync(local("alpha"), { recursive: true });
  writeFileSync(local("alpha"), "mine");
  expect(() => projectStatus(project)).not.toThrow();
  expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: ".claude/skills/alpha is a file, not a skill folder: move it, then sync" }]);
  expect(addSkill(project, "alpha", { force: true })).toMatchObject({ action: "skipped" });
  // remove drops just the pin, touching no file.
  expect(removeSkill(project, "alpha")).toMatchObject({ action: "removed", reason: ".claude/skills/alpha is a file, not a skill folder: only its pin was removed, and that copy was left as it is" });
  expect(readManifest(project).skills).toEqual({});
  expect(readFileSync(local("alpha"), "utf-8")).toBe("mine");
});

test("adding what's already there says unchanged; a description with an unquoted colon still reads", () => {
  addSkill(project, "alpha");
  expect(addSkill(project, "alpha")).toEqual({ name: "alpha", action: "unchanged", from: 1, to: 1 });
  mkdirSync(join(tmp, "colon"));
  writeFileSync(join(tmp, "colon", "SKILL.md"), "---\nname: colon\ndescription: Use it when: the user asks\n---\nbody\n");
  expect(readSkillInfo(join(tmp, "colon"))).toEqual({ name: "colon", description: "Use it when: the user asks" });
});

test("sync never restores a copy whose recorded link it can't put back", () => {
  setHarnesses(["claude-code", "codex"]);
  addSkill(project, "alpha");
  rmSync(join(project, ".agents", "skills", "alpha"), { recursive: true });
  rmSync(local("alpha"));
  writeFileSync(local("alpha"), "mine");
  expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: ".claude/skills/alpha is in the way of its link: move it, then sync" }]);
  expect(existsSync(join(project, ".agents", "skills", "alpha"))).toBe(false);
});

test("a recorded link stays in skilllib.json when something is in its way, and remove leaves another copy's link", () => {
  setHarnesses(["claude-code", "codex"]);
  addSkill(project, "alpha");
  const link = local("alpha");
  rmSync(link);
  expect(addSkill(project, "alpha").action).toBe("relinked"); // the link was written again
  expect(addSkill(project, "alpha").action).toBe("unchanged");
  rmSync(link);
  writeSkill(join(project, ".grok", "skills", "alpha"), "team");
  symlinkSync(join(project, ".grok", "skills", "alpha"), link);
  expect(addSkill(project, "alpha")).toMatchObject({ action: "unchanged", inTheWay: [".claude/skills/alpha"] });
  expect(readManifest(project).skills.alpha?.links).toEqual([".claude/skills"]);
  removeSkill(project, "alpha");
  expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain("team");
});

test("a package's skills folder that links out of the repo isn't a nested skill", () => {
  writeSkill(join(tmp, ".claude", "skills", "glob"), "global");
  mkdirSync(join(project, "packages", "web"), { recursive: true });
  symlinkSync(join(tmp, ".claude"), join(project, "packages", "web", ".claude"));
  expect(nestedSkills(project).map((s) => s.name)).toEqual([]);
});

test("global move only waits for agents that load the global copy", () => {
  setHarnesses(["claude-code", "codex"]);
  // The repo already has the copy in .claude/skills; git tracks .agents/skills, so Codex's link is held back.
  writeSkill(local("alpha"), "v1");
  writeSkill(join(project, ".agents", "skills", "team"), "team");
  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", ".agents"], { cwd: project });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "team"], { cwd: project });
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  // Codex can't see it in the repo, but it never read ~/.claude/skills: nothing is lost, so the move goes ahead.
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [project]);
  expect(mv).toMatchObject({ moved: true });
  // Held back: git tracks .agents/skills and doesn't share the .claude copy, so a link there would break for teammates.
  expect(mv!.changes[0]![1].uncommitted).toEqual([".agents/skills"]);
});

test("global move never unloads a skill an agent in another repo only ever saw globally", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  // In app1, git tracks .claude/skills and the copy isn't committed: Claude Code there runs the global copy.
  const app1 = join(tmp, "app1");
  writeSkill(join(app1, ".claude", "skills", "team"), "team");
  execFileSync("git", ["init", "-q"], { cwd: app1 });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd: app1 });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "team"], { cwd: app1 });
  expect(addSkill(app1, "alpha").uncommitted).toEqual([".claude/skills"]);
  rememberProjects([app1, project]);
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [project]);
  expect(mv).toMatchObject({ moved: false, changes: [] });
  expect(mv!.reason).toBe("nothing moved: Claude Code in app1 only sees the global copy: give that repo a copy of its own (skilllib add, sync or link there), or keep alpha global (skilllib global keep)");
  expect(existsSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
  expect(readManifest(project).skills).toEqual({});
});

test("a pin from another library whose copy differs: sync and remove say what it is, not 'local edits'", () => {
  addSkill(project, "alpha");
  writeSkill(local("alpha"), "theirs");
  writeFileSync(join(project, "skilllib.json"), JSON.stringify({ skills: { alpha: { version: 3, hash: "0000000000000000" } } }));
  expect(syncProject(project)[0]!.reason).not.toContain("--force");
  expect(removeSkill(project, "alpha").reason).toBe("doesn't match what skilllib.json pins, and your library has neither (use --force to remove it; it's backed up first)");
});

test("a link to a file where a skill's link goes is broken, so add replaces it on every platform", () => {
  setHarnesses(["claude-code", "codex"]);
  writeFileSync(join(project, "README"), "readme");
  mkdirSync(join(project, ".claude", "skills"), { recursive: true });
  symlinkSync(join(project, "README"), local("alpha"));
  expect(addSkill(project, "alpha").inTheWay).toBeUndefined();
  expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v1");
});

test("a pin under a .claude that links out of the repo: sync says why (exit 1), remove drops just the pin", () => {
  addSkill(project, "alpha");
  mkdirSync(join(tmp, "ext"));
  execFileSync("mv", [join(project, ".claude"), join(tmp, "ext", "claude")]);
  symlinkSync(join(tmp, "ext", "claude"), join(project, ".claude"));
  expect(syncProject(project)).toEqual([{ name: "alpha", action: "skipped", reason: ".claude links out of the repo (to ~/ext/claude): skilllib only installs inside the repo" }]);
  expect(removeSkill(project, "alpha")).toMatchObject({ action: "removed" });
  expect(readManifest(project).skills).toEqual({});
  expect(existsSync(join(tmp, "ext", "claude", "skills", "alpha", "SKILL.md"))).toBe(true);
});

test("global move counts a repo that reaches the global copy through a link as still needing it", () => {
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  const r = join(tmp, "r");
  mkdirSync(join(r, ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, ".claude", "skills", "alpha"), join(r, ".claude", "skills", "alpha"));
  rememberProjects([r, project]);
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [project]);
  expect(mv).toMatchObject({ moved: false, changes: [] });
  expect(mv!.reason).toStartWith("nothing moved: Claude Code in r only sees the global copy");
  expect(existsSync(join(r, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
});

test("a repo whose skilllib.json can't be read (a merge conflict) still counts when it names the skill", () => {
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  const r = join(tmp, "r");
  mkdirSync(join(r, ".agents", "skills"), { recursive: true });
  writeFileSync(join(r, "skilllib.json"), '<<<<<<< HEAD\n{"skills": {"alpha": {"version": 1, "hash": "x"}}}\n');
  rememberProjects([r, project]);
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [project]);
  expect(mv).toMatchObject({ moved: false });
  expect(existsSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
});

test("who'd lose a global skill: every case the reviews found, as one table", () => {
  setHarnesses(["claude-code", "codex"]);
  const global = join(tmp, ".claude", "skills", "foo");
  writeSkill(global, "global");
  writeSkill(join(tmp, "dev", "foo"), "dev");
  const repo = (name: string, setup: (r: string) => void) => {
    const r = join(tmp, "repos", name);
    mkdirSync(r, { recursive: true });
    setup(r);
    return r;
  };
  const pin = (r: string) => writeFileSync(join(r, "skilllib.json"), JSON.stringify({ skills: { foo: { version: 1, hash: "x" } } }));
  const cases: [string, (r: string) => void, [string, string | null][]][] = [
    ["own copy, Claude Code's folder", (r) => writeSkill(join(r, ".claude", "skills", "foo"), "own"), []],
    ["link to a dev folder", (r) => (mkdirSync(join(r, ".claude", "skills"), { recursive: true }), symlinkSync(join(tmp, "dev", "foo"), join(r, ".claude", "skills", "foo"))), []],
    ["link to the global copy itself", (r) => (mkdirSync(join(r, ".claude", "skills"), { recursive: true }), symlinkSync(global, join(r, ".claude", "skills", "foo"))), [["claude-code", null]]],
    [".claude links to ~/.claude, no pin", (r) => symlinkSync(join(tmp, ".claude"), join(r, ".claude")), []],
    [".claude links to ~/.claude, pinned", (r) => (symlinkSync(join(tmp, ".claude"), join(r, ".claude")), pin(r)), [["claude-code", ".claude"]]],
    ["copy only where Codex reads", (r) => writeSkill(join(r, ".agents", "skills", "foo"), "own"), [["claude-code", null]]],
    ["a stray file where Claude Code's copy goes", (r) => (writeSkill(join(r, ".agents", "skills", "foo"), "own"), mkdirSync(join(r, ".claude", "skills"), { recursive: true }), writeFileSync(join(r, ".claude", "skills", "foo"), "x")), [["claude-code", null]]],
    ["pinned, folder missing", pin, [["claude-code", null]]],
    ["nothing of it", () => {}, []],
    ["skilllib.json in a merge conflict, naming it", (r) => writeFileSync(join(r, "skilllib.json"), '<<<<<<< HEAD\n"foo"\n'), [["claude-code", null]]],
  ];
  for (const [what, setup, expected] of cases) {
    const r = repo(what.replace(/\W+/g, "-"), setup);
    const got = blindWithoutGlobal("foo", [{ path: global, harnesses: ["claude-code"] }], [r]).map((b) => [b.id, b.folder]);
    expect([what, got]).toEqual([what, expected]);
  }
});

test("remove still removes skilllib's copy when only a link's folder links out of the repo", () => {
  setHarnesses(["claude-code", "codex"]);
  addSkill(project, "alpha"); // copy in .agents/skills, link in .claude/skills
  mkdirSync(join(tmp, "elsewhere"));
  rmSync(join(project, ".claude"), { recursive: true });
  symlinkSync(join(tmp, "elsewhere"), join(project, ".claude"));
  const c = removeSkill(project, "alpha");
  // Nothing of it in the folder outside the repo: nothing said left there.
  expect(c).toEqual({ name: "alpha", action: "removed" });
  expect(existsSync(join(project, ".agents", "skills", "alpha"))).toBe(false);
  expect(readManifest(project).skills).toEqual({});
});

test("global move refuses a repo that can't take the skill before writing anything, the library included", () => {
  writeSkill(join(tmp, ".claude", "skills", "gm"), "v1");
  const out = join(tmp, "out");
  mkdirSync(out);
  symlinkSync(join(tmp, ".claude"), join(out, ".claude"));
  const [mv] = moveGlobalSkills([{ name: "gm", path: join(tmp, ".claude", "skills", "gm"), links: [], harnesses: ["claude-code"] }], [project, out]);
  expect(mv).toMatchObject({ moved: false, changes: [] });
  expect(mv!.reason).toStartWith("nothing moved: it can't be added to out (.claude links out of the repo");
  expect(existsSync(lib("gm"))).toBe(false);
  expect(readManifest(project).skills).toEqual({});
});

test("who'd lose a global skill when its global entry is a link, or a package holds it: only what passes through what's moved", () => {
  setHarnesses(["claude-code"]);
  writeSkill(join(tmp, "dev", "foo"), "dev");
  const entry = join(tmp, ".claude", "skills", "foo");
  mkdirSync(dirname(entry), { recursive: true });
  const at = (name: string) => {
    const r = join(tmp, "repos", name);
    mkdirSync(join(r, ".claude", "skills"), { recursive: true });
    return r;
  };
  const blind = (entryPath: string, r: string, links: string[] = []) => blindWithoutGlobal("foo", [{ path: entryPath, harnesses: ["claude-code"], links }], [r]).map((b) => [relative(tmp, b.root).replaceAll("\\", "/"), b.id]);

  // The global entry is a link to a dev folder: moving it leaves the dev folder, and a repo link to it.
  symlinkSync(join(tmp, "dev", "foo"), entry);
  const viaDev = at("via-dev");
  symlinkSync(join(tmp, "dev", "foo"), join(viaDev, ".claude", "skills", "foo"));
  expect(blind(entry, viaDev)).toEqual([]);
  // ...but not a repo link to the entry itself.
  const viaEntry = at("via-entry");
  symlinkSync(entry, join(viaEntry, ".claude", "skills", "foo"));
  expect(blind(entry, viaEntry)).toEqual([["repos/via-entry", "claude-code"]]);
  rmSync(entry);

  // The global entry links to the repo's own real copy: the repo keeps it.
  const own = at("own");
  writeSkill(join(own, ".claude", "skills", "foo"), "own");
  symlinkSync(join(own, ".claude", "skills", "foo"), entry);
  expect(blind(entry, own)).toEqual([]);
  rmSync(entry);

  // A real global copy in ~/.agents/skills with a ~/.claude/skills link to it: a repo link to that link is lost too.
  const real = join(tmp, ".agents", "skills", "foo");
  writeSkill(real, "global");
  symlinkSync(real, entry);
  const viaLink = at("via-link");
  symlinkSync(entry, join(viaLink, ".claude", "skills", "foo"));
  expect(blind(real, viaLink, [entry])).toEqual([["repos/via-link", "claude-code"]]);

  // A monorepo package whose own folder links to the global entry loses it there; one linking to a dev folder doesn't.
  const mono = at("mono");
  mkdirSync(join(mono, "packages", "web", ".claude", "skills"), { recursive: true });
  symlinkSync(entry, join(mono, "packages", "web", ".claude", "skills", "foo"));
  mkdirSync(join(mono, "packages", "api", ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, "dev", "foo"), join(mono, "packages", "api", ".claude", "skills", "foo"));
  expect(blind(real, mono, [entry])).toEqual([["repos/mono/packages/web", "claude-code"]]);
});

test("remove says when something else sits where its link was", () => {
  setHarnesses(["claude-code", "codex"]);
  addSkill(project, "alpha");
  rmSync(local("alpha"));
  writeFileSync(local("alpha"), "mine");
  expect(removeSkill(project, "alpha")).toMatchObject({ action: "removed", reason: ".claude/skills/alpha is something else (another copy, or a file): left as it is" });
  expect(readFileSync(local("alpha"), "utf-8")).toBe("mine");
});
