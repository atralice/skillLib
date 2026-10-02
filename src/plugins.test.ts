import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { findIssues, runFix } from "./health.js";
import { addSkill, importSkill } from "./library.js";
import { claudeBinary, forgetClaudeBinary, installedPlugins, pluginBackups, removePlugin, restorePlugin, setPluginOn, turnOffIn, uninstallPlugin, updatePlugin, type ClaudePlugin } from "./plugins.js";
import { machineSkills, skillsLoadedIn } from "./sources.js";

let tmp: string;
const realHome = process.env.HOME;

function skill(dir: string, body = "x") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\ndescription: d\n---\n${body}\n`);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skilllib-plugins-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  setHarnesses(["claude-code"]);
  mkdirSync(join(tmp, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

test("a synced plugin is turned off in settings.json, keeping everything else there, after its skills are saved", () => {
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ model: "opus", enabledPlugins: { "other@mk": true } }));
  skill(join(tmp, "synced", "skills", "use-railway"));
  const plugin: ClaudePlugin = { id: "railway@synced", scope: null, synced: true, skills: [join(tmp, "synced", "skills", "use-railway")], extras: [] };

  expect(removePlugin(plugin, "off")).toMatchObject({ ok: true, message: "railway@synced turned off; use-railway copied into Your skills" });
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8"))).toEqual({
    model: "opus",
    enabledPlugins: { "other@mk": true, "railway@synced": false },
  });
  expect(existsSync(join(tmp, "home", "library", "use-railway", "SKILL.md"))).toBe(true);
});

test("a plugin installed for one project isn't touched from somewhere else", () => {
  skill(join(tmp, "p", "skills", "alpha"));
  const plugin: ClaudePlugin = { id: "p@mk", scope: "project", synced: false, skills: [join(tmp, "p", "skills", "alpha")], extras: [] };
  expect(removePlugin(plugin, "delete")).toMatchObject({ ok: false });
  expect(existsSync(join(tmp, "home", "library", "alpha"))).toBe(false);
});

test("a plugin that repeats a skill only in Your skills is a suggestion that doesn't claim both load", () => {
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));

  const issue = findIssues([], machineSkills(), new Set(["alpha"])).find((i) => i.id === "plugin:pt@mk");
  expect(issue?.severity).toBe("suggestion");
  expect(issue?.detail).not.toContain("loads both");
  expect(issue?.detail).toContain("only in Your skills");
  expect(issue?.choices?.map((c) => c.label)).toEqual(["Remove the plugin pt@mk", "Turn the plugin pt@mk off"]);
});

test("when claude can't run, nothing changes and the fix reports a failure", () => {
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "beta"));
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));

  const path = process.env.PATH;
  process.env.PATH = join(tmp, "empty");
  try {
    const issue = findIssues([], machineSkills(), new Set(["alpha"])).find((i) => i.id === "plugin:pt@mk");
    const r = runFix(issue!.choices![0]!);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("nothing changed");
  } finally {
    process.env.PATH = path;
  }
  expect(existsSync(join(tmp, "home", "library", "beta"))).toBe(false);
});

test.skipIf(process.platform === "win32")("when a broken `claude` wrapper comes first on PATH (cmux), the real one in ~/.local/bin is used", () => {
  const script = (dir: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "claude"), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, "claude"), 0o755);
  };
  script(join(tmp, "shim"), 'echo "Error: claude not found in PATH" >&2; exit 1');
  script(join(tmp, ".local", "bin"), `if [ "$1" = "--version" ]; then echo "2.1.283 (Claude Code)"; else echo "$@" >> "${join(tmp, "calls")}"; fi`);
  skill(join(tmp, "p", "skills", "alpha"));
  const plugin: ClaudePlugin = { id: "pt@mk", scope: "user", synced: false, skills: [join(tmp, "p", "skills", "alpha")], extras: [] };

  const path = process.env.PATH;
  process.env.PATH = `${join(tmp, "shim")}:/usr/bin:/bin`;
  try {
    expect(removePlugin(plugin, "off")).toMatchObject({ ok: true });
  } finally {
    process.env.PATH = path;
  }
  expect(readFileSync(join(tmp, "calls"), "utf-8")).toBe("plugin disable pt@mk --scope user\n");
});

test("a repo's Claude Code settings turn a plugin on or off just there", () => {
  const mk = (name: string, skillName: string) => skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", name, "skills", skillName));
  mk("everywhere", "alpha");
  mk("here", "beta");
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "everywhere@mk": true } }));
  const web = join(tmp, "web");
  const api = join(tmp, "api");
  for (const root of [web, api]) {
    skill(join(root, ".claude", "skills", "alpha"));
    skill(join(root, ".claude", "skills", "beta"));
  }
  mkdirSync(join(web, ".claude"), { recursive: true });
  writeFileSync(join(web, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "here@mk": true } }));
  writeFileSync(join(web, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "everywhere@mk": false } }));

  const machine = machineSkills();
  const plugins = (skills: typeof machine) => skills.filter((s) => s.kind === "plugin").map((s) => `${s.origin}/${s.name}`);
  expect(plugins(machine)).toEqual(["everywhere@mk/alpha"]);
  expect(plugins(skillsLoadedIn(web, machine))).toEqual(["here@mk/beta"]);
  expect(skillsLoadedIn(api, machine)).toBe(machine);

  // api loads both copies of alpha; web turned that plugin off, but loads both copies of beta.
  const issues = findIssues([web, api], machine, new Set()).filter((i) => i.id.startsWith("plugin:"));
  expect(issues.map((i) => [i.id, i.severity])).toEqual([
    ["plugin:everywhere@mk", "problem"],
    [`plugin:${web}:here@mk`, "problem"],
  ]);
  expect(issues[0]?.choices?.map((c) => c.label)).toEqual(["Remove the plugin everywhere@mk", "Turn the plugin everywhere@mk off", "Turn the plugin everywhere@mk off in api only"]);
  // The repo's own copy is the team's: turning the plugin off here is the only choice.
  expect(issues[1]?.choices?.map((c) => c.label)).toEqual(["Turn the plugin here@mk off in web only"]);
});

test.skipIf(process.platform === "win32")("turning a plugin off in one repo runs `claude plugin disable --scope local` there", () => {
  mkdirSync(join(tmp, ".local", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, ".local", "bin", "claude"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.283 (Claude Code)"; else echo "$(pwd -P) $@" >> "${join(tmp, "calls")}"; fi\n`,
  );
  chmodSync(join(tmp, ".local", "bin", "claude"), 0o755);
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  const web = join(tmp, "web");
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  addSkill(web, "alpha");

  const path = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  try {
    const issue = findIssues([web], machineSkills(), new Set(["alpha"])).find((i) => i.id === "plugin:pt@mk");
    expect(issue?.choices?.map((c) => c.label).slice(2)).toEqual(["Turn the plugin pt@mk off in web only", "Remove your alpha from web"]);
    expect(runFix(issue!.choices![2]!)).toEqual({ ok: true, message: "pt@mk turned off in web; other repos keep it" });
  } finally {
    process.env.PATH = path;
  }
  expect(readFileSync(join(tmp, "calls"), "utf-8")).toBe(`${realpathSync(web)} plugin disable pt@mk --scope local\n`);
});

