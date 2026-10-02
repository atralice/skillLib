import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "../config.js";
import { importSkill, isLink, listBackups } from "../library.js";
import { rememberProjects } from "../project.js";
import { forgetLatest } from "../versions.js";
import { loadWorld, uniqueNames } from "./load.js";
import { reviewPrompt } from "./prompts.js";
import { usableHere } from "../here.js";
import { agentSkillIssue, deleteLibraryFix, failed, followUp, issuesOf, machineActions, machineIssues, replacePluginFix, said, usable, type World } from "./world.js";

let tmp: string;
let repo: string;
const env = { HOME: process.env.HOME, cwd: process.cwd() };

function writeSkill(dir: string, body = "body") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: x\ndescription: d\n---\n${body}\n`);
}

beforeEach(() => {
  forgetLatest();
  tmp = mkdtempSync(join(tmpdir(), "skilllib-tui-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code"]);
  repo = join(tmp, "app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  rememberProjects([repo]);
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(env.cwd);
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = env.HOME;
  delete process.env.SKILLLIB_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
});

const local = (w: World, name: string) => usable(w, "app").find((u) => u.local && u.name === name)!;
const issue = (w: World, id: string) => issuesOf(w, "app", local(w, id.split(":")[1]!)).find((i) => i.id === id);
const run = (w: World, issueId: string, name: string, fix = 0) => issuesOf(w, "app", local(w, name)).find((i) => i.id.startsWith(issueId))!.fixes[fix]!.run(w);

test("a skill only in the repo gets imported and tracked", () => {
  writeSkill(join(repo, ".claude", "skills", "notes"));
  let w = loadWorld();
  expect(w.cwd).toBe("app");
  expect(local(w, "notes").local!.source).toBe("untracked");
  run(w, "local", "notes");
  w = loadWorld();
  expect(local(w, "notes").local!.source).toBe("lib");
  expect(w.library.map((l) => l.name)).toContain("notes");
});

test("a global skill loaded twice is unloaded, backed up and restorable", () => {
  writeSkill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  writeSkill(join(tmp, ".claude", "skills", "alpha"));
  let w = loadWorld();
  w.ops.add("app", "alpha");
  w = loadWorld();
  expect(w.machine.find((m) => m.name === "alpha")?.source).toBe("global");
  run(w, "twice-g", "alpha");
  w = loadWorld();
  expect(w.machine.some((m) => m.name === "alpha")).toBe(false);
  expect(w.backups[0]?.name).toBe("alpha");
  w.ops.restoreBackup(0);
  expect(loadWorld().machine.some((m) => m.name === "alpha")).toBe(true);
});

test("keeping a global skill on purpose clears its warning", () => {
  writeSkill(join(tmp, ".claude", "skills", "beta"));
  let w = loadWorld();
  const beta = () => w.machine.find((m) => m.name === "beta")!;
  expect(machineIssues(w, beta()).map((i) => i.id)).toContain("global:beta");
  machineIssues(w, beta())[0]!.fixes[1]!.run(w);
  w = loadWorld();
  expect(beta().kept).toBe(true);
  expect(machineIssues(w, beta())).toEqual([]);
});

test("a group moved together stays grouped in your library", () => {
  for (const name of ["cf-one", "cf-two"]) writeSkill(join(tmp, ".claude", "skills", name));
  let w = loadWorld();
  expect(w.ops.moveGlobal(w.machine, ["app"], "cloudflare set")).toBe("2 skills now load only in app");
  w = loadWorld();
  expect(w.machine).toEqual([]);
  expect(w.library.map((l) => l.origin)).toEqual(["group: cloudflare set", "group: cloudflare set"]);
});

test("moving to a repo that commits Claude Code's folder asks before linking, and names who can't see it", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeSkill(join(repo, ".claude", "skills", "team"));
  writeSkill(join(repo, ".agents", "skills", "other"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  for (const name of ["tool-a", "tool-b"]) writeSkill(join(tmp, ".agents", "skills", name));

  let w = loadWorld();
  const r = w.ops.moveGlobal(w.machine.filter((m) => m.name.startsWith("tool-")), ["app"], "tools");
  if (typeof r === "string" || !("then" in r)) throw new Error(`expected a follow-up: ${typeof r === "string" ? r : r.message}`);
  expect(r.message).toBe("2 skills now load only in app; Claude Code can't see them in app: git tracks .claude/skills");
  expect(r.then.label).toBe("Also link them in .claude/skills");
  expect(isLink(join(repo, ".claude", "skills", "tool-a"))).toBe(false);

  w = loadWorld();
  expect(r.then.run(w)).toBe("Linked 2 skills in .claude/skills in app");
  for (const name of ["tool-a", "tool-b"]) {
    expect(isLink(join(repo, ".claude", "skills", name))).toBe(true);
    expect(JSON.parse(readFileSync(join(repo, "skilllib.json"), "utf-8")).skills[name].links).toEqual([".claude/skills"]);
  }

  // Remembered for this repo: the next one links without asking.
  writeSkill(join(tmp, ".agents", "skills", "tool-c"));
  w = loadWorld();
  expect(w.ops.moveGlobal(w.machine.filter((m) => m.name === "tool-c"), ["app"])).toBe("tool-c now loads only in app");
  expect(isLink(join(repo, ".claude", "skills", "tool-c"))).toBe(true);
});

test("moving to a repo that commits only Claude Code's folder names who can't see it, without offering a link that would break", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeSkill(join(repo, ".claude", "skills", "team"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".agents", "skills", "tool-a"));

  const w = loadWorld();
  expect(w.ops.moveGlobal(w.machine, ["app"])).toBe(
    "tool-a now loads only in app; Claude Code can't see it in app: .agents/skills isn't committed, so a link in .claude/skills would break for teammates",
  );
});

test("adding library skills to a repo that commits Claude Code's folder asks once, for all of them, and remembers it", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeSkill(join(repo, ".claude", "skills", "team"));
  writeSkill(join(repo, ".agents", "skills", "other"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  for (const name of ["tool-a", "tool-b", "tool-c"]) {
    writeSkill(join(tmp, "src", name));
    importSkill(join(tmp, "src", name));
  }

  // One skill (Your skills › Add to repos…): the same question as Move to repos.
  let w = loadWorld();
  const one = w.ops.addTo(["app"], ["tool-a"]);
  expect(said(one)).toBe("Added tool-a v1 in app; not linked in .claude/skills: git tracks it");
  expect(followUp(one)?.label).toBe("Also link it in .claude/skills");

  // A group (Add all N to repos…): one question for all of them.
  const r = w.ops.addTo(["app"], ["tool-a", "tool-b"]);
  expect(said(r)).toBe("Added 2 skills to app; not linked in .claude/skills in app: git tracks it");
  const then = followUp(r)!;
  expect(then.label).toBe("Also link them in .claude/skills");
  w = loadWorld();
  expect(then.run(w)).toBe("Linked 2 skills in .claude/skills in app");
  for (const name of ["tool-a", "tool-b"]) {
    expect(isLink(join(repo, ".claude", "skills", name))).toBe(true);
    expect(JSON.parse(readFileSync(join(repo, "skilllib.json"), "utf-8")).skills[name].links).toEqual([".claude/skills"]);
  }

  // Remembered for this repo: the next one links without asking.
  expect(loadWorld().ops.addTo(["app"], ["tool-c"])).toBe("Added tool-c v1 in app");
  expect(isLink(join(repo, ".claude", "skills", "tool-c"))).toBe(true);
});

test("adding a skill whose copy git doesn't share says why it isn't linked, without offering a link that would break", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeSkill(join(repo, ".claude", "skills", "team"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, "src", "tool-a"));
  importSkill(join(tmp, "src", "tool-a"));

  const r = loadWorld().ops.addTo(["app"], ["tool-a"]);
  expect(r).toBe("Added tool-a v1 in app; not linked in .claude/skills: git tracks it and .agents/skills/tool-a isn't committed, so teammates would get broken links");
  expect(isLink(join(repo, ".claude", "skills", "tool-a"))).toBe(false);
});

test("linking never puts an uncommitted skill in a folder git tracks, and doesn't ask to", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeSkill(join(repo, ".claude", "skills", "team"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeSkill(join(repo, ".cursor", "skills", "mine"));
  setHarnesses(["claude-code", "cursor"]);

  const w = loadWorld();
  // Nothing linked: a failure (✗), and Health doesn't offer it as a fix, it says to commit first.
  expect(w.ops.link("app", "mine")).toEqual(failed("mine: not linked in .claude/skills: git tracks it and mine isn't committed, so teammates would get broken links"));
  expect(isLink(join(repo, ".claude", "skills", "mine"))).toBe(false);
  expect(local(w, "mine").local!.unshared).toEqual(["claude-code"]);
  const blind = issue(w, "blind:mine")!;
  expect(blind.short).toBe("Claude Code can't see it: commit it first");
  expect(blind.decision).toBe(true);
  expect(blind.fixes).toEqual([]);

  // Committed, the link fix is back.
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "mine");
  const after = loadWorld();
  expect(local(after, "mine").local!.unshared).toBeUndefined();
  expect(issue(after, "blind:mine")!.fixes.map((f) => f.label)).toEqual(["Link it for every agent"]);
});

test("a skill pinned in skilllib.json that your library doesn't have: no restore, no library actions, only removing the pin", () => {
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { "ghost-skill": { version: 1, hash: "abc" } } }));
  let w = loadWorld();
  const s = local(w, "ghost-skill").local!;
  expect(s).toMatchObject({ missing: true, library: "missing" });
  const ids = issuesOf(w, "app", local(w, "ghost-skill")).map((i) => i.id);
  expect(ids).toEqual(["unavailable:ghost-skill"]);
  const pinned = issue(w, "unavailable:ghost-skill")!;
  expect(pinned.title).toContain("not in your library: import it, or set SKILLLIB_HOME");
  expect(pinned.decision).toBe(true);
  expect(pinned.fixes.map((f) => f.label)).toEqual(["Remove it from skilllib.json"]);
  expect(said(pinned.fixes[0]!.run(w))).toBe("Removed ghost-skill from app");
  w = loadWorld();
  expect(usable(w, "app").some((u) => u.name === "ghost-skill")).toBe(false);
});

test("deleting a library skill removes it from every repo, edits backed up", () => {
  writeSkill(join(tmp, "src", "gamma"));
  importSkill(join(tmp, "src", "gamma"));
  let w = loadWorld();
  w.ops.add("app", "gamma");
  writeFileSync(join(repo, ".claude", "skills", "gamma", "SKILL.md"), "edited here\n");
  w = loadWorld();
  const fix = deleteLibraryFix(w, ["gamma"]);
  expect(fix.label).toBe("Delete from your library and 1 repo…");
  expect(fix.preview).toContain("Removes it from this repo: app.");
  expect(fix.preview).toContain("app has local edits: backed up too.");
  expect(fix.run(w)).toBe("Deleted gamma from your library and from app (in Settings › Backups)");
  w = loadWorld();
  expect(w.library.some((l) => l.name === "gamma")).toBe(false);
  expect(w.projects[0]!.skills).toEqual([]);
  expect(listBackups().filter((b) => b.name === "gamma").length).toBe(2);
});

function fakePlugin() {
  const plugin = join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "tools");
  for (const name of ["lint", "fmt"]) writeSkill(join(plugin, "skills", name));
  mkdirSync(join(plugin, "commands"), { recursive: true });
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "tools@mk": true } }));
}

/** A `claude` command that records what it was asked, or no `claude` at all. It's a shell script, so the tests that run it skip Windows. */
function withClaude(installed: boolean, body: () => void) {
  const path = process.env.PATH;
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  if (installed) writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1" = --version ] && echo "2.1 (Claude Code)" && exit 0\necho "$@" > "${tmp}/claude-args"\n`, { mode: 0o755 });
  process.env.PATH = bin;
  try {
    body();
  } finally {
    process.env.PATH = path;
  }
}

