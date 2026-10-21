import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "../config.js";
import { addSkill, importSkill, isLink, listBackups } from "../library.js";
import { rememberProjects } from "../project.js";
import { recordOrigin } from "../sources.js";
import { forgetLatest } from "../versions.js";
import { loadWorld, uniqueNames } from "./load.js";
import { reviewPrompt } from "./prompts.js";
import { usableHere } from "../here.js";
import { deleteLibraryFix, failed, followUp, issueOf, issuesAt, machineActions, pinFix, pluginIssues, replacePluginFix, repoIssues, said, unlisted, usable, type World } from "./world.js";

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
/** Doctor's issue on a skill's row in app, as the app shows it. */
const issue = (w: World, id: string, name: string) => issuesAt(w, "app", name).find((i) => i.id === id);
/** The same in Global. */
const globalIssue = (w: World, id: string, name: string) => issuesAt(w, null, name).find((i) => i.id === id);
const pick = (i: ReturnType<typeof issue>, label: string) => i!.fixes.find((f) => f.label === label)!;

test("a skill only in the repo gets imported and tracked", () => {
  writeSkill(join(repo, ".claude", "skills", "notes"));
  let w = loadWorld();
  expect(w.cwd).toBe("app");
  expect(local(w, "notes").local!.source).toBe("untracked");
  expect(said(pick(issue(w, `local:${repo}:notes`, "notes"), "Import into the library").run(w))).toBe("notes imported and tracked in app");
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
  // On the repo's row and on Global's.
  expect(globalIssue(w, "twice:alpha", "alpha")).toBeDefined();
  pick(issue(w, "twice:alpha", "alpha"), "Stop loading it globally").run(w);
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
  expect(globalIssue(w, "review:global", "beta")!.short).toBe("Not reviewed");
  machineActions(beta()).find((f) => f.label === "Keep it global on purpose")!.run(w);
  w = loadWorld();
  expect(beta().kept).toBe(true);
  expect(issuesAt(w, null, "beta")).toEqual([]);
});

test("a group moved together stays grouped in your library", () => {
  for (const name of ["cf-one", "cf-two"]) writeSkill(join(tmp, ".claude", "skills", name));
  let w = loadWorld();
  expect(w.ops.moveGlobal(w.machine, ["app"], "cloudflare set")).toBe("cf-one, cf-two now load only in app");
  w = loadWorld();
  expect(w.machine).toEqual([]);
  expect(w.library.map((l) => l.origin)).toEqual(["group: cloudflare set", "group: cloudflare set"]);
});

test("moving to a repo that commits Claude Code's folder keeps it global until you allow the link, then finishes", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "skilllib.json"), '{ "skills": {} }\n'); // the team pins with skilllib
  writeSkill(join(repo, ".claude", "skills", "team"));
  writeSkill(join(repo, ".agents", "skills", "other"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  // In ~/.claude/skills: Claude Code runs them now, so it must still see them in app before they stop loading globally.
  for (const name of ["tool-a", "tool-b"]) writeSkill(join(tmp, ".claude", "skills", name));

  let w = loadWorld();
  const r = w.ops.moveGlobal(w.machine.filter((m) => m.name.startsWith("tool-")), ["app"], "tools");
  if (typeof r === "string" || !("then" in r)) throw new Error(`expected a follow-up: ${typeof r === "string" ? r : r.message}`);
  expect(r.message).toStartWith("tool-a: added, but Claude Code in app couldn't see it (git tracks .claude/skills: allow links there, then move it again), so it still loads globally");
  expect(r.then.label).toBe("Also link them in .claude/skills, then stop loading them globally");
  for (const name of ["tool-a", "tool-b"]) expect(existsSync(join(tmp, ".claude", "skills", name, "SKILL.md"))).toBe(true);

  w = loadWorld();
  expect(r.then.run(w)).toBe("Linked 2 skills in .claude/skills in app; tool-a, tool-b now load only in app");
  for (const name of ["tool-a", "tool-b"]) {
    expect(isLink(join(repo, ".claude", "skills", name))).toBe(true);
    expect(existsSync(join(tmp, ".claude", "skills", name))).toBe(false);
  }

  // Remembered for this repo: the next one links without asking.
  writeSkill(join(tmp, ".claude", "skills", "tool-c"));
  w = loadWorld();
  expect(w.ops.moveGlobal(w.machine.filter((m) => m.name === "tool-c"), ["app"])).toBe("tool-c now loads only in app");
  expect(isLink(join(repo, ".claude", "skills", "tool-c"))).toBe(true);
});

test("moving to a repo where a link would break for teammates keeps it global, saying why, and offers no link", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "skilllib.json"), '{ "skills": {} }\n'); // the team pins with skilllib
  writeSkill(join(repo, ".claude", "skills", "team"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "tool-a"));

  const w = loadWorld();
  const r = w.ops.moveGlobal(w.machine.filter((m) => m.name === "tool-a"), ["app"]);
  expect(r).toMatchObject({ failed: true });
  expect(said(r)).toContain("git tracks .claude/skills but not the skill's copy: commit it");
  expect(existsSync(join(tmp, ".claude", "skills", "tool-a", "SKILL.md"))).toBe(true);
});

