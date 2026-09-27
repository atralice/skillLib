import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRoot, discoverProjects, setHarnesses, setHidden, visibleProjects } from "./config.js";
import { findIssues } from "./health.js";
import { addSkill, importSkill, listBackups, restoreBackup } from "./library.js";
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
  expect(issues.map((i) => i.id)).toEqual(["broken:gone", "dup:twice", `local:${project}:deploy`, "agent-skill"]);

  for (const issue of issues) issue.fix?.run();
  expect(findIssues([project], machineSkills(), new Set(["deploy", "twice"]))).toEqual([]);
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

  const [issue] = findIssues([project], machineSkills(), new Set(["alpha"]));
  expect(issue?.id).toBe(`twice:${project}:alpha`);
  issue?.fix?.run();
  expect(existsSync(join(tmp, ".claude", "skills", "alpha"))).toBe(false);
});