test.skipIf(process.platform === "win32")("a plugin is replaced by library skills, then uninstalled", () => {
  fakePlugin();
  let w = loadWorld();
  expect(w.machine.map((m) => `${m.name}:${m.source}`).sort()).toEqual(["fmt:plugin", "lint:plugin"]);
  const fix = replacePluginFix(w, "tools@mk");
  expect(fix.preview).toContain("then uninstalls tools@mk from Claude Code");
  expect(fix.preview).toContain("It also brings commands: those go too.");
  withClaude(true, () => expect(fix.pickRepos!(w, ["app"])).toBe("2 skills from tools@mk are in your library and in app; tools@mk is uninstalled (restore it from Settings › Backups, or reinstall with /plugin)"));
  expect(loadWorld().backups[0]).toMatchObject({ name: "tools@mk", from: "tools@mk" });
  expect(readFileSync(join(tmp, "claude-args"), "utf-8").trim()).toBe("plugin uninstall tools@mk --keep-data");
  w = loadWorld();
  expect(w.library.map((l) => `${l.name}:${l.origin}`).sort()).toEqual(["fmt:plugin: tools@mk", "lint:plugin: tools@mk"]);
  expect(w.projects[0]!.skills.map((s) => s.name).sort()).toEqual(["fmt", "lint"]);
});