test("adding library skills to a repo that commits Claude Code's folder asks once, for all of them, and remembers it", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "skilllib.json"), '{ "skills": {} }\n'); // the team pins with skilllib
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
  writeFileSync(join(repo, "skilllib.json"), '{ "skills": {} }\n'); // the team pins with skilllib
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
  writeFileSync(join(repo, "skilllib.json"), '{ "skills": {} }\n'); // the team pins with skilllib
  writeSkill(join(repo, ".claude", "skills", "team"));
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeSkill(join(repo, ".cursor", "skills", "mine"));
  setHarnesses(["claude-code", "cursor"]);

  // Health doesn't offer the link: it says to commit first.
  const blind = issue(loadWorld(), `uncommitted:${repo}:mine`, "mine")!;
  expect(blind.short).toBe("Commit it first");
  expect(blind.decision).toBe(true);
  expect(blind.fixes).toEqual([]);
  expect(isLink(join(repo, ".claude", "skills", "mine"))).toBe(false);

  // Committed, linking it is offered (git will see the link).
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "mine");
  const after = loadWorld();
  expect(issue(after, `uncommitted:${repo}:mine`, "mine")).toBeUndefined();
  expect(issue(after, `usable:${repo}`, "mine")!.fixes.map((f) => f.label)).toEqual(["Add links everywhere"]);
});

test("a skill pinned in skilllib.json that your library doesn't have: no restore, no library actions, only removing the pin", () => {
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { "ghost-skill": { version: 1, hash: "abc" } } }));
  let w = loadWorld();
  expect(local(w, "ghost-skill").local!).toMatchObject({ missing: true });
  expect(issuesAt(w, "app", "ghost-skill").map((i) => i.id)).toEqual([`unavailable:${repo}:ghost-skill`]);
  const pinned = issue(w, `unavailable:${repo}:ghost-skill`, "ghost-skill")!;
  expect(pinned.detail).toContain("import it, or set SKILLLIB_HOME");
  expect(pinned.decision).toBe(true);
  expect(pinned.fixes.map((f) => f.label)).toEqual(["Remove it from skilllib.json"]);
  expect(said(pinned.fixes[0]!.run(w))).toBe("ghost-skill: removed from app's skilllib.json");
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
  expect(fix.preview).toContain("Removes it from app.");
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
  writeFileSync(join(plugin, "commands", "check.md"), "Check the code.\n");
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "tools@mk": true } }));
  writeFileSync(join(tmp, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "tools@mk": [{ scope: "user", installPath: plugin, version: "1.0.0" }] } }));
}

/** A `claude` command that records what it was asked, or no `claude` at all. It's a shell script, so the tests that run it skip Windows. */
function withClaude<T>(installed: boolean, body: () => T): T {
  const path = process.env.PATH;
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  if (installed) writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1" = --version ] && echo "2.1 (Claude Code)" && exit 0\necho "$@" > "${tmp}/claude-args"\n`, { mode: 0o755 });
  process.env.PATH = bin;
  try {
    return body();
  } finally {
    process.env.PATH = path;
  }
}

test.skipIf(process.platform === "win32")("a plugin is replaced by library skills, then uninstalled", () => {
  fakePlugin();
  let w = loadWorld();
  expect(w.machine.map((m) => `${m.name}:${m.source}`).sort()).toEqual(["fmt:plugin", "lint:plugin"]);
  const fix = replacePluginFix(w.plugins.find((p) => p.id === "tools@mk")!);
  expect(fix.preview).toContain("then uninstalls tools@mk (its saved data is kept)");
  expect(fix.preview).toContain("It also brings commands: those go too.");
  withClaude(true, () => expect(fix.pickRepos!(w, ["app"])).toBe("2 skills from tools@mk are in your library and in app; tools@mk is uninstalled (Settings › Backups reinstalls it)"));
  expect(loadWorld().backups[0]).toMatchObject({ name: "tools@mk", from: "tools@mk" });
  expect(readFileSync(join(tmp, "claude-args"), "utf-8").trim()).toBe("plugin uninstall tools@mk --keep-data --scope user");
  w = loadWorld();
  expect(w.library.map((l) => `${l.name}:${l.origin}`).sort()).toEqual(["fmt:plugin: tools@mk", "lint:plugin: tools@mk"]);
  expect(w.projects[0]!.skills.map((s) => s.name).sort()).toEqual(["fmt", "lint"]);
});

test("replacing a plugin keeps the origin of a skill you already had", () => {
  fakePlugin();
  writeSkill(join(tmp, "src", "fmt"));
  importSkill(join(tmp, "src", "fmt"));
  recordOrigin("fmt", "skills.sh: me/tools");
  const w = loadWorld();
  withClaude(false, () => replacePluginFix(w.plugins.find((p) => p.id === "tools@mk")!).pickRepos!(w, []));
  expect(loadWorld().library.map((l) => `${l.name}:${l.origin}`).sort()).toEqual(["fmt:skills.sh: me/tools", "lint:plugin: tools@mk"]);
});

