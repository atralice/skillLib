import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { findIssues, runFix } from "./health.js";
import { addSkill, importSkill, projectStatus, removeSkill, syncProject } from "./library.js";
import { moveGlobalSkills } from "./move.js";
import { normalizeRemote, personalPins, personalPinsDir, personalPinsFile, readManifest } from "./project.js";
import { machineSkills } from "./sources.js";
import { forgetLatest } from "./versions.js";

let tmp: string;
let repo: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
const status = (cwd: string) => git(cwd, "status", "--porcelain", "--untracked-files=all");
const exclude = (cwd: string) => readFileSync(join(cwd, ".git", "info", "exclude"), "utf-8");

function writeSkill(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}

/** A repo cloned from `url` (only the remote matters), with one commit so worktrees work. */
function clone(name: string, url: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", url);
  writeFileSync(join(dir, "README.md"), "hi\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

beforeEach(() => {
  forgetLatest();
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-pins-")));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, ".skilllib");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code"]);
  writeSkill(join(tmp, "src", "alpha"), "v1");
  importSkill(join(tmp, "src", "alpha"));
  repo = clone("web", "git@GitHub.com:acme/web.git");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("a remote names the repo however it was cloned", () => {
  for (const url of ["git@github.com:acme/web.git", "github.com:acme/web.git", "https://GitHub.com/acme/web", "https://user@github.com/acme/web.git/", "ssh://git@github.com:22/acme/web.git", "ssh://git@github.com/acme/web"])
    expect(normalizeRemote(url)).toBe("github.com/acme/web");
  // Only the host: paths can differ in case on servers that care.
  expect(normalizeRemote("https://host.example/Team/Repo")).toBe("host.example/Team/Repo");
});

describe("a repo without skilllib.json", () => {
  test("add pins in your personal pins and keeps the copy out of git", () => {
    expect(addSkill(repo, "alpha")).toEqual({ name: "alpha", action: "installed", to: 1 });
    expect(existsSync(join(repo, "skilllib.json"))).toBe(false);
    const file = personalPinsFile(repo)!;
    expect(file.startsWith(personalPinsDir())).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject({ remote: "github.com/acme/web", skills: { alpha: { version: 1 } } });
    expect(exclude(repo)).toContain("/.claude/skills/alpha");
    expect(status(repo)).toBe("");
    expect(projectStatus(repo).find((s) => s.name === "alpha")).toMatchObject({ managed: true, state: "ok", personal: true });
  });

  test("another clone of the same repo gets them back with sync, out of git there too", () => {
    addSkill(repo, "alpha");
    const other = clone("elsewhere", "https://github.com/acme/web");
    expect(readManifest(other).skills.alpha).toMatchObject({ personal: true });
    expect(syncProject(other)).toMatchObject([{ name: "alpha", action: "installed" }]);
    expect(existsSync(join(other, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
    expect(status(other)).toBe("");
  });

  test("a repo with no remote keeps them by folder, shared with its worktrees", () => {
    const solo = join(tmp, "solo");
    mkdirSync(solo);
    git(solo, "init", "-q");
    git(solo, "commit", "-q", "--allow-empty", "-m", "init");
    addSkill(solo, "alpha");
    expect(personalPinsFile(solo)).toContain("local-solo-");
    const tree = join(tmp, "solo-tree");
    git(solo, "worktree", "add", "-q", tree);
    expect(personalPinsFile(tree)).toBe(personalPinsFile(solo));
    expect(syncProject(tree)).toMatchObject([{ name: "alpha", action: "installed" }]);
    expect(status(tree)).toBe("");
  });

  test("moving it to skilllib.json takes back a link git would see while git doesn't share the copy", () => {
    setHarnesses(["claude-code", "codex"]);
    writeSkill(join(repo, ".claude", "skills", "team"), "team");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "team");
    addSkill(repo, "alpha");
    expect(addSkill(repo, "alpha", { personal: false })).toMatchObject({ moved: "shared", uncommitted: [".claude/skills"] });
    expect(existsSync(join(repo, ".claude", "skills", "alpha"))).toBe(false);
    expect(readManifest(repo).skills.alpha?.links).toBeUndefined();
  });

  test("a pin whose version your library lacks doesn't move", () => {
    addSkill(repo, "alpha");
    const file = personalPinsFile(repo)!;
    writeFileSync(file, JSON.stringify({ skills: { alpha: { version: 1, hash: "from-elsewhere" } } }));
    expect(addSkill(repo, "alpha", { personal: false })).toMatchObject({ action: "skipped", reason: expect.stringContaining("can't move as it is") });
  });

  test("an exclude block missing its end line keeps the lines after it", () => {
    addSkill(repo, "alpha");
    writeFileSync(join(repo, ".git", "info", "exclude"), exclude(repo).replace("# end skilllib\n", "") + "mine.log\n");
    removeSkill(repo, "alpha");
    expect(exclude(repo)).toContain("mine.log");
    expect(exclude(repo)).not.toContain("# skilllib");
  });

  test("remove takes the pin and the exclude lines away", () => {
    addSkill(repo, "alpha");
    expect(removeSkill(repo, "alpha")).toMatchObject({ action: "removed" });
    expect(existsSync(personalPinsFile(repo)!)).toBe(false);
    expect(exclude(repo)).not.toContain("skilllib");
  });

  test("a personal skill is linked where git tracks the folder, without asking: the link stays out of git too", () => {
    setHarnesses(["claude-code", "codex"]);
    // The real copy goes in .agents/skills (Codex's); the team commits .claude/skills, where Claude Code's link goes.
    writeSkill(join(repo, ".claude", "skills", "team"), "team");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "team");
    const c = addSkill(repo, "alpha");
    expect(c.blocked).toBeUndefined();
    expect(c.uncommitted).toBeUndefined();
    expect(readManifest(repo).skills.alpha).toMatchObject({ dir: ".agents/skills", links: [".claude/skills"] });
    expect(status(repo)).toBe("");
  });
});

describe("a repo with skilllib.json", () => {
  beforeEach(() => {
    writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: {} }, null, 2) + "\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "skilllib");
  });

  test("add pins there, for the team; --personal pins in yours", () => {
    addSkill(repo, "alpha");
    expect(JSON.parse(readFileSync(join(repo, "skilllib.json"), "utf-8")).skills.alpha).toBeDefined();
    expect(personalPins(repo)).toEqual({});
    removeSkill(repo, "alpha");
    addSkill(repo, "alpha", { personal: true });
    expect(JSON.parse(readFileSync(join(repo, "skilllib.json"), "utf-8")).skills).toEqual({});
    expect(Object.keys(personalPins(repo))).toEqual(["alpha"]);
    expect(status(repo)).toBe("");
  });

  test("moving a pin keeps its version and says where it went", () => {
    addSkill(repo, "alpha", { personal: true });
    writeSkill(join(tmp, ".skilllib", "library", "alpha"), "v2");
    forgetLatest();
    expect(addSkill(repo, "alpha", { personal: false })).toMatchObject({ action: "unchanged", to: 1, moved: "shared" });
    expect(JSON.parse(readFileSync(join(repo, "skilllib.json"), "utf-8")).skills.alpha.version).toBe(1);
    expect(personalPins(repo)).toEqual({});
    expect(exclude(repo)).not.toContain("alpha");
    // Without a flag, add stays where the pin is and takes the newest.
    expect(addSkill(repo, "alpha")).toMatchObject({ action: "updated", from: 1, to: 2 });
    expect(readManifest(repo).skills.alpha?.personal).toBeUndefined();
  });

  test("a committed copy can't become personal", () => {
    addSkill(repo, "alpha");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "alpha");
    const c = addSkill(repo, "alpha", { personal: true });
    expect(c).toMatchObject({ action: "skipped" });
    expect(c.reason).toContain("is committed to git, so it can't be personal");
    expect(personalPins(repo)).toEqual({});
  });

  test("a skill pinned in both: the repo's pin wins, and doctor drops yours", () => {
    addSkill(repo, "alpha", { personal: true });
    const pin = JSON.parse(readFileSync(personalPinsFile(repo)!, "utf-8")).skills.alpha;
    writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { alpha: pin } }));
    expect(readManifest(repo).skills.alpha?.personal).toBeUndefined();
    const issue = findIssues([repo], machineSkills(), new Set(["alpha"])).find((i) => i.id === `shadowed:${repo}`)!;
    expect(issue.title).toBe("web: 1 skill pinned in both skilllib.json and your personal pins");
    expect(issue.fix).toBeUndefined();
    expect(runFix(issue.choices![0]!)).toEqual({ ok: true, message: "web: alpha now pinned only in skilllib.json" });
    expect(readdirSync(personalPinsDir())).toEqual([]);
    expect(readManifest(repo).skills.alpha).toBeDefined();
    expect(exclude(repo)).not.toContain("alpha");
  });
});