test("without the claude command, a replaced plugin is at least turned off", () => {
  fakePlugin();
  const w = loadWorld();
  withClaude(false, () => expect(replacePluginFix(w, "tools@mk").pickRepos!(w, [])).toContain("turned tools@mk off in ~/.claude/settings.json (the claude command isn't on your PATH): finish with /plugin uninstall tools@mk"));
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "tools@mk": false });
  expect(loadWorld().machine).toEqual([]);
});

test("a plugin synced from claude.ai is copied in and turned off (it can't be uninstalled)", () => {
  writeSkill(join(tmp, ".claude", "plugins", "synced", "b1", "rail", "skills", "deploy"));
  let w = loadWorld();
  const id = w.machine.find((m) => m.name === "deploy")!.where;
  expect(id).toBe("rail@synced");
  const fix = replacePluginFix(w, id);
  expect(fix.preview).toContain("then turns rail@synced off in Claude Code. It's synced from your claude.ai account");
  // Without the claude command: the same setting `claude plugin disable` writes.
  withClaude(false, () => expect(fix.pickRepos!(w, [])).toContain("turned rail@synced off in ~/.claude/settings.json"));
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "rail@synced": false });
  w = loadWorld();
  expect(w.library.map((l) => l.name)).toEqual(["deploy"]);
  expect(w.machine).toEqual([]);
});