test("replacing a plugin whose skill your library has differently changes nothing", () => {
  fakePlugin();
  writeSkill(join(tmp, "src", "lint"), "mine");
  importSkill(join(tmp, "src", "lint"));
  const w = loadWorld();
  const r = withClaude(false, () => replacePluginFix(w.plugins.find((p) => p.id === "tools@mk")!).pickRepos!(w, ["app"]));
  expect(r).toEqual(failed("tools@mk kept: you have different lint (in your library or global skills); keep yours, or update or delete it first"));
  // Nothing copied in before it said no.
  expect(loadWorld().library.map((l) => l.name)).toEqual(["lint"]);
});

test("replacing a plugin whose skill you have differently in your global skills changes nothing: yours wins", () => {
  fakePlugin();
  writeSkill(join(tmp, ".claude", "skills", "lint"), "mine");
  const w = loadWorld();
  const r = withClaude(false, () => replacePluginFix(w.plugins.find((p) => p.id === "tools@mk")!).pickRepos!(w, []));
  expect(r).toEqual(failed("tools@mk kept: you have different lint (in your library or global skills); keep yours, or update or delete it first"));
  expect(loadWorld().library).toEqual([]);
});

test.skipIf(process.platform === "win32")("a plugin only turned on in your settings is turned off by Replace, never sent to `claude plugin`", () => {
  fakePlugin();
  // No install record: Claude Code loads it from its marketplace's copy.
  rmSync(join(tmp, ".claude", "plugins", "installed_plugins.json"));
  const w = loadWorld();
  const p = w.plugins.find((x) => x.id === "tools@mk")!;
  expect(p.settingsOnly).toBe(true);
  expect(replacePluginFix(p).preview).toContain("It isn't installed, only turned on there, so there's nothing to uninstall.");
  withClaude(true, () => expect(replacePluginFix(p).pickRepos!(w, [])).toBe("2 skills from tools@mk are in your library; tools@mk is off (it was only turned on in your settings, so there's nothing to uninstall)"));
  expect(existsSync(join(tmp, "claude-args"))).toBe(false);
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "tools@mk": false });
});

test.skipIf(process.platform === "win32")("when uninstalling fails, Replace turns the plugin off and says why", () => {
  fakePlugin();
  const w = loadWorld();
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1" = --version ] && echo "2.1 (Claude Code)" && exit 0\n[ "$2" = uninstall ] && echo "plugin is busy" >&2 && exit 1\nexit 0\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = bin;
  try {
    expect(replacePluginFix(w.plugins.find((x) => x.id === "tools@mk")!).pickRepos!(w, [])).toContain("tools@mk is off (uninstalling failed: plugin is busy");
  } finally {
    process.env.PATH = path;
  }
});

test("without the claude command, a replaced plugin is at least turned off", () => {
  fakePlugin();
  const w = loadWorld();
  withClaude(false, () => expect(replacePluginFix(w.plugins.find((p) => p.id === "tools@mk")!).pickRepos!(w, [])).toContain("tools@mk is off (the claude command isn't on your PATH): finish with /plugin uninstall tools@mk"));
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "tools@mk": false });
  expect(loadWorld().machine).toEqual([]);
});

test("a plugin synced from claude.ai is copied in and turned off (it can't be uninstalled)", () => {
  writeSkill(join(tmp, ".claude", "plugins", "synced", "b1", "rail", "skills", "deploy"));
  let w = loadWorld();
  const id = w.machine.find((m) => m.name === "deploy")!.where;
  expect(id).toBe("rail@synced");
  const fix = replacePluginFix(w.plugins.find((p) => p.id === id)!);
  expect(fix.preview).toContain("then turns rail@synced off in Claude Code. It's synced from your claude.ai account");
  // Without the claude command: the same setting `claude plugin disable` writes.
  withClaude(false, () => expect(fix.pickRepos!(w, [])).toContain("rail@synced is off (it's synced from claude.ai: remove it there to delete it for good)"));
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "rail@synced": false });
  w = loadWorld();
  expect(w.library.map((l) => l.name)).toEqual(["deploy"]);
  expect(w.machine).toEqual([]);
});

test.skipIf(process.platform === "win32")("with the claude command, a synced plugin is turned off in your settings, not uninstalled", () => {
  writeSkill(join(tmp, ".claude", "plugins", "synced", "b1", "rail", "skills", "deploy"));
  const w = loadWorld();
  withClaude(true, () => expect(replacePluginFix(w.plugins.find((p) => p.id === "rail@synced")!).pickRepos!(w, [])).toBe("1 skill from rail@synced is in your library; rail@synced is off (it's synced from claude.ai: remove it there to delete it for good)"));
  // `claude plugin` can't touch a synced plugin: its switch is enabledPlugins.
  expect(existsSync(join(tmp, "claude-args"))).toBe(false);
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "rail@synced": false });
});

test("identical copies in a repo become one copy plus a link", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".claude", "skills", "notes"));
  writeSkill(join(repo, ".agents", "skills", "notes"));
  let w = loadWorld();
  const copies = issue(w, `tidy:${repo}`, "notes")!;
  expect(copies.decision).toBe(false);
  expect(copies.fixes[0]!.run(w)).toBe("app: tidied 1 skill");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, `tidy:${repo}`, "notes")).toBeUndefined();
  expect(w.backups.map((b) => b.name)).toEqual(["notes"]);
});

