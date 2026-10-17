import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    expect(r.out).toContain("your call: 1) Remove it from skilllib.json");
    expect(r.out).not.toContain("out of date");
    expect(r.out).not.toContain("updated");
  });
});

describe("apply and global move, for agents", () => {
  const web = () => {
    const repo = join(tmp, "code", "web");
    mkdirSync(join(repo, ".git"), { recursive: true });
    return repo;
  };

  test("apply runs an issue's only choice by its id, and the issue is gone", () => {
    const repo = web();
    writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { "ghost-skill": { version: 1, hash: "abc" } } }));
    cli(repo, "status"); // remembers the project, as an agent's first status does
    const issue = JSON.parse(cli(repo, "doctor", "--json").out).find((i: { id: string }) => i.id.includes("ghost-skill"));
    expect(issue.choices).toEqual(["Remove it from skilllib.json"]);

    const r = cli(repo, "apply", issue.id, "1", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ id: issue.id, applied: "Remove it from skilllib.json", ok: true });
    expect(JSON.parse(cli(repo, "doctor", "--json").out).some((i: { id: string }) => i.id === issue.id)).toBe(false);
  });

  test("status --json gives each problem its id, and apply takes it in a repo skilllib hasn't seen yet", () => {
    const repo = web();
    writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { "ghost-skill": { version: 1, hash: "abc" } } }));
    // Nothing has run in this repo yet, so only status's view of it knows this issue.
    const r = cli(repo, "apply", `unavailable:${repo}:ghost-skill`, "Remove it from skilllib.json", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ applied: "Remove it from skilllib.json", ok: true });

    const { issues } = JSON.parse(cli(repo, "status", "--json").out);
    for (const i of issues) expect(i.ids).toHaveLength(i.problems.length);
    expect(issues.flatMap((i: { ids: string[] }) => i.ids)).toContain("review:global");
    expect(issues.flatMap((i: { ids: string[] }) => i.ids).some((id: string) => id.includes("ghost-skill"))).toBe(false);
  });

  test("an issue whose choices differ here and across your repos is applied by label only", () => {
    // alpha is kept global and also installed in web and api: from web, status offers to remove web's copy, doctor both.
    mkdirSync(join(tmp, ".claude", "skills", "alpha"), { recursive: true });
    writeFileSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    const repo = web();
    const api = join(tmp, "code", "api");
    mkdirSync(join(api, ".git"), { recursive: true });
    for (const r of [repo, api]) expect(cli(r, "add", "alpha").code).toBe(0);
    cli(api, "status", "--json");
    cli(repo, "global", "keep", "alpha");
    const choicesOf = (out: string, id: string) =>
      (JSON.parse(out).issues ?? JSON.parse(out)).find((i: { id?: string; ids?: string[] }) => i.id === id || i.ids?.includes(id))?.choices;
    expect(choicesOf(cli(repo, "status", "--json").out, "twice:alpha")).toEqual(["Remove the copies in web"]);
    expect(choicesOf(cli(repo, "doctor", "--json").out, "twice:alpha")).toEqual(["Remove the copies in api, web"]);

    const byNumber = cli(repo, "apply", "twice:alpha", "1");
    expect(byNumber.code).toBe(1);
    expect(byNumber.err).toContain("pick one by label");
    expect(existsSync(join(repo, ".claude", "skills", "alpha"))).toBe(true);

    expect(cli(repo, "apply", "twice:alpha", "Remove the copies in web").code).toBe(0);
    expect(existsSync(join(repo, ".claude", "skills", "alpha"))).toBe(false);
    expect(existsSync(join(api, ".claude", "skills", "alpha"))).toBe(true);
  });

  test("apply says why when there's nothing it can do", () => {
    const repo = web();
    expect(cli(repo, "apply", "no-such-issue").err).toContain("No issue no-such-issue right now");
    // Unreviewed global skills are reported with no choice: global move or global keep decides them.
    const r = cli(repo, "apply", "review:global");
    expect(r.code).toBe(1);
    expect(r.err).toContain("nothing to apply");
    expect(r.err).toContain("skilllib global move");
  });

  test("global move: the skill goes into the library and the repo, and stops loading globally", () => {
    const repo = web();
    const r = cli(repo, "global", "move", "mine", "--to", repo, "--json");
    expect(r.code).toBe(0);
    const [move] = JSON.parse(r.out);
    expect(move).toMatchObject({ skill: "mine", moved: true, projects: [{ project: "web", path: repo, change: { name: "mine", action: "installed" } }] });
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(false);
    expect(existsSync(join(tmp, ".skilllib", "library", "mine"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "skills", "mine", "SKILL.md"))).toBe(true);
    expect(cli(repo, "restore").out).toContain("mine");
  });

  test("global move into a repo that already has the same skill still moves it", () => {
    const repo = web();
    mkdirSync(join(repo, ".claude", "skills", "mine"), { recursive: true });
    writeFileSync(join(repo, ".claude", "skills", "mine", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    cli(repo, "status"); // remembers web, so --to can name it
    const [move] = JSON.parse(cli(repo, "global", "move", "mine", "--to", "web", "--to", repo, "--json").out);
    expect(move.moved).toBe(true);
    expect(move.projects).toHaveLength(1);
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(false);
  });

  test("global move moves every global copy of a skill, and only when they're the same", () => {
    const repo = web();
    mkdirSync(join(tmp, ".agents", "skills", "mine"), { recursive: true });
    writeFileSync(join(tmp, ".agents", "skills", "mine", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    const [move] = JSON.parse(cli(repo, "global", "move", "mine", "--to", repo, "--json").out);
    expect(move.moved).toBe(true);
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(false);
    expect(existsSync(join(tmp, ".agents", "skills", "mine"))).toBe(false);
  });

  test("global move leaves differing global copies alone", () => {
    const repo = web();
    mkdirSync(join(tmp, ".agents", "skills", "mine"), { recursive: true });
    writeFileSync(join(tmp, ".agents", "skills", "mine", "SKILL.md"), "---\ndescription: d\n---\nother\n");
    const r = cli(repo, "global", "move", "mine", "--to", repo, "--json");
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)[0]).toMatchObject({ skill: "mine", moved: false, reason: expect.stringContaining("copies of mine differ") });
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "skills", "mine"))).toBe(false);
  });

  test("global move wants a repo's top folder, not a folder inside it", () => {
    const repo = web();
    mkdirSync(join(repo, "docs"));
    const r = cli(repo, "global", "move", "mine", "--to", "./docs");
    expect(r.code).toBe(1);
    expect(r.err).toContain("is inside");
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(true);
  });

  test("global move refuses names that aren't your global skills, and needs --to", () => {
    const repo = web();
    expect(cli(repo, "global", "move", "nope", "--to", repo).err).toContain("Not one of your global skills: nope");
    expect(cli(repo, "global", "move", "mine").err).toContain("Usage: skilllib global move");
    // --to never takes a flag as a repo
    expect(cli(repo, "global", "move", "mine", "--to", "--json").err).toContain("Usage: skilllib global move");
    expect(existsSync(join(tmp, ".claude", "skills", "mine"))).toBe(true);
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

test("paths under $HOME show as ~ even when $HOME has a trailing slash and goes through a symlink (#51)", () => {
  const link = join(tmpdir(), `skilllib-home-link-${process.pid}-${Date.now()}`);
  symlinkSync(tmp, link, "junction");
  try {
    mkdirSync(join(tmp, ".agents", "skills", "theirs"), { recursive: true });
    writeFileSync(join(tmp, ".agents", "skills", "theirs", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
    process.env.HOME = `${link}/`;
    process.env.USERPROFILE = `${link}/`;
    expect(cli(tmp, "global").out).toContain("~/.agents/skills/theirs");
  } finally {
    rmSync(link, { force: true, recursive: false });
  }
});

test("a repo reached through a symlinked folder is one project, under the path you know (#52)", () => {
  const real = join(tmp, "drive", "Projects");
  mkdirSync(join(real, "web", ".git"), { recursive: true });
  const link = join(tmp, "Projects");
  symlinkSync(real, link, "junction");
  writeFileSync(join(tmp, ".skilllib", "projects.json"), JSON.stringify([join(real, "web"), join(link, "web")]));
  const projects = JSON.parse(cli(tmp, "projects", "--json").out) as { name: string; path: string }[];
  expect(projects.map((p) => [p.name, p.path])).toEqual([["web", join(link, "web")]]);
});

test("one global folder reached by two paths is one folder: listed once, never tidied into a link to itself (#54)", () => {
  const link = join(tmpdir(), `skilllib-home-link-${process.pid}-${Date.now()}`);
  symlinkSync(tmp, link, "junction");
  try {
    // Claude Code reads CLAUDE_CONFIG_DIR (the real path); Cursor reads ~/.claude through the symlinked $HOME.
    setHarnesses(["claude-code", "cursor"]);
    process.env.HOME = link;
    process.env.USERPROFILE = link;
    const listed = cli(tmp, "global").out.split("\n").filter((l) => l.includes(" mine "));
    expect(listed.length).toBe(1);
    const tidy = cli(tmp, "tidy", "--global");
    expect(tidy.out).toContain("every skill has one copy");
    expect(lstatSync(join(tmp, ".claude", "skills", "mine")).isSymbolicLink()).toBe(false);
  } finally {
    rmSync(link, { force: true, recursive: false });
  }
});