test("global move into a repo without skilllib.json pins it personally, out of git", () => {
  writeSkill(join(tmp, ".claude", "skills", "alpha"), "v1");
  const [mv] = moveGlobalSkills([{ name: "alpha", path: join(tmp, ".claude", "skills", "alpha"), links: [], harnesses: ["claude-code"] }], [repo]);
  expect(mv).toMatchObject({ moved: true });
  expect(readManifest(repo).skills.alpha?.personal).toBe(true);
  expect(existsSync(join(repo, "skilllib.json"))).toBe(false);
  expect(status(repo)).toBe("");
});

test("syncing a monorepo package leaves the repo's personal skills out of git", () => {
  addSkill(repo, "alpha");
  const pkg = join(repo, "packages", "web");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "skilllib.json"), JSON.stringify({ skills: {} }, null, 2) + "\n");
  addSkill(pkg, "alpha");
  git(repo, "add", "packages");
  git(repo, "commit", "-qm", "packages");
  syncProject(pkg);
  expect(exclude(repo)).toContain("/.claude/skills/alpha");
  expect(status(repo)).toBe("");
});

test("adding a remote to a repo keeps its personal pins, out of git", () => {
  const solo = join(tmp, "solo");
  mkdirSync(solo);
  git(solo, "init", "-q");
  git(solo, "commit", "-q", "--allow-empty", "-m", "init");
  addSkill(solo, "alpha");
  const before = personalPinsFile(solo)!;
  git(solo, "remote", "add", "origin", "git@github.com:me/solo.git");
  const after = personalPinsFile(solo)!;
  expect(after).not.toBe(before);
  expect(existsSync(before)).toBe(false);
  expect(JSON.parse(readFileSync(after, "utf-8"))).toMatchObject({ path: expect.stringContaining("solo"), skills: { alpha: { version: 1 } } });
  expect(readManifest(solo).skills.alpha?.personal).toBe(true);
  addSkill(solo, "alpha");
  expect(JSON.parse(readFileSync(after, "utf-8")).remote).toBe("github.com/me/solo");
  expect(status(solo)).toBe("");
});