test.skipIf(process.platform === "win32")("with the claude command, a synced plugin is disabled, not uninstalled", () => {
  writeSkill(join(tmp, ".claude", "plugins", "synced", "b1", "rail", "skills", "deploy"));
  const w = loadWorld();
  withClaude(true, () => expect(replacePluginFix(w, "rail@synced").pickRepos!(w, [])).toBe("1 skill from rail@synced is in your library; rail@synced is off (it's synced from claude.ai: remove it there to delete it for good)"));
  expect(readFileSync(join(tmp, "claude-args"), "utf-8").trim()).toBe("plugin disable rail@synced");
});

test("identical copies in a repo become one copy plus a link", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".claude", "skills", "notes"));
  writeSkill(join(repo, ".agents", "skills", "notes"));
  let w = loadWorld();
  const copies = issue(w, "copies:notes")!;
  expect(copies.decision).toBe(false);
  expect(copies.fixes[0]!.run(w)).toBe("notes: .claude/skills/notes: duplicate copy → link");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, "copies:notes")).toBeUndefined();
  expect(w.backups.map((b) => b.name)).toEqual(["notes"]);
});

test("differing copies in a repo: which agent runs which, and you pick the one to keep", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".claude", "skills", "notes"), "mine");
  writeSkill(join(repo, ".agents", "skills", "notes"), "theirs");
  let w = loadWorld();
  const conflict = issue(w, "conflict:notes")!;
  expect(conflict.title).toBe("Copies differ: .claude/skills (Claude Code) vs .agents/skills (Codex)");
  expect(conflict.decision).toBe(true);
  // Which copy the library comparison looked at is arbitrary: only the conflict shows.
  expect(issue(w, "local:notes")).toBeUndefined();
  conflict.fixes.find((f) => f.label === "Keep the .agents/skills copy")!.run(w);
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  expect(readFileSync(join(repo, ".claude", "skills", "notes", "SKILL.md"), "utf-8")).toContain("theirs");
  w = loadWorld();
  expect(issue(w, "conflict:notes")).toBeUndefined();
});

