import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSkill, importSkill, projectStatus, removeSkill, syncProject } from "./library.js";
import { readManifest } from "./project.js";

let tmp: string;
let project: string;

function writeSkill(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}

const lib = (name: string) => join(tmp, "home", "library", name);
const local = (name: string) => join(project, ".claude", "skills", name);
const stateOf = (name: string) => projectStatus(project).find((s) => s.name === name)?.state;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skilllib-"));
  process.env.SKILLLIB_HOME = join(tmp, "home");
  project = join(tmp, "project");
  mkdirSync(project);
  writeSkill(join(tmp, "src", "alpha"), "v1");
  importSkill(join(tmp, "src", "alpha"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("library", () => {
  test("add copies the skill and records it", () => {
    expect(addSkill(project, "alpha")).toEqual({ name: "alpha", action: "installed" });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v1");
    expect(Object.keys(readManifest(project).skills)).toEqual(["alpha"]);
    expect(stateOf("alpha")).toBe("ok");
    expect(addSkill(project, "missing")).toMatchObject({ action: "skipped" });
  });

  test("sync pulls library updates but keeps local edits unless forced", () => {
    addSkill(project, "alpha");
    writeSkill(lib("alpha"), "v2");
    expect(stateOf("alpha")).toBe("update available");
    expect(syncProject(project)).toEqual([{ name: "alpha", action: "updated" }]);
    expect(stateOf("alpha")).toBe("ok");

    writeSkill(lib("alpha"), "v3");
    writeSkill(local("alpha"), "mine");
    expect(stateOf("alpha")).toBe("edited locally, update available");
    expect(syncProject(project)[0]).toMatchObject({ action: "skipped" });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("mine");

    syncProject(project, { force: true });
    expect(readFileSync(join(local("alpha"), "SKILL.md"), "utf-8")).toContain("v3");
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
