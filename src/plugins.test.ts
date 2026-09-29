import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { findIssues, runFix } from "./health.js";
import { addSkill, importSkill } from "./library.js";
import { removePlugin, turnOffIn, type ClaudePlugin } from "./plugins.js";
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
