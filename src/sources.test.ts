import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineSkills } from "./sources.js";
import { setHarnesses } from "./config.js";

const tmp = mkdtempSync(join(tmpdir(), "skilllib-sources-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function skill(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\ndescription: d\n---\n");
}

test("classifies global, skills.sh, claude.ai, and plugin skills", () => {
  const claude = join(tmp, ".claude");
  const realHome = process.env.HOME;
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = claude;
  setHarnesses(["claude-code", "cursor", "codex"]);

  skill(join(claude, "skills", "mine"));
  skill(join(tmp, ".agents", "skills", "vendored"));
  writeFileSync(join(tmp, ".agents", ".skill-lock.json"), JSON.stringify({ skills: { vendored: { source: "acme/skills" } } }));
  symlinkSync(join(tmp, ".agents", "skills", "vendored"), join(claude, "skills", "vendored"));
  symlinkSync(join(tmp, ".agents", "skills", "gone"), join(claude, "skills", "gone"));
  skill(join(claude, "skills", "synced", "bucket", "pdf"));
  skill(join(claude, "plugins", "marketplaces", "market", "plugins", "tool", "skills", "tool-skill"));
  skill(join(claude, "plugins", "marketplaces", "market", "plugins", "off", "skills", "disabled-skill"));
  writeFileSync(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "tool@market": true, "off@market": false } }));

  const found = machineSkills().map((s) => [s.kind, s.name, s.origin, s.movable, s.broken, s.harnesses, s.links.length]);
  expect(found).toEqual([
    // Cursor walks ~/.claude/skills recursively, so it reaches the claude.ai skills in synced/ too.
    ["claude.ai", "pdf", "claude.ai account", false, false, ["claude-code", "cursor"], 0],
    // ~/.claude/skills is read by Claude Code and (for compatibility) Cursor.
    ["global", "mine", "~/.claude/skills (origin unknown)", true, false, ["claude-code", "cursor"], 0],
    // Not in installed_plugins.json, so Cursor doesn't import it.
    ["plugin", "tool-skill", "tool@market", false, false, ["claude-code"], 0],
    ["skills.sh", "gone", "skills.sh (not in its lock file)", true, true, [], 0],
    // The ~/.claude/skills link folds into the real ~/.agents/skills folder: one skill, every harness.
    ["skills.sh", "vendored", "acme/skills", true, false, ["claude-code", "cursor", "codex"], 1],
  ]);
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

test("reads Codex's /etc/codex/skills as a system folder skilllib never changes", () => {
  const home = join(tmp, "sys-home");
  const realHome = process.env.HOME;
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
  process.env.SKILLLIB_CODEX_SYSTEM_DIR = join(tmp, "etc", "codex", "skills");
  skill(join(tmp, "etc", "codex", "skills", "house-style"));
  try {
    setHarnesses(["codex"]);
    expect(machineSkills().map((s) => [s.kind, s.name, s.origin, s.movable, s.harnesses])).toEqual([
      // Shown with "/" on every OS.
      ["system", "house-style", join(tmp, "etc", "codex", "skills").replace(/\\/g, "/"), false, ["codex"]],
    ]);
    // Only Codex reads it.
    setHarnesses(["claude-code"]);
    expect(machineSkills()).toEqual([]);
  } finally {
    process.env.HOME = realHome;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.SKILLLIB_CODEX_SYSTEM_DIR;
  }
});

test("a CLAUDE_CONFIG_DIR outside your home is still your global folder, not a system one", () => {
  const home = join(tmp, "cfg-home");
  const realHome = process.env.HOME;
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(tmp, "opt", "claude");
  skill(join(tmp, "opt", "claude", "skills", "mine"));
  try {
    setHarnesses(["claude-code"]);
    expect(machineSkills().map((s) => [s.kind, s.name, s.movable])).toEqual([["global", "mine", true]]);
  } finally {
    process.env.HOME = realHome;
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("npx skills' lock file is read from ~/.agents, even when CLAUDE_CONFIG_DIR isn't directly in your home", () => {
  const home = join(tmp, "lock-home");
  const claude = join(home, "deep", "cfg", "claude");
  const realHome = process.env.HOME;
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = claude;
  skill(join(home, ".agents", "skills", "vendored"));
  skill(join(home, ".agents", "skills", "linked"));
  mkdirSync(join(claude, "skills"), { recursive: true });
  symlinkSync(join(home, ".agents", "skills", "linked"), join(claude, "skills", "linked"));
  writeFileSync(
    join(home, ".agents", ".skill-lock.json"),
    JSON.stringify({ skills: { vendored: { source: "acme/skills" }, linked: { source: "acme/skills" } } }),
  );
  try {
    setHarnesses(["claude-code", "codex"]);
    expect(machineSkills().map((s) => [s.kind, s.name, s.origin, s.harnesses])).toEqual([
      ["skills.sh", "linked", "acme/skills", ["claude-code", "codex"]],
      ["skills.sh", "vendored", "acme/skills", ["codex"]],
    ]);
  } finally {
    process.env.HOME = realHome;
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("Cursor loads claude.ai skills and user-scope Claude Code plugins, not synced plugins", () => {
  const home = join(tmp, "cursor-home");
  const claude = join(home, ".claude");
  const realHome = process.env.HOME;
  process.env.HOME = home;
  process.env.SKILLLIB_HOME = join(home, "skilllib");
  process.env.CLAUDE_CONFIG_DIR = claude;

  skill(join(claude, "skills", "synced", "bucket", "pdf"));
  const cache = join(claude, "plugins", "cache", "market");
  skill(join(cache, "mine", "1.0.0", "skills", "user-skill"));
  skill(join(cache, "team", "1.0.0", "skills", "project-skill"));
  writeFileSync(
    join(claude, "plugins", "installed_plugins.json"),
    JSON.stringify({
      plugins: {
        "mine@market": [{ scope: "user", installPath: join(cache, "mine", "1.0.0") }],
        "team@market": [{ scope: "project", projectPath: join(home, "app"), installPath: join(cache, "team", "1.0.0") }],
      },
    }),
  );
  const syncedPlugin = join(claude, "plugins", "synced", "bucket", "helper");
  skill(join(syncedPlugin, "skills", "synced-skill"));
  writeFileSync(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "mine@market": true, "team@market": true } }));

  const loaded = () => machineSkills().map((s) => [s.name, s.harnesses]);
  setHarnesses(["claude-code", "cursor"]);
  expect(loaded()).toEqual([
    ["pdf", ["claude-code", "cursor"]],
    ["project-skill", ["claude-code"]],
    ["synced-skill", ["claude-code"]],
    ["user-skill", ["claude-code", "cursor"]],
  ]);
  // Without Claude Code, Cursor still loads them.
  setHarnesses(["cursor"]);
  expect(loaded()).toEqual([
    ["pdf", ["cursor"]],
    ["user-skill", ["cursor"]],
  ]);
  setHarnesses(["codex"]);
  expect(loaded()).toEqual([]);

  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});