test("differing copies in a repo: which agent runs which, and you pick the one to keep", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".claude", "skills", "notes"), "mine");
  writeSkill(join(repo, ".agents", "skills", "notes"), "theirs");
  let w = loadWorld();
  const conflict = issue(w, `conflict:${repo}:notes`, "notes")!;
  expect(conflict.title).toBe("notes in app: the copies differ");
  expect(conflict.detail).toStartWith("Your agents run different versions: .claude/skills (Claude Code) vs .agents/skills (Codex).");
  expect(conflict.decision).toBe(true);
  // Which copy the library comparison looked at is arbitrary: only the conflict shows.
  expect(issue(w, `local:${repo}:notes`, "notes")).toBeUndefined();
  pick(conflict, "Keep the .agents/skills copy").run(w);
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  expect(readFileSync(join(repo, ".claude", "skills", "notes", "SKILL.md"), "utf-8")).toContain("theirs");
  w = loadWorld();
  expect(issue(w, `conflict:${repo}:notes`, "notes")).toBeUndefined();
});

test("removing a skill whose copies differ removes one, lists both, and says which stays", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".claude", "skills", "notes"), "mine");
  writeSkill(join(repo, ".agents", "skills", "notes"), "theirs");
  const w = loadWorld();
  const s = local(w, "notes").local!;
  expect([s.dir, s.others]).toEqual([".claude/skills", [".agents/skills"]]);
  expect(w.ops.remove("app", "notes")).toBe("Removed .claude/skills/notes from app (in Settings › Backups); the copy in .agents/skills stays");
  expect(existsSync(join(repo, ".claude", "skills", "notes"))).toBe(false);
  expect(readFileSync(join(repo, ".agents", "skills", "notes", "SKILL.md"), "utf-8")).toContain("theirs");
});

test("a broken link with no copy in the repo gets a row of its own, with its fix", () => {
  mkdirSync(join(repo, ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, "gone"), join(repo, ".claude", "skills", "old"));
  let w = loadWorld();
  expect(unlisted(w, "app")).toEqual(["old"]);
  pick(issue(w, `broken:${repo}:.claude/skills/old`, "old"), "Remove the link").run(w);
  w = loadWorld();
  expect(unlisted(w, "app")).toEqual([]);
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
  let w = loadWorld();
  const tidy = issue(w, `tidy:${repo}`, "notes")!;
  // What git would see makes it your call, and with every step one git would see, "keep git as it is"
  // would do nothing: one choice, no ★ fix.
  expect(tidy.decision).toBe(true);
  expect(tidy.fixes.map((f) => f.label)).toEqual(["Tidy everything"]);
  expect(tidy.fixes[0]!.preview).toStartWith("1 change will show in git status. notes: .claude/skills/notes: duplicate copy → link. Git would see");
  const links = () => [".claude", ".agents"].filter((d) => isLink(join(repo, d, "skills", "notes")));
  expect(links()).toEqual([]);
  pick(issue(w, `tidy:${repo}`, "notes"), "Tidy everything").run(w);
  expect(links()).toEqual([".claude"]);
});

test("identical global copies become one copy plus a link", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "beta"));
  writeSkill(join(tmp, ".agents", "skills", "beta"));
  let w = loadWorld();
  globalIssue(w, "tidy:global", "beta")!.fixes[0]!.run(w);
  expect(isLink(join(tmp, ".claude", "skills", "beta"))).toBe(true);
  w = loadWorld();
  expect(issuesAt(w, null, "beta").map((i) => i.id)).toEqual(["review:global"]);
});

test("an agent that can't see a repo's skill is reported, and a link fixes it", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(repo, ".agents", "skills", "notes"));
  let w = loadWorld();
  expect(local(w, "notes").agents).toEqual(["codex"]);
  const blind = issue(w, `usable:${repo}`, "notes")!;
  expect(blind.title).toBe("app: 1 skill not usable by Claude Code");
  expect(blind.decision).toBe(false);
  expect(blind.fixes[0]!.run(w)).toBe("app: linked 1 skill for Claude Code");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, `usable:${repo}`, "notes")).toBeUndefined();
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
  // Git tracks the only folder a link would go in: your call, and the choice says git will see it.
  const blind = issue(w, `usable:${repo}`, "notes")!;
  expect(blind.decision).toBe(true);
  expect(blind.fixes.map((f) => f.label)).toEqual(["Add links everywhere"]);
  expect(blind.fixes[0]!.preview).toStartWith("Remembered for app; git will see them.");
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(false);
  blind.fixes[0]!.run(w);
  expect(isLink(join(repo, ".claude", "skills", "notes"))).toBe(true);
  w = loadWorld();
  expect(issue(w, `usable:${repo}`, "notes")).toBeUndefined();
}, 20_000); // several git commands: slow on Windows CI

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
  // The plugin goes, or is turned off here; removing the team's copy is never offered.
  expect(issue(w, "plugin:tools@mk", "lint")!.fixes.map((f) => f.label)).toEqual(["Turn the plugin tools@mk off", "Remove the plugin tools@mk", "Turn the plugin tools@mk off in app only"]);
  // Copying it into your library leaves the repo's copy as it is.
  expect(issue(w, `local:${repo}:lint`, "lint")!.fixes.map((f) => f.label)).toEqual(["Copy into the library"]);
  expect(w.ops.remove("app", "lint")).toEqual({ message: "lint is the repo's own (committed by your team): skilllib doesn't delete it", failed: true });
  expect(existsSync(join(repo, ".claude", "skills", "lint", "SKILL.md"))).toBe(true);
  // Only on this machine: removable, and backed up.
  expect(w.ops.remove("app", "scratch")).toBe("Removed scratch from app (in Settings › Backups)");
});