test("a synced plugin is turned off in one repo by its settings.local.json", () => {
  const plugin: ClaudePlugin = { id: "railway@synced", scope: null, synced: true, skills: [], extras: [] };
  const web = join(tmp, "web");
  mkdirSync(join(web, ".claude"), { recursive: true });
  writeFileSync(join(web, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: [] } }));
  expect(turnOffIn(plugin, web)).toMatchObject({ ok: true });
  expect(JSON.parse(readFileSync(join(web, ".claude", "settings.local.json"), "utf-8"))).toEqual({
    permissions: { allow: [] },
    enabledPlugins: { "railway@synced": false },
  });
});

test.skipIf(process.platform === "win32")("without the claude CLI, a plugin is turned off in one repo by writing its settings.local.json, which git then ignores", () => {
  const web = join(tmp, "web");
  mkdirSync(web, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: web });
  skill(join(tmp, "p", "skills", "alpha"));
  const plugin: ClaudePlugin = { id: "pt@mk", scope: "user", synced: false, skills: [join(tmp, "p", "skills", "alpha")], extras: [] };

  const path = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin"; // git, but no claude
  try {
    expect(turnOffIn(plugin, web)).toEqual({ ok: true, message: "pt@mk turned off in web; other repos keep it (in .claude/settings.local.json, which git now ignores via .git/info/exclude)" });
  } finally {
    process.env.PATH = path;
  }
  expect(JSON.parse(readFileSync(join(web, ".claude", "settings.local.json"), "utf-8"))).toEqual({ enabledPlugins: { "pt@mk": false } });
  expect(execFileSync("git", ["status", "--porcelain"], { cwd: web, encoding: "utf-8" })).toBe("");
  // Once is enough.
  expect(turnOffIn({ ...plugin, synced: true, id: "sy@synced" }, web).message).toEndWith("(in .claude/settings.local.json, which git ignores)");
  expect(readFileSync(join(web, ".git", "info", "exclude"), "utf-8").match(/settings\.local\.json/g)).toHaveLength(1);
});