test("another repo cloned into a deleted one's folder doesn't take over its pins", () => {
  const solo = join(tmp, "solo");
  mkdirSync(solo);
  git(solo, "init", "-q");
  git(solo, "commit", "-q", "--allow-empty", "-m", "init");
  addSkill(solo, "alpha");
  const old = personalPinsFile(solo)!;
  rmSync(solo, { recursive: true, force: true });
  const other = clone("solo", "git@github.com:someone/else.git");
  expect(readManifest(other).skills).toEqual({});
  expect(existsSync(old)).toBe(true);
});

test("a skill name with glob characters is excluded as itself", () => {
  writeSkill(join(tmp, "src", "notes[draft]"), "n");
  importSkill(join(tmp, "src", "notes[draft]"));
  addSkill(repo, "notes[draft]");
  expect(exclude(repo)).toContain("/.claude/skills/notes\\[draft\\]");
  expect(status(repo)).toBe("");
});

test("a monorepo package can't have personal pins", () => {
  const pkg = join(repo, "packages", "app");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "skilllib.json"), '{ "skills": {} }\n');
  expect(personalPinsFile(pkg)).toBeNull();
  expect(addSkill(pkg, "alpha", { personal: true })).toMatchObject({ action: "skipped", reason: "only the top folder of a git repo can have personal pins" });
  expect(addSkill(pkg, "alpha")).toMatchObject({ action: "installed" });
});