test.skipIf(process.platform === "win32")("through a .claude/skills that links to .agents/skills, a committed skill is the team's and one copy, not two", () => {
  setHarnesses(["claude-code", "codex"]);
  rmSync(join(repo, ".git"), { recursive: true });
  writeSkill(join(repo, ".agents", "skills", "team-a"));
  mkdirSync(join(repo, ".claude"));
  symlinkSync("../.agents/skills", join(repo, ".claude", "skills"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "team");
  writeSkill(join(repo, ".agents", "skills", "scratch"));
  const w = loadWorld();
  expect(local(w, "team-a").local).toMatchObject({ source: "repo", git: "committed" });
  expect(local(w, "team-a").local!.others).toBeUndefined();
  expect(issue(w, `local:${repo}:team-a`, "team-a")!.fixes.map((f) => f.label)).toEqual(["Copy into the library"]);
  expect(usableHere(repo).skills.find((g) => g.skills.includes("team-a"))).toMatchObject({ source: "repo", git: "committed" });
  expect(w.ops.remove("app", "team-a")).toEqual({ message: "team-a is the repo's own (committed by your team): skilllib doesn't delete it", failed: true });
  expect(existsSync(join(repo, ".agents", "skills", "team-a", "SKILL.md"))).toBe(true);
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

test("a plugin only this repo's settings turn on is reviewed as the repo loads it", () => {
  writeSkill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "here", "skills", "beta"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "here@mk": true } }));
  const w = loadWorld();
  expect(w.machine.some((m) => m.name === "beta")).toBe(false);
  const prompt = reviewPrompt(w, ["beta"], "Review the skill beta in app.", "app");
  expect(prompt).toContain("- Source: vendor: plugin (here@mk)");
  expect(prompt).toContain("— in app");
  expect(prompt).not.toContain("a repo's own skill");
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
  const install = w.issues.map(issueOf).find((i) => i.id === "agent-skill")!;
  expect(install.decision).toBe(true);
  expect(install.fixes[0]!.run(w)).toBe("Your agents can now use skilllib (2 folders)");
  w = loadWorld();
  expect(w.agentSkill).toBe("installed");
  // It's skilllib's own: no issue, and not a global skill to review.
  expect(w.machine.filter((m) => m.name === "skilllib").length).toBeGreaterThan(0);
  expect(w.machine.filter((m) => m.name === "skilllib" && m.source === "global")).toEqual([]);
  expect(issuesAt(w, null, "skilllib")).toEqual([]);
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
  expect(issuesAt(w, null, "skilllib").flatMap((i) => i.fixes.map((f) => f.label))).toEqual(["Update the skilllib skill"]);

  expect(said(machineActions(own())[0]!.run(w))).toBe("Removed the skilllib skill (~/.claude/skills/skilllib, ~/.agents/skills/skilllib)");
  w = loadWorld();
  expect(w.agentSkill).toBe("missing");
  expect(w.machine.some((m) => m.name === "skilllib")).toBe(false);
});

test("a repo copy of a skill you keep global is the extra one", () => {
  writeSkill(join(tmp, "src", "beta"));
  importSkill(join(tmp, "src", "beta"));
  writeSkill(join(tmp, ".claude", "skills", "beta"));
  let w = loadWorld();
  w.ops.add("app", "beta");
  w.ops.keepGlobal("beta", true);
  w = loadWorld();
  const twice = issue(w, "twice:beta", "beta")!;
  expect(twice.title).toBe("beta: in app, and you keep it global");
  pick(twice, "Remove the copies in app").run(w);
  w = loadWorld();
  expect(w.projects[0]!.skills).toEqual([]);
  expect(w.machine.map((m) => m.name)).toEqual(["beta"]);
});

test("a skill also in a Cursor plugin is reported", () => {
  setHarnesses(["cursor"]);
  writeSkill(join(tmp, ".cursor", "plugins", "cache", "mk", "kit", "1.0", "skills", "notes"));
  writeSkill(join(repo, ".agents", "skills", "notes"));
  const w = loadWorld();
  const found = issue(w, "cursor-plugin:kit", "notes")!;
  expect(found.title).toBe("notes: also in the Cursor plugin kit");
  expect(found.decision).toBe(true);
  // On the Cursor plugin's row too.
  expect(pluginIssues(w, w.plugins.find((p) => p.id === "kit@mk")!).map((i) => i.id)).toEqual(["cursor-plugin:kit"]);
});