test("tidying asks before changing what git tracks", () => {
  setHarnesses(["claude-code", "codex"]);
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".claude", "skills", "notes"));
  writeSkill(join(repo, ".agents", "skills", "notes"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "skills");
  const w = loadWorld();
  const fix = issue(w, "copies:notes")!.fixes[0]!;
  expect(fix.preview).toContain("Git would see");
  const r = fix.run(w);
  const then = followUp(r);
  if (!then) throw new Error(`expected a question, got: ${said(r)}`);
  expect(said(r)).toBe("notes: held back .claude/skills/notes: duplicate copy → link, because git tracks it");
  const links = () => [".claude", ".agents"].filter((d) => isLink(join(repo, d, "skills", "notes")));
  expect(links()).toEqual([]);
  then.run(w);
  expect(links()).toEqual([".claude"]);
});

test("identical global copies become one copy plus a link", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "beta"));
  writeSkill(join(tmp, ".agents", "skills", "beta"));
  let w = loadWorld();
  const beta = w.machine.find((m) => m.name === "beta")!;
  const copies = machineIssues(w, beta).find((i) => i.id === "copies-g:beta")!;
  copies.fixes[0]!.run(w);
  expect(isLink(join(tmp, ".claude", "skills", "beta"))).toBe(true);
  w = loadWorld();
  expect(w.machine.filter((m) => m.name === "beta").flatMap((m) => machineIssues(w, m).map((i) => i.id))).toEqual(["global:beta"]);
});

test("an agent that can't see a repo's skill is reported, and a link fixes it", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".agents", "skills", "notes"));
  let w = loadWorld();
  expect(local(w, "notes").agents).toEqual(["codex"]);
  const blind = issue(w, "blind:notes")!;
  expect(blind.title).toBe("Claude Code can't see it");
  expect(blind.fixes[0]!.preview).toBe("Add links (nothing is copied or moved), so Claude Code loads it too.");
  expect(blind.fixes[0]!.run(w)).toBe("notes: linked in .claude/skills");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, "blind:notes")).toBeUndefined();
});

test("linking for every agent asks before linking into a folder git tracks", () => {
  setHarnesses(["claude-code", "codex"]);
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".agents", "skills", "notes"));
  writeSkill(join(repo, ".claude", "skills", "other"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "skills");
  let w = loadWorld();
  const r = issue(w, "blind:notes")!.fixes[0]!.run(w);
  if (typeof r === "string" || !("then" in r)) throw new Error(`expected a question, got: ${typeof r === "string" ? r : r.message}`);
  expect(r.message).toBe("notes: nothing to link; not linked in .claude/skills: git tracks it");
  expect(r.then.preview).toContain(".claude/skills is committed in app");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(false);
  r.then.run(w);
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, "blind:notes")).toBeUndefined();
});

test("a skill the repo commits in .claude/skills is the team's: a plugin with its name is turned off, never the copy removed", () => {
  fakePlugin();
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".claude", "skills", "lint"));
  writeSkill(join(repo, ".claude", "skills", "scratch"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".claude/skills/lint");
  git("commit", "-qm", "lint");
  const w = loadWorld();
  expect(local(w, "lint").local!.source).toBe("repo");
  expect(local(w, "scratch").local!.source).toBe("untracked");
  expect(issue(w, "twice-p:lint")!.fixes.map((f) => f.label)).toEqual(["Turn the plugin off in app only"]);
  expect(issue(w, "local:lint")).toBeUndefined();
  expect(w.ops.remove("app", "lint")).toEqual({ message: "lint is the repo's own (committed by your team): skilllib doesn't delete it", failed: true });
  expect(existsSync(join(repo, ".claude", "skills", "lint", "SKILL.md"))).toBe(true);
  // Only on this machine: removable, and backed up.
  expect(w.ops.remove("app", "scratch")).toBe("Removed scratch from app (in Settings › Backups)");
});

test("a skill `npx skills add` put in the repo isn't a library skill; committed, it's the team's", () => {
  setHarnesses(["claude-code", "codex"]);
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".agents", "skills", "lint"));
  writeSkill(join(repo, ".agents", "skills", "fmt"));
  writeFileSync(join(repo, "skills-lock.json"), JSON.stringify({ skills: { lint: { source: "acme/skills" }, fmt: { source: "acme/skills" } } }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".agents/skills/lint", "skills-lock.json");
  git("commit", "-qm", "lint");
  const w = loadWorld();
  expect(local(w, "lint").local!.source).toBe("repo");
  expect(local(w, "fmt").local!.source).toBe("untracked");
  expect(local(w, "lint").local!.version).toBeUndefined();
  expect(w.ops.remove("app", "lint")).toEqual({ message: "lint is the repo's own (committed by your team): skilllib doesn't delete it", failed: true });
  // The review prompt says where it came from, and which agents load it in which repo.
  const prompt = reviewPrompt(w, ["lint"], "Review lint.");
  expect(prompt).toContain("- Installed via: npx skills: acme/skills");
  expect(prompt).toContain("- Loaded by: Codex — in app");
  // A copy only on this machine says so, and a repo's review describes the repo's own copy.
  const fmt = reviewPrompt(w, ["fmt"], "Review the skills in app.", "app");
  expect(fmt).toContain("- Source: a copy only on this machine (not committed)");
  expect(fmt).toContain("- Installed via: npx skills: acme/skills");
  expect(reviewPrompt(w, ["lint"], "Review the skills in app.", "app")).toContain("- Source: a repo's own skill (committed by the team)");
});

