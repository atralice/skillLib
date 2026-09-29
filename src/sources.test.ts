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
    ["claude.ai", "pdf", "claude.ai account", false, false, ["claude-code"], 0],
    // ~/.claude/skills is read by Claude Code and (for compatibility) Cursor.
    ["global", "mine", "~/.claude/skills (origin unknown)", true, false, ["claude-code", "cursor"], 0],
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