test("a plugin the repo turned off for Claude Code still collides in Cursor: said so, with only the choices that change something", () => {
  setHarnesses(["claude-code", "cursor"]);
  const dir = join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt");
  writeSkill(join(dir, "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "pt@mk": [{ scope: "user", installPath: dir }] } }));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  writeSkill(join(repo, ".claude", "skills", "alpha"));
  expect(issue(loadWorld(), "plugin:pt@mk", "alpha")!.fixes.map((f) => f.label)).toContain("Turn the plugin pt@mk off in app only");

  writeFileSync(join(repo, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "pt@mk": false } }));
  const found = issue(loadWorld(), "plugin:pt@mk", "alpha")!;
  expect(found.detail).toContain("app turns it off for Claude Code, but Cursor ignores repo settings and lists both there");
  expect(found.decision).toBe(true);
  expect(found.fixes.map((f) => f.label)).toEqual(["Remove the plugin pt@mk", "Turn the plugin pt@mk off"]);
});

test("a failed action is a failure, not a message", () => {
  const w = loadWorld();
  expect(w.ops.remove("app", "nope")).toEqual({ message: "nope isn't in app", failed: true });
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

  pick(issue(w, "plugin:sy@synced", "beta"), "Turn the plugin sy@synced off in app only").run(w);
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

test("opening the app in a repo remembers it, so it's still listed when opened from elsewhere", () => {
  const other = join(tmp, "other");
  mkdirSync(join(other, ".git"), { recursive: true });
  process.chdir(other);
  expect(loadWorld().projects.map((p) => p.name)).toContain("other");
  process.chdir(tmp);
  expect(loadWorld().projects.map((p) => p.name)).toContain("other");
});

test("Delete from your library goes through every repo, even one whose pin sits behind a folder outside it", () => {
  writeSkill(join(tmp, "src", "foo"));
  importSkill(join(tmp, "src", "foo"));
  const b = join(tmp, "b");
  mkdirSync(join(b, ".git"), { recursive: true });
  rememberProjects([b]);
  addSkill(repo, "foo");
  addSkill(b, "foo");
  mkdirSync(join(tmp, "ext"));
  execFileSync("mv", [join(b, ".claude"), join(tmp, "ext", "claude")]);
  symlinkSync(join(tmp, "ext", "claude"), join(b, ".claude"));
  const w = loadWorld();
  expect(said(w.ops.deleteLibrary("foo"))).toStartWith("Deleted foo from your library and from app, b");
  expect(existsSync(join(repo, ".claude", "skills", "foo"))).toBe(false);
  expect(existsSync(join(tmp, "ext", "claude", "skills", "foo", "SKILL.md"))).toBe(true); // outside b: untouched
});

test("removing a pin from another library whose copy differs offers Remove it anyway", () => {
  writeSkill(join(tmp, "src", "foo"));
  importSkill(join(tmp, "src", "foo"));
  addSkill(repo, "foo");
  writeSkill(join(repo, ".claude", "skills", "foo"), "edited");
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: { foo: { version: 1, hash: "deadbeefdeadbeef" } } }));
  const r = loadWorld().ops.remove("app", "foo");
  expect(typeof r !== "string" && "then" in r).toBe(true);
});

test("a global move another repo blocks names that repo; Delete from your library leaves a file of yours and refuses a conflicted skilllib.json", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "g1"));
  const other = join(tmp, "other");
  writeSkill(join(other, ".agents", "skills", "g1")); // Claude Code there runs the global copy
  mkdirSync(join(other, ".git"));
  rememberProjects([other]);
  let w = loadWorld();
  expect(said(w.ops.moveGlobal(w.machine.filter((m) => m.name === "g1"), ["app"]))).toContain("Claude Code in other only sees the global copy");

  writeSkill(join(tmp, "src", "foo"));
  importSkill(join(tmp, "src", "foo"));
  addSkill(repo, "foo");
  rmSync(join(repo, ".agents", "skills", "foo"), { recursive: true });
  writeFileSync(join(repo, ".agents", "skills", "foo"), "mine");
  writeFileSync(join(other, "skilllib.json"), '<<<<<<< HEAD\n{"skills": {"foo": {"version": 1, "hash": "x"}}}\n');
  w = loadWorld();
  expect(w.ops.deleteLibrary("foo")).toMatchObject({ failed: true });
  expect(said(w.ops.deleteLibrary("foo"))).toContain("skilllib.json can't be read"); // not "hidden"
  writeFileSync(join(other, "skilllib.json"), "{}\n");
  w = loadWorld();
  expect(said(w.ops.deleteLibrary("foo"))).toStartWith("Deleted foo from your library and from app");
  expect(readFileSync(join(repo, ".agents", "skills", "foo"), "utf-8")).toBe("mine");
  expect(isLink(join(repo, ".claude", "skills", "foo"))).toBe(true);
});