test("the CLI: --personal and --shared don't go together; --json says personal", () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd: repo, env: { ...process.env }, encoding: "utf-8" });
  expect(JSON.parse(cli("add", "alpha", "--personal", "--shared", "--json").stdout).error).toContain("don't go together");
  const added = cli("add", "alpha", "--json");
  expect(JSON.parse(added.stdout)).toEqual([{ name: "alpha", action: "installed", to: 1, dirs: [".claude/skills"], personal: true }]);
  expect(JSON.parse(cli("status", "--json").stdout).skills).toContainEqual({ source: "library", version: 1, git: "ignored", personal: true, skills: ["alpha"] });
});

test("moving the only pin back to personal takes away the skilllib.json --shared made, so adds stay personal", () => {
  writeSkill(join(tmp, "src", "gamma"), "v1");
  importSkill(join(tmp, "src", "gamma"));
  addSkill(repo, "alpha");
  addSkill(repo, "alpha", { personal: false });
  expect(existsSync(join(repo, "skilllib.json"))).toBe(true);
  addSkill(repo, "alpha", { personal: true });
  expect(existsSync(join(repo, "skilllib.json"))).toBe(false);
  expect(addSkill(repo, "gamma")).toMatchObject({ action: "installed" });
  expect(readManifest(repo).skills.gamma?.personal).toBe(true);
  expect(status(repo)).toBe("");
  // One git tracks is the team's: it stays, even empty.
  addSkill(repo, "alpha", { personal: false });
  git(repo, "add", "skilllib.json", ".claude");
  git(repo, "commit", "-qm", "share alpha");
  git(repo, "rm", "-rq", "--cached", ".claude/skills/alpha");
  git(repo, "commit", "-qm", "untrack the copy");
  addSkill(repo, "alpha", { personal: true });
  expect(existsSync(join(repo, "skilllib.json"))).toBe(true);
});

test.skipIf(process.platform === "win32")("a personal skill stays out of git when a skills folder is a link to another one in the repo", () => {
  setHarnesses(["claude-code", "codex"]);
  const layouts: [string, [string, string][]][] = [
    ["b", [[".agents/skills", "../.claude/skills"]]],
    ["c", [[".claude/skills", "../skills"], [".agents/skills", "../skills"]]],
  ];
  for (const [name, links] of layouts) {
    const r = clone(`layout-${name}`, `git@github.com:acme/layout-${name}.git`);
    for (const [from, to] of links) {
      mkdirSync(join(r, from, "..", to), { recursive: true });
      writeFileSync(join(r, from, "..", to, ".keep"), "");
      mkdirSync(join(r, from, ".."), { recursive: true });
      symlinkSync(to, join(r, from));
    }
    git(r, "add", "-A");
    git(r, "commit", "-qm", "layout");
    expect(addSkill(r, "alpha")).toMatchObject({ action: "installed" });
    expect([name, status(r)]).toEqual([name, ""]);
  }
});

test("remotes whose URL has a space are two repos, with two pins files", () => {
  const a = clone("sp-a", join(tmp, "My Repos", "a.git"));
  const b = clone("sp-b", join(tmp, "My Repos", "b.git"));
  expect(personalPinsFile(a)).not.toBe(personalPinsFile(b));
});

test("moving a pin never resets an edited copy, even with --force", () => {
  addSkill(repo, "alpha");
  writeFileSync(join(repo, ".claude", "skills", "alpha", "SKILL.md"), "edited\n");
  const c = addSkill(repo, "alpha", { personal: false, force: true });
  expect(c).toMatchObject({ action: "skipped" });
  expect(c.reason).toContain("so its pin can't move");
  expect(c.reason).not.toContain("--force");
  expect(readFileSync(join(repo, ".claude", "skills", "alpha", "SKILL.md"), "utf-8")).toBe("edited\n");
  expect(readManifest(repo).skills.alpha?.personal).toBe(true);
});