test("status --json calls a copy git tracks the repo's, as the TUI does, wherever it lives", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".claude", "skills", "lint"));
  writeSkill(join(repo, ".claude", "skills", "scratch"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".claude/skills/lint");
  git("commit", "-qm", "lint");
  expect(usableHere(repo).skills.map((g) => [g.source, g.skills])).toEqual([
    ["repo", ["lint"]],
    ["local", ["scratch"]],
  ]);
});

test("picking an older version says so, not \"Updated\"", () => {
  writeSkill(join(tmp, "src", "notes"), "v1");
  importSkill(join(tmp, "src", "notes"));
  writeSkill(join(tmp, "src", "notes"), "v2");
  importSkill(join(tmp, "src", "notes"), { force: true });
  const w = loadWorld();
  expect(w.ops.add("app", "notes")).toBe("Added notes v2 in app");
  expect(w.ops.installVersion("app", "notes", 1)).toBe("Pinned notes to v1 in app (was v2)");
  expect(w.ops.installVersion("app", "notes", 2)).toBe("Updated notes v2 in app");
});

test("the skilllib skill installs from Health for every agent you use", () => {
  setHarnesses(["claude-code", "codex"]);
  let w = loadWorld();
  expect(w.agentSkill).toBe("missing");
  expect(agentSkillIssue(w)!.fixes[0]!.run(w)).toBe("Your agents can now use skilllib (~/.claude/skills/skilllib, ~/.agents/skills/skilllib)");
  w = loadWorld();
  expect(w.agentSkill).toBe("installed");
  expect(agentSkillIssue(w)).toBeNull();
  // It's skilllib's own: not a global skill to review.
  const own = w.machine.filter((m) => m.name === "skilllib");
  expect(own.length).toBeGreaterThan(0);
  expect(own.flatMap((m) => [m.source === "global" ? "global" : "", ...machineIssues(w, m).map((i) => i.id)]).filter(Boolean)).toEqual([]);
});

test("Global shows the skilllib skill as skilllib's own: update it when it's old, or remove it", () => {
  setHarnesses(["claude-code", "codex"]);
  let w = loadWorld();
  w.ops.installAgentSkill();
  w = loadWorld();
  const own = () => w.machine.find((m) => m.name === "skilllib")!;
  expect(own()).toMatchObject({ source: "skilllib", where: "~/.claude/skills", agents: ["claude-code", "codex"] });
  expect(machineActions(own()).map((f) => f.label)).toEqual(["Remove the skilllib skill"]);

  // An old copy: its row says so, and offers the update.
  writeFileSync(join(tmp, ".claude", "skills", "skilllib", "SKILL.md"), "old\n");
  w = loadWorld();
  expect(w.agentSkill).toBe("outdated");
  expect(machineIssues(w, own()).flatMap((i) => i.fixes.map((f) => f.label))).toEqual(["Update the skilllib skill"]);

  expect(said(machineActions(own())[0]!.run(w))).toBe("Removed the skilllib skill (~/.claude/skills/skilllib, ~/.agents/skills/skilllib)");
  w = loadWorld();
  expect(w.agentSkill).toBe("missing");
  expect(w.machine.some((m) => m.name === "skilllib")).toBe(false);
});