test("with Cursor, a plugin a repo turned off still collides there: Cursor lists both, and only plugin-wide choices are offered", () => {
  setHarnesses(["claude-code", "cursor"]);
  const dir = join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt");
  skill(join(dir, "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "pt@mk": [{ scope: "user", installPath: dir }] } }));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  const web = join(tmp, "web");
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  addSkill(web, "alpha");
  writeFileSync(join(web, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "pt@mk": false } }));

  const issue = findIssues([web], machineSkills(), new Set(["alpha"])).find((i) => i.id === "plugin:pt@mk")!;
  expect(issue.severity).toBe("problem");
  expect(issue.detail).not.toContain("Claude Code loads both");
  expect(issue.detail).toContain("web turns it off for Claude Code, but Cursor ignores repo settings and lists both there");
  expect(issue.choices?.map((c) => c.label)).toEqual(["Remove the plugin pt@mk", "Turn the plugin pt@mk off"]);
});

test("a nested .claude/skills copy of a plugin's skill counts, and is never offered for removal", () => {
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  const mono = join(tmp, "mono");
  skill(join(mono, "packages", "web", ".claude", "skills", "alpha"));

  const issue = findIssues([mono], machineSkills(), new Set()).find((i) => i.id === "plugin:pt@mk");
  expect(issue?.severity).toBe("problem");
  expect(issue?.choices?.map((c) => c.label)).toEqual(["Remove the plugin pt@mk", "Turn the plugin pt@mk off", "Turn the plugin pt@mk off in mono only"]);
});

test("a repo copy Claude Code doesn't load (only in .agents/skills) doesn't collide with a plugin", () => {
  skill(join(tmp, ".claude", "plugins", "marketplaces", "mk", "plugins", "pt", "skills", "alpha"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "pt@mk": true } }));
  const web = join(tmp, "web");
  skill(join(web, ".agents", "skills", "alpha"));
  expect(findIssues([web], machineSkills(), new Set()).find((i) => i.id.startsWith("plugin:"))).toBeUndefined();
});

/** Plugins as Claude Code records them: two installs for you, one in a project, one synced from claude.ai. */
function installs() {
  const plugins = join(tmp, ".claude", "plugins");
  const web = join(tmp, "web");
  const at = (name: string, version: string) => join(plugins, "cache", "mk", name, version);
  skill(join(at("a", "1.0.0"), "skills", "alpha"));
  mkdirSync(join(at("a", "1.0.0"), "hooks"), { recursive: true });
  writeFileSync(join(at("a", "1.0.0"), "hooks", "hooks.json"), "{}");
  skill(join(at("b", "2.0.0"), "skills", "beta"));
  skill(join(at("c", "0.1.0"), "skills", "gamma"));
  writeFileSync(
    join(plugins, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "a@mk": [{ scope: "user", installPath: at("a", "1.0.0"), version: "1.0.0" }],
        "b@mk": [{ scope: "user", installPath: at("b", "2.0.0"), version: "2.0.0", gitCommitSha: "old" }],
        "c@mk": [{ scope: "project", projectPath: web, installPath: at("c", "0.1.0"), version: "0.1.0" }],
      },
    }),
  );
  mkdirSync(join(plugins, "marketplaces", "mk", ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(plugins, "marketplaces", "mk", ".claude-plugin", "marketplace.json"),
    JSON.stringify({ plugins: [{ name: "a", version: "1.10.0", source: "./a" }, { name: "b", source: { source: "url", sha: "new" } }, { name: "c", source: "./c" }] }),
  );
  const synced = join(plugins, "synced", "bucket", "uuid");
  skill(join(synced, "skills", "deploy"));
  mkdirSync(join(synced, ".claude-plugin"), { recursive: true });
  writeFileSync(join(synced, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "rail", description: "Railway" }));
  // "gone@mk": false is what an uninstall can leave behind: not a plugin to list.
  skill(join(plugins, "marketplaces", "mk", "plugins", "gone", "skills", "old"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "a@mk": true, "b@mk": false, "rail@synced": false, "gone@mk": false } }));
  mkdirSync(join(web, ".claude"), { recursive: true });
  writeFileSync(join(web, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "c@mk": true } }));
  return web;
}