test("a repo whose skills folder is a file is marked in Places, not only in Health", () => {
  rmSync(join(repo, ".claude"), { recursive: true, force: true });
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude", "skills"), "x");
  const w = loadWorld();
  expect(repoIssues(w, "app").map((i) => i.title)).toContain("app: .claude/skills isn't a folder");
  expect(unlisted(w, "app")).toEqual([]);
});

test("Delete it on a global skill waits for repos whose agents only reach it globally", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, ".claude", "skills", "g1"));
  const other = join(tmp, "other");
  writeSkill(join(other, ".agents", "skills", "g1")); // Claude Code there runs the global copy
  mkdirSync(join(other, ".git"));
  rememberProjects([other]);
  let w = loadWorld();
  const r = w.ops.deleteGlobal(w.machine.find((m) => m.name === "g1")!);
  expect(said(r)).toStartWith("g1 kept: Claude Code in other only sees the global copy");
  expect(existsSync(join(tmp, ".claude", "skills", "g1", "SKILL.md"))).toBe(true);
  // Once other has its own copy for Claude Code, it goes.
  writeSkill(join(other, ".claude", "skills", "g1"));
  w = loadWorld();
  expect(said(w.ops.deleteGlobal(w.machine.find((m) => m.name === "g1")!))).toBe("Deleted ~/.claude/skills/g1 (in Settings › Backups)");
});

test("Delete it on a global copy that another global link goes through takes that link along, and counts its agents", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, "dev", "foo"));
  mkdirSync(join(tmp, ".agents", "skills"), { recursive: true });
  symlinkSync(join(tmp, "dev", "foo"), join(tmp, ".agents", "skills", "foo"));
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, ".agents", "skills", "foo"), join(tmp, ".claude", "skills", "foo")); // a link to the link
  const other = join(tmp, "other");
  writeSkill(join(other, ".agents", "skills", "foo")); // Codex has its own; Claude Code runs the global one
  mkdirSync(join(other, ".git"));
  rememberProjects([other]);
  const w = loadWorld();
  const agentsEntry = w.machine.find((m) => m.name === "foo" && m.path.includes(".agents"))!;
  expect(said(w.ops.deleteGlobal(agentsEntry))).toContain("Claude Code in other only sees the global copy");
  expect(isLink(join(tmp, ".claude", "skills", "foo"))).toBe(true);
});

test("a repo whose skills folder links to a shared folder of yours holds what's in it: a move waits for it", () => {
  setHarnesses(["claude-code"]);
  writeSkill(join(tmp, ".claude", "skills", "g1"));
  mkdirSync(join(tmp, "devskills"));
  symlinkSync(join(tmp, ".claude", "skills", "g1"), join(tmp, "devskills", "g1"));
  const r1 = join(tmp, "r1");
  mkdirSync(join(r1, ".claude"), { recursive: true });
  mkdirSync(join(r1, ".git"));
  symlinkSync(join(tmp, "devskills"), join(r1, ".claude", "skills"));
  rememberProjects([r1]);
  const w = loadWorld();
  expect(said(w.ops.moveGlobal(w.machine.filter((m) => m.name === "g1"), ["app"]))).toContain("Claude Code in r1 only sees the global copy");
  expect(existsSync(join(tmp, ".claude", "skills", "g1", "SKILL.md"))).toBe(true);
});

test("moving one global row moves every global copy of that skill, and waits for agents any of them serves", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, "dev", "foo"));
  mkdirSync(join(tmp, ".agents", "skills"), { recursive: true });
  symlinkSync(join(tmp, "dev", "foo"), join(tmp, ".agents", "skills", "foo"));
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, ".agents", "skills", "foo"), join(tmp, ".claude", "skills", "foo")); // a link to the link
  const other = join(tmp, "other");
  writeSkill(join(other, ".agents", "skills", "foo")); // Codex has its own; Claude Code runs the global one
  mkdirSync(join(other, ".git"));
  rememberProjects([other]);
  let w = loadWorld();
  const agentsRow = w.machine.find((m) => m.name === "foo" && m.path.includes(".agents"))!;
  expect(said(w.ops.moveGlobal([agentsRow], ["app"]))).toContain("Claude Code in other only sees the global copy");
  expect(isLink(join(tmp, ".claude", "skills", "foo"))).toBe(true);
  expect(existsSync(join(tmp, ".claude", "skills", "foo", "SKILL.md"))).toBe(true);

  // Two identical real copies: moving one row moves both, so "now loads only in app" is true.
  rmSync(other, { recursive: true });
  rmSync(join(tmp, ".claude", "skills", "foo"));
  rmSync(join(tmp, ".agents", "skills", "foo"));
  writeSkill(join(tmp, ".claude", "skills", "foo"));
  writeSkill(join(tmp, ".agents", "skills", "foo"));
  w = loadWorld();
  expect(said(w.ops.moveGlobal([w.machine.find((m) => m.name === "foo" && m.path.includes(".agents"))!], ["app"]))).toBe("foo now loads only in app");
  expect(existsSync(join(tmp, ".claude", "skills", "foo"))).toBe(false);
  expect(existsSync(join(tmp, ".agents", "skills", "foo"))).toBe(false);
});

