import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRoot, discoverProjects, harnessesChosen, keptGlobal, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "./config.js";
import { findIssues, runFix } from "./health.js";
import { addSkill, deleteGlobal, importSkill, listBackups, restoreBackup } from "./library.js";
import { readManifest } from "./project.js";
import { machineSkills } from "./sources.js";

let tmp: string;

function skill(dir: string, body = "x") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\ndescription: d\n---\n${body}\n`);
}

const realHome = process.env.HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skilllib-health-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  setHarnesses(["claude-code"]);
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

test("project folders are scanned for git repos, and hidden projects drop out", () => {
  for (const repo of ["code/web", "code/nested/api"]) mkdirSync(join(tmp, repo, ".git"), { recursive: true });
  mkdirSync(join(tmp, "code", "web", "node_modules", "dep", ".git"), { recursive: true });
  addRoot(join(tmp, "code"));

  expect(discoverProjects()).toEqual([join(tmp, "code", "nested", "api"), join(tmp, "code", "web")]);
  setHidden(join(tmp, "code", "web"), true);
  expect(visibleProjects()).toEqual([join(tmp, "code", "nested", "api")]);
});

test("finds broken links, duplicates, and local-only skills, and fixes them", () => {
  const project = join(tmp, "code", "web");
  mkdirSync(join(project, ".git"), { recursive: true });
  skill(join(project, ".claude", "skills", "deploy"));
  symlinkSync(join(tmp, "nowhere"), join(tmp, ".claude", "skills", "gone"));
  skill(join(tmp, ".claude", "skills", "twice"));
  skill(join(tmp, ".claude", "skills", "synced", "b", "twice"));

  const issues = findIssues([project], machineSkills(), new Set());
  expect(issues.map((i) => i.id)).toEqual(["broken:gone", "dup:twice", `local:${project}:deploy`]);

  for (const issue of issues) issue.fix?.run();
  // Your skill wins over the claude.ai copy, but only claude.ai can turn its copy off.
  const left = findIssues([project], machineSkills(), new Set(["deploy", "twice"]));
  expect(left.map((i) => [i.id, i.fix, i.choices])).toEqual([["dup:twice", undefined, undefined]]);
  expect(left[0]?.detail).toContain("Your skill wins");
  expect(existsSync(join(tmp, ".claude", "skills", "twice"))).toBe(true);
  expect(existsSync(join(tmp, "home", "library", "deploy", "SKILL.md"))).toBe(true);

  // Everything moved out can be put back.
  const gone = listBackups().find((b) => b.name === "gone");
  expect(gone && restoreBackup(gone)).toMatchObject({ ok: true });
  expect(lstatSync(join(tmp, ".claude", "skills", "gone")).isSymbolicLink()).toBe(true);
});

test("flags a project skill that also loads globally", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  skill(join(tmp, ".claude", "skills", "alpha"));
  importSkill(join(tmp, ".claude", "skills", "alpha"));
  addSkill(project, "alpha");

  const other = join(tmp, "api");
  mkdirSync(other);
  addSkill(other, "alpha");

  // One issue for both projects, and a choice: doctor --fix never moves your global skills.
  const issues = findIssues([project, other], machineSkills(), new Set(["alpha"]));
  expect(issues.map((i) => [i.id, i.title, i.fix])).toEqual([["twice:alpha", "alpha: in web, api and also loaded globally", undefined]]);
  expect(runFix(issues[0]!.choices![0]!)).toEqual({ ok: true, message: "alpha no longer loads globally" });
  expect(existsSync(join(tmp, ".claude", "skills", "alpha"))).toBe(false);
});

test("keeping a skill global on purpose is remembered by name and can be undone", () => {
  expect([...keptGlobal()]).toEqual([]);
  setKeepGlobal(["commit", "ponytail"], true);
  setKeepGlobal(["commit"], true);
  expect([...keptGlobal()]).toEqual(["commit", "ponytail"]);
  setKeepGlobal(["ponytail"], false);
  expect([...keptGlobal()]).toEqual(["commit"]);
  // Other settings survive.
  expect(harnessesChosen()).toBe(true);
});

test("deleting a kept global skill forgets the mark, so a reinstall isn't silently kept", () => {
  skill(join(tmp, ".claude", "skills", "commit"));
  setKeepGlobal(["commit", "other"], true);
  expect(deleteGlobal(join(tmp, ".claude", "skills", "commit")).ok).toBe(true);
  expect([...keptGlobal()]).toEqual(["other"]);
});

test("a project copy of a skill you keep global is the extra one", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  skill(join(tmp, ".claude", "skills", "alpha"));
  importSkill(join(tmp, ".claude", "skills", "alpha"));
  addSkill(project, "alpha");
  setKeepGlobal(["alpha"], true);

  const [issue] = findIssues([project], machineSkills(), new Set(["alpha"]));
  expect(issue?.id).toBe("twice:alpha");
  expect(issue?.choices?.map((c) => c.label)).toEqual(["Remove the copies in web"]);
  issue?.choices?.[0]?.run();
  expect(readManifest(project).skills.alpha).toBeUndefined();
  expect(existsSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
});

test("tidy issues: a plain fix when git won't notice, a choice when it would, and doctor --fix never picks", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".claude", "skills", "mine"), "same");
  skill(join(project, ".agents", "skills", "mine"), "same");
  skill(join(tmp, ".claude", "skills", "g"), "same");
  skill(join(tmp, ".agents", "skills", "g"), "same");
  skill(join(project, ".claude", "skills", "deploy"), "a");
  skill(join(project, ".agents", "skills", "deploy"), "b");

  const issues = findIssues([project], machineSkills(), new Set());
  const byId = (id: string) => issues.find((i) => i.id === id);
  expect(byId("tidy:global")?.fix).toBeDefined();
  expect(byId(`tidy:${project}`)?.fix).toBeDefined(); // not a git repo: nothing for git to see
  expect(byId(`conflict:${project}:deploy`)?.fix).toBeUndefined();
  expect(byId(`conflict:${project}:deploy`)?.choices?.map((c) => c.label)).toEqual(["Keep the .claude/skills copy", "Keep the .agents/skills copy"]);

  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync("git", ["add", "."], { cwd: project });
  const inRepo = findIssues([project], machineSkills(), new Set()).find((i) => i.id === `tidy:${project}`);
  expect(inRepo?.fix).toBeUndefined();
  expect(inRepo?.choices?.map((c) => c.label)).toEqual(["Tidy, but keep git as it is", "Tidy everything"]);
});

test("a skill some of your agents can't reach gets a link fix, with a choice when git tracks the folder", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".agents", "skills", "team")); // Codex sees it, Claude Code doesn't

  const issue = () => findIssues([project], machineSkills(), new Set()).find((i) => i.id === `usable:${project}`);
  expect(issue()?.title).toBe("web: 1 skill not usable by Claude Code");
  expect(issue()?.fix?.label).toBe("Add the links");
  issue()?.fix?.run();
  expect(lstatSync(join(project, ".claude", "skills", "team")).isSymbolicLink()).toBe(true);
  expect(issue()).toBeUndefined();

  const repo = join(tmp, "repo");
  skill(join(repo, ".agents", "skills", "team"));
  skill(join(repo, ".claude", "skills", "committed"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  const tracked = findIssues([repo], machineSkills(), new Set()).find((i) => i.id === `usable:${repo}`);
  expect(tracked?.fix).toBeUndefined();
  expect(tracked?.choices?.map((c) => c.label)).toEqual(["Add links, but not where git tracks the folder", "Add links everywhere"]);
});

test("a link to a folder under another name isn't offered for import (that made a second copy)", () => {
  const project = join(tmp, "trader");
  skill(join(project, ".agents", "skills", "Trading Best Practices"));
  mkdirSync(join(project, ".claude", "skills"), { recursive: true });
  symlinkSync("../../.agents/skills/Trading Best Practices", join(project, ".claude", "skills", "trading-best-practices"));

  const ids = findIssues([project], machineSkills(), new Set()).map((i) => i.id);
  expect(ids.filter((id) => id.startsWith("local:") || id.startsWith("adopt:"))).toEqual([]);
});