/** A `claude` in ~/.local/bin that logs where it ran and what it was asked; `fail` makes one subcommand fail. */
function fakeClaude(fail = "") {
  const bin = join(tmp, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.284 (Claude Code)"; exit 0; fi\necho "$(pwd -P) $@" >> "${join(tmp, "calls")}"\n${fail ? `[ "$2" = "${fail}" ] && echo "Run it in a terminal to confirm the marketplace command" >&2 && exit 1\n` : ""}exit 0\n`,
  );
  chmodSync(join(bin, "claude"), 0o755);
}

function withPath(path: string, body: () => void) {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try {
    body();
  } finally {
    process.env.PATH = saved;
  }
}

test("every install is listed, on or off, with what it brings and whether its marketplace has a newer version", () => {
  const web = installs();
  const list = installedPlugins().map((p) => ({ id: p.id, scope: p.scope, projectPath: p.projectPath, on: p.on, version: p.version, update: p.update, skills: p.skills.length, extras: p.extras }));
  expect(list).toEqual([
    { id: "a@mk", scope: "user", projectPath: undefined, on: true, version: "1.0.0", update: "1.10.0", skills: 1, extras: ["hooks"] },
    { id: "b@mk", scope: "user", projectPath: undefined, on: false, version: "2.0.0", update: "newer", skills: 1, extras: [] },
    // On in its project's settings, though your own settings don't name it.
    { id: "c@mk", scope: "project", projectPath: web, on: true, version: "0.1.0", update: undefined, skills: 1, extras: [] },
    { id: "rail@synced", scope: null, projectPath: undefined, on: false, version: undefined, update: undefined, skills: 1, extras: [] },
  ]);
});

test.skipIf(process.platform === "win32")("a project install is turned off, uninstalled and reinstalled in its project", () => {
  const web = installs();
  fakeClaude();
  const c = installedPlugins().find((p) => p.id === "c@mk")!;
  withPath("/usr/bin:/bin", () => {
    expect(setPluginOn(c, false)).toMatchObject({ ok: true, message: "c@mk is off in web (project); Claude Code picks it up in its next session" });
    expect(uninstallPlugin(c)).toMatchObject({ ok: true });
    const backup = pluginBackups().find((b) => b.from === "c@mk")!;
    expect(restorePlugin(backup)).toEqual({ ok: true, to: "Claude Code plugins (project in web)" });
  });
  const real = realpathSync(web);
  expect(readFileSync(join(tmp, "calls"), "utf-8").trim().split("\n")).toEqual([
    `${real} plugin disable c@mk --scope project`,
    `${real} plugin uninstall c@mk --keep-data --scope project`,
    `${real} plugin install c@mk --scope project`,
  ]);
  expect(pluginBackups()).toEqual([]);
});

test("without the claude command, turning a plugin on or off writes its scope's settings", () => {
  const web = installs();
  withPath(join(tmp, "empty"), () => {
    const [a, , c] = installedPlugins();
    expect(setPluginOn(a!, false).ok).toBe(true);
    expect(setPluginOn({ ...c!, scope: "local" }, false).ok).toBe(true);
    // Synced plugins never go through the CLI.
    expect(setPluginOn(installedPlugins().find((p) => p.synced)!, true).ok).toBe(true);
  });
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins).toEqual({ "a@mk": false, "b@mk": false, "rail@synced": true, "gone@mk": false });
  expect(JSON.parse(readFileSync(join(web, ".claude", "settings.local.json"), "utf-8")).enabledPlugins).toEqual({ "c@mk": false });
});