test("a repo copy of a skill you keep global is the extra one", () => {
  writeSkill(join(tmp, ".claude", "skills", "beta"));
  writeSkill(join(repo, ".claude", "skills", "beta"));
  let w = loadWorld();
  w.ops.keepGlobal("beta", true);
  w = loadWorld();
  expect(issue(w, "twice-g:beta")).toBeUndefined();
  issue(w, "kept-g:beta")!.fixes[0]!.run(w);
  w = loadWorld();
  expect(w.projects[0]!.skills).toEqual([]);
  expect(w.machine.map((m) => m.name)).toEqual(["beta"]);
});

test("a skill also in a Cursor plugin is reported", () => {
  setHarnesses(["cursor"]);
  writeSkill(join(tmp, ".cursor", "plugins", "cache", "mk", "kit", "1.0", "skills", "notes"));
  writeSkill(join(repo, ".agents", "skills", "notes"));
  const found = issue(loadWorld(), "cursor-plugin:notes")!;
  expect(found.title).toBe("Also in the Cursor plugin kit: Cursor lists both while it's on");
  expect(found.decision).toBe(true);
});

test("a plugin the repo turned off for Claude Code still collides in Cursor: said so, with only the choices that change something", () => {
  setHarnesses(["claude-code", "cursor"]);
  const dir = join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt");
  writeSkill(join(dir, "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "pt@mk": [{ scope: "user", installPath: dir }] } }));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  writeSkill(join(repo, ".claude", "skills", "alpha"));
  const before = issue(loadWorld(), "twice-p:alpha")!;
  expect(before.fixes.map((f) => f.label)).toContain("Turn the plugin off in app only");
  expect(before.fixes.find((f) => f.label.includes("only"))!.preview).toContain("Cursor ignores repo settings, so it still lists both.");

  writeFileSync(join(repo, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "pt@mk": false } }));
  const found = issue(loadWorld(), "twice-p:alpha")!;
  expect(found.title).toBe("Same name as a skill in plugin pt@mk: Claude Code has it off in app, but Cursor ignores repo settings and lists both");
  expect(found.decision).toBe(true);
  expect(found.fixes.map((f) => f.label)).toEqual(["Replace pt with library skills…"]);
});

test("a failed action is a failure, not a message", () => {
  const w = loadWorld();
  expect(w.ops.remove("app", "nope")).toEqual({ message: "nope isn't in app", failed: true });
  expect(w.ops.pluginOffHere("app", "pt@mk")).toEqual({ message: "pt@mk isn't on in app", failed: true });
});

test("repo names stay unique however deep folders clash", () => {
  const names = uniqueNames(["/u/work/acme/app", "/u/home/acme/app", "/u/work/api"]);
  expect([...names.values()]).toEqual(["work/acme/app", "home/acme/app", "api"]);
});

test("a plugin the repo's settings turn on loads only there, and can be turned off there", () => {
  writeSkill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  const synced = join(tmp, ".claude", "plugins", "synced", "b", "sy");
  writeSkill(join(synced, "skills", "beta"));
  writeSkill(join(repo, ".claude", "skills", "alpha"));
  writeSkill(join(repo, ".claude", "skills", "beta"));
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));

  let w = loadWorld();
  expect(w.machine.filter((m) => m.source === "plugin").map((m) => m.where)).toEqual(["sy@synced"]);
  expect(usable(w, "app").filter((u) => u.source === "plugin").map((u) => `${u.where}/${u.name}`)).toEqual(["pt@mk/alpha", "sy@synced/beta"]);

  const fix = issuesOf(w, "app", local(w, "beta")).find((i) => i.id.startsWith("twice-p"))!.fixes.find((f) => f.label.includes("only"))!;
  expect(fix.label).toBe("Turn the plugin off in app only");
  fix.run(w);
  expect(JSON.parse(readFileSync(join(repo, ".claude", "settings.local.json"), "utf-8"))).toEqual({ enabledPlugins: { "sy@synced": false } });
  w = loadWorld();
  expect(usable(w, "app").filter((u) => u.source === "plugin").map((u) => u.where)).toEqual(["pt@mk"]);
});

test("installing the skilllib skill over a folder that isn't skilllib's fails, and says where", () => {
  setHarnesses(["claude-code"]);
  writeFileSync(join(mkdirSync(join(tmp, ".claude", "skills", "skilllib"), { recursive: true })!, "SKILL.md"), "mine\n");
  const r = loadWorld().ops.installAgentSkill();
  expect(r).toEqual(failed("skilllib skill: ~/.claude/skills/skilllib already exists and isn't skilllib's"));
});
