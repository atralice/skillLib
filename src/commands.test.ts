import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, setHarnesses, setHidden } from "./config.js";
import { importSkill } from "./library.js";
import { projectHere } from "./project.js";

let tmp: string;
const realHome = process.env.HOME;
// Node reads the home folder from USERPROFILE on Windows, HOME elsewhere.
const realProfile = process.env.USERPROFILE;

/** Runs the CLI from source in `cwd` (not a terminal, so bare `skilllib` is the piped overview). */
function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-commands-")));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.SKILLLIB_HOME = join(tmp, ".skilllib");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code", "codex"]);
  mkdirSync(join(tmp, "src", "alpha"), { recursive: true });
  writeFileSync(join(tmp, "src", "alpha", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
  importSkill(join(tmp, "src", "alpha"));
  // Global skills, which a project-less `add` would have landed next to.
  mkdirSync(join(tmp, ".claude", "skills", "mine"), { recursive: true });
  writeFileSync(join(tmp, ".claude", "skills", "mine", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("commands that need a project", () => {
  test("$HOME through a symlink is still your home folder, even when it's a git repo (#51)", () => {
    const link = join(tmpdir(), `skilllib-home-link-${process.pid}-${Date.now()}`);
    symlinkSync(tmp, link, "junction");
    try {
      process.env.HOME = link;
      process.env.USERPROFILE = link;
      mkdirSync(join(tmp, ".git")); // a dotfiles repo
      const r = cli(tmp, "add", "alpha");
      expect(r.code).toBe(1);
      expect(r.err).toContain("Your home folder isn't a project");
      expect(existsSync(join(tmp, "skilllib.json"))).toBe(false);
    } finally {
      rmSync(link, { force: true, recursive: false });
    }
  });

  const needProject = [["status"], ["add", "alpha"], ["remove", "alpha"], ["sync"], ["update"], ["outdated"], ["link"], ["tidy"]];

  test("refuse outside a git repo, and write nothing", () => {
    const folder = join(tmp, "Downloads", "stuff");
    mkdirSync(folder, { recursive: true });
    expect(projectHere(folder)).toBeNull();
    for (const args of needProject) {
      const r = cli(folder, ...args);
      expect([args[0], r.code]).toEqual([args[0], 1]);
      expect(r.err).toContain("Not in a git repo");
    }
    expect(readdirSync(folder)).toEqual([]);
    expect(existsSync(join(tmp, "skilllib.json"))).toBe(false);
  });

  test("refuse in your home folder, where skills would load in every repo", () => {
    expect(projectHere(tmp)).toBeNull();
    for (const args of needProject) {
      const r = cli(tmp, ...args);
      expect([args[0], r.code]).toEqual([args[0], 1]);
      expect(r.err).toContain("Your home folder isn't a project");
    }
    expect(existsSync(join(tmp, "skilllib.json"))).toBe(false);
    expect(existsSync(join(tmp, ".agents"))).toBe(false);
    expect(readdirSync(join(tmp, ".claude", "skills"))).toEqual(["mine"]);
  });

  test("a skilllib.json in your home folder doesn't make it a project, and the error names it", () => {
    writeFileSync(join(tmp, "skilllib.json"), '{ "skills": {} }\n');
    const folder = join(tmp, "notes");
    mkdirSync(folder);
    const r = cli(folder, "add", "alpha");
    expect(r.code).toBe(1);
    expect(r.err).toContain("~/skilllib.json makes it look like one");
    expect(existsSync(join(tmp, ".agents"))).toBe(false);
  });

  test("work in a repo, from any folder in it", () => {
    const repo = join(tmp, "code", "web");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "src"));
    expect(projectHere(join(repo, "src"))).toBe(repo);
    expect(cli(join(repo, "src"), "add", "alpha").code).toBe(0);
    expect(existsSync(join(repo, "skilllib.json"))).toBe(true);
    const r = cli(repo, "status");
    expect(r.code).toBe(0);
    expect(r.out).toContain("alpha");
  });

  test("--all and --global don't need one", () => {
    expect(cli(tmp, "sync", "--all").code).toBe(0);
    expect(cli(tmp, "tidy", "--global", "--dry-run").code).toBe(0);
  });
});

describe("outside a project, reading still works", () => {
  test("status --json lists the global skills and no project skills", () => {
    for (const cwd of [tmp, join(tmp, ".claude")]) {
      const r = cli(cwd, "status", "--json");
      expect(r.code).toBe(0);
      const here = JSON.parse(r.out);
      expect(here.skills).toEqual([]);
      expect(here.global.flatMap((g: { skills: string[] }) => g.skills)).toContain("mine");
    }
  });

  test("piped `skilllib` says where to look instead of failing", () => {
    const r = cli(tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Not in a project");
  });
});

describe("paths are checked", () => {
  test("folders add refuses a folder that doesn't exist, and a file", () => {
    writeFileSync(join(tmp, "file.txt"), "");
    mkdirSync(join(tmp, "Projects"));
    const r = cli(tmp, "folders", "add", join(tmp, "Other"), join(tmp, "file.txt"), join(tmp, "Projects"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("~/Other doesn't exist");
    expect(r.err).toContain("~/file.txt isn't a folder");
    expect(readConfig().roots).toEqual([join(tmp, "Projects")]);
  });

  test("unhide says when a path wasn't hidden", () => {
    const hidden = join(tmp, "Projects", "old");
    setHidden(hidden, true);
    const never = cli(tmp, "unhide", join(tmp, "Projects", "nope"));
    expect(never.code).toBe(1);
    expect(never.err).toContain("~/Projects/nope wasn't hidden");
    expect(never.err).toContain("~/Projects/old");
    expect(readConfig().hidden).toEqual([hidden]);

    const r = cli(tmp, "unhide", hidden);
    expect(r.code).toBe(0);
    expect(r.out).toContain("~/Projects/old is visible again");
    expect(readConfig().hidden).toEqual([]);
  });
});

describe("doctor", () => {
  test("a pinned skill your library doesn't have: said so, with no fix that does nothing", () => {
    const repo = join(tmp, "code", "web");
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { "ghost-skill": { version: 1, hash: "abc" } } }));
    expect(cli(repo, "status").out).toContain("isn't in your library");

    const r = cli(repo, "doctor", "--fix");
    expect(r.code).toBe(0);
    expect(r.out).toContain("ghost-skill: pinned in web's skilllib.json, but not in your library");
    expect(r.out).toContain("choose in skilllib → Health: Remove it from skilllib.json");
    expect(r.out).not.toContain("out of date");
    expect(r.out).not.toContain("updated");
  });
});

describe("what the plain commands say", () => {
  const skill = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\ndescription: d\n---\nbody\n");
  };
  const repo = (path: string) => (mkdirSync(join(path, ".git"), { recursive: true }), path);

  test("global counts a skill in two global folders once", () => {
    skill(join(tmp, ".agents", "skills", "mine"));
    const r = cli(tmp, "global");
    expect(r.out.split("\n").filter((l) => l.includes(" mine ")).length).toBe(2);
    expect(r.out).toContain("1 not reviewed");
  });

  test("scan finds skills in every agent's folder, and a monorepo's packages", () => {
    const web = repo(join(tmp, "Projects", "web"));
    skill(join(web, ".codex", "skills", "codex-one"));
    skill(join(web, ".cursor", "skills", "cursor-one"));
    skill(join(repo(join(tmp, "Projects", "mono")), "packages", "api", ".claude", "skills", "nested-one"));
    repo(join(tmp, "Projects", "empty"));
    const r = cli(tmp, "scan", join(tmp, "Projects"));
    expect(r.out).toContain("3 projects, 2 with skills");
    for (const name of ["codex-one", "cursor-one", "nested-one"]) expect(r.out).toContain(name);
    expect(r.out).not.toContain("Sources");
  });

  test("status says which agents load each skill, and what else loads here, even in an empty repo", () => {
    const web = repo(join(tmp, "web"));
    skill(join(web, ".agents", "skills", "team"));
    const r = cli(web, "status");
    expect(r.out).toMatch(/team\s+.*\s+Codex\s/);
    expect(r.out).toContain("1 global skill also loads here");
    const empty = cli(repo(join(tmp, "empty")), "status");
    expect(empty.out).toContain("No skills in this project yet");
    expect(empty.out).toContain("1 global skill also loads here");
  });

  test("status calls a copy git tracks the team's, wherever it lives", () => {
    const web = join(tmp, "web");
    skill(join(web, ".claude", "skills", "team"));
    skill(join(web, ".claude", "skills", "scratch"));
    mkdirSync(join(web, ".claude", "skills", "alpha"), { recursive: true });
    writeFileSync(join(web, ".claude", "skills", "alpha", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: web });
    git("init", "-q");
    git("add", ".claude/skills/team", ".claude/skills/alpha");
    git("commit", "-qm", "skills");
    const r = cli(web, "status");
    expect(r.out).toMatch(/alpha\s+repo skill, in library/);
    expect(r.out).toMatch(/team\s+repo skill\s/);
    expect(r.out).toMatch(/scratch\s+local only/);
  });

  test("sync --all doesn't claim a repo without skilllib.json matches it", () => {
    cli(repo(join(tmp, "web")), "status");
    const r = cli(tmp, "sync", "--all");
    expect(r.out).toContain("No skilllib.json: nothing to sync");
    expect(r.out).not.toContain("match skilllib.json");
  });
});

test("paths under $HOME show as ~ even when $HOME has a trailing slash (#51)", () => {
  process.env.HOME = `${tmp}/`;
  const repo = join(tmp, "Projects", "web");
  mkdirSync(join(repo, ".git"), { recursive: true });
  expect(cli(repo, "status").out).toContain("~/Projects/web");
});