test.skipIf(process.platform === "win32")("an update that needs a confirmation isn't confirmed for you", () => {
  installs();
  fakeClaude("update");
  withPath("/usr/bin:/bin", () => {
    const r = updatePlugin(installedPlugins()[0]!);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Run it in a terminal to confirm the marketplace command");
    expect(r.message).toContain("run `claude plugin update a@mk`");
  });
  expect(readFileSync(join(tmp, "calls"), "utf-8")).not.toContain("-y");
});

test("a plugin turned on in your settings with no install record is listed from where Claude Code loads it", () => {
  installs();
  // Its marketplace is the plugin ("source": "./"): skills at the marketplace's root.
  skill(join(tmp, ".claude", "plugins", "marketplaces", "solo", "skills", "tidy"));
  const settings = JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { ...settings.enabledPlugins, "solo@solo": true } }));
  const solo = installedPlugins().find((p) => p.id === "solo@solo")!;
  expect(solo).toMatchObject({ on: true, settingsOnly: true, root: join(tmp, ".claude", "plugins", "marketplaces", "solo") });
  expect(solo.skills.map((d) => d.split(/[\\/]/).pop())).toEqual(["tidy"]);
  expect(uninstallPlugin(solo).ok).toBe(false);
  expect(updatePlugin(solo).ok).toBe(false);
});

test("a synced plugin can't be uninstalled or updated from here", () => {
  installs();
  const rail = installedPlugins().find((p) => p.synced)!;
  expect(uninstallPlugin(rail).ok).toBe(false);
  expect(updatePlugin(rail).ok).toBe(false);
});

test("a project install whose folder is gone says so instead of a spawn error", () => {
  const web = installs();
  const c = installedPlugins().find((p) => p.id === "c@mk")!;
  rmSync(web, { recursive: true, force: true });
  // Checked before looking for the CLI, so the message is right with or without it (and on Windows).
  withPath(join(tmp, "empty"), () => {
    const r = uninstallPlugin(c);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(`${web} no longer exists`);
  });
});

test("a marketplace version written as v1.2.0 is compared as 1.2.0", () => {
  installs();
  const catalog = join(tmp, ".claude", "plugins", "marketplaces", "mk", ".claude-plugin", "marketplace.json");
  writeFileSync(catalog, JSON.stringify({ plugins: [{ name: "a", version: "v1.2.0" }] }));
  expect(installedPlugins().find((p) => p.id === "a@mk")!.update).toBe("v1.2.0");
  writeFileSync(catalog, JSON.stringify({ plugins: [{ name: "a", version: "v0.9.0" }] }));
  expect(installedPlugins().find((p) => p.id === "a@mk")!.update).toBeUndefined();
});

test("a plugin turned on only in your settings is switched in your settings, even with the claude command", () => {
  installs();
  fakeClaude();
  skill(join(tmp, ".claude", "plugins", "marketplaces", "solo", "skills", "tidy"));
  const settings = JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8"));
  writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { ...settings.enabledPlugins, "solo@solo": true } }));
  withPath("/usr/bin:/bin", () => expect(setPluginOn(installedPlugins().find((p) => p.id === "solo@solo")!, false).ok).toBe(true));
  expect(JSON.parse(readFileSync(join(tmp, ".claude", "settings.json"), "utf-8")).enabledPlugins["solo@solo"]).toBe(false);
  expect(existsSync(join(tmp, "calls"))).toBe(false);
});

test.skipIf(process.platform === "win32")("the claude command is looked for again after forgetClaudeBinary", () => {
  withPath("/usr/bin:/bin", () => {
    expect(claudeBinary()).toBeNull();
    fakeClaude();
    expect(claudeBinary()).toBeNull();
    forgetClaudeBinary();
    expect(claudeBinary()).toBe(join(tmp, ".local", "bin", "claude"));
  });
});
