import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { findIssues } from "./health.js";
import { importSkill } from "./library.js";
import { removePlugin, type ClaudePlugin } from "./plugins.js";
import { machineSkills } from "./sources.js";

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