test("deleting a group where one copy links through another: the second says it was already taken along", () => {
  setHarnesses(["claude-code", "codex"]);
  writeSkill(join(tmp, "dev", "foo"));
  mkdirSync(join(tmp, ".agents", "skills"), { recursive: true });
  symlinkSync(join(tmp, "dev", "foo"), join(tmp, ".agents", "skills", "foo"));
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
  symlinkSync(join(tmp, ".agents", "skills", "foo"), join(tmp, ".claude", "skills", "foo"));
  const w = loadWorld();
  const rows = w.machine.filter((m) => m.name === "foo").sort((a) => (a.path.includes(".agents") ? -1 : 1));
  expect(said(w.ops.deleteGlobal(rows[0]!))).toStartWith("Deleted ~/.agents/skills/foo");
  expect(said(w.ops.deleteGlobal(rows[1]!))).toBe("~/.claude/skills/foo is already gone");
});

test("the app's unused hint counts a plugin's copy (plugin:skill) for the skill, as doctor does", () => {
  writeSkill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  addSkill(repo, "alpha");
  const w = loadWorld();
  // Added long enough ago to count.
  setSystemTime(new Date(Date.now() + 40 * 86_400_000));
  try {
    const unused = (usage: World["usage"]) => w.ops.usageIssues({ usage, totals: {} }).filter((i) => i.id === `unused:${repo}`);
    expect(unused({})).toHaveLength(1);
    expect(unused({ app: { "tools:alpha": 2 } })).toEqual([]);
  } finally {
    setSystemTime();
  }
});


test("moving a pin is offered only where it can succeed: never to make the team's committed copy personal", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: {} }, null, 2) + "\n");
  for (const name of ["team", "mine"]) {
    writeSkill(join(tmp, "src", name));
    importSkill(join(tmp, "src", name));
    addSkill(repo, name);
  }
  git("add", "skilllib.json", ".claude/skills/team");
  git("commit", "-qm", "team");

  let w = loadWorld();
  expect(pinFix(w, "app", local(w, "team").local!)).toBeNull();
  const fix = pinFix(w, "app", local(w, "mine").local!)!;
  expect(fix.label).toBe("Make it personal");
  expect(fix.preview).toContain("teammates no longer get it");
  expect(said(fix.run(w))).toBe("mine is now personal in app: only on your machines, kept out of git");
  w = loadWorld();
  expect(local(w, "mine").local!.personal).toBe(true);
  expect(pinFix(w, "app", local(w, "mine").local!)!.label).toBe("Pin it for the team");
});

test("a pinned skill whose link git has isn't offered as personal, even with its copy out of git", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  setHarnesses(["claude-code", "codex"]);
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: {} }, null, 2) + "\n");
  writeSkill(join(tmp, "src", "tool"));
  importSkill(join(tmp, "src", "tool"));
  addSkill(repo, "tool");
  // The copy is in .agents/skills (not committed); only Claude Code's link in .claude/skills is.
  git("add", "skilllib.json", ".claude/skills/tool");
  git("commit", "-qm", "link only");
  const w = loadWorld();
  expect(pinFix(w, "app", local(w, "tool").local!)).toBeNull();
});

test("moving a pin isn't offered for an edited copy, nor where personal pins can't be (a folder git doesn't know)", () => {
  // The fake .git in this repo isn't one git can read: no personal pins here.
  writeFileSync(join(repo, "skilllib.json"), JSON.stringify({ skills: {} }, null, 2) + "\n");
  writeSkill(join(tmp, "src", "tool"));
  importSkill(join(tmp, "src", "tool"));
  addSkill(repo, "tool");
  expect(pinFix(loadWorld(), "app", local(loadWorld(), "tool").local!)).toBeNull();
  // A real repo: offered, until the copy is edited.
  rmSync(join(repo, ".git"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
  expect(pinFix(loadWorld(), "app", local(loadWorld(), "tool").local!)?.label).toBe("Make it personal");
  writeFileSync(join(repo, ".claude", "skills", "tool", "SKILL.md"), "edited\n");
  expect(pinFix(loadWorld(), "app", local(loadWorld(), "tool").local!)).toBeNull();
});

test("Pin it for the team says which link it held back, as Add does", () => {
  rmSync(join(repo, ".git"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  setHarnesses(["claude-code", "codex"]);
  // .claude/skills is a folder git tracks: a new link there is seen by the team.
  mkdirSync(join(repo, ".claude", "skills"), { recursive: true });
  writeFileSync(join(repo, ".claude", "skills", ".keep"), "");
  git("add", ".claude/skills/.keep");
  git("commit", "-qm", "folder");
  writeSkill(join(tmp, "src", "tool"));
  importSkill(join(tmp, "src", "tool"));
  addSkill(repo, "tool"); // personal, no skilllib.json
  const w = loadWorld();
  const fix = pinFix(w, "app", local(w, "tool").local!)!;
  expect(fix.label).toBe("Pin it for the team");
  const r = fix.run(w);
  expect(said(r)).toContain("tool is now pinned in app's skilllib.json for the team, but not linked in .claude/skills");
  expect(said(r)).toContain("Commit .agents/skills/tool, then run skilllib link --allow-tracked");
  expect(said(r)).not.toContain("is already in");
});

