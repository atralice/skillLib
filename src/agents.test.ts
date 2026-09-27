import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentSkillState, installAgentSkill, removeAgentSkill } from "./agentSkill.js";
import { setHarnesses } from "./config.js";
import { findIssues } from "./health.js";
import { importSkill } from "./library.js";
import { machineSkills } from "./sources.js";

let tmp: string;
let project: string;
const realHome = process.env.HOME;

function skill(dir: string, description = "d") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\ndescription: ${description}\n---\nbody\n`);
}

/** Runs the CLI from source in `project`, returning stdout (stderr is kept apart). */
function cli(...args: string[]): string {
  return execFileSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], {
    cwd: project,
    env: { ...process.env },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-agents-")));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  project = join(tmp, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("the skilllib skill for agents", () => {
  test("installs once for Claude Code and links it for Codex; skilllib reports it as its own", () => {
    setHarnesses(["claude-code", "codex"]);
    expect(agentSkillState()).toBe("missing");
    const r = installAgentSkill();
    expect(r.ok).toBe(true);

    const real = join(tmp, ".claude", "skills", "skilllib");
    const link = join(tmp, ".agents", "skills", "skilllib");
    expect(existsSync(join(real, "SKILL.md"))).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(agentSkillState()).toBe("installed");

    // One skill, loaded by both agents, and not offered for cleanup.
    const ours = machineSkills().filter((m) => m.name === "skilllib");
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ kind: "built-in", origin: "skilllib", movable: false, harnesses: ["claude-code", "codex"] });
    expect(findIssues([], machineSkills(), new Set()).map((i) => i.id)).not.toContain("agent-skill");

    expect(removeAgentSkill()).toEqual([real, link]);
    expect(existsSync(real) || existsSync(link)).toBe(false);
  });

  test("never overwrites someone else's skill with the same name", () => {
    setHarnesses(["claude-code"]);
    skill(join(tmp, ".claude", "skills", "skilllib"), "mine");
    expect(installAgentSkill()).toMatchObject({ ok: false });
    expect(removeAgentSkill()).toEqual([]);
    expect(existsSync(join(tmp, ".claude", "skills", "skilllib", "SKILL.md"))).toBe(true);
  });
});

describe("--json", () => {
  beforeEach(() => {
    setHarnesses(["claude-code"]);
    skill(join(tmp, "src", "stripe"), "Stripe payments");
    skill(join(tmp, "src", "terraform"), "Terraform infra");
    importSkill(join(tmp, "src", "stripe"));
    importSkill(join(tmp, "src", "terraform"));
    skill(join(tmp, ".claude", "skills", "everywhere"), "A global skill");
    skill(join(project, ".agents", "skills", "team"), "The team's own skill");
  });

  test("add, status and list answer 'what can you use here and where is it from'", () => {
    expect(JSON.parse(cli("add", "stripe", "--json"))).toEqual([{ name: "stripe", action: "installed", to: 1 }]);

    const status = JSON.parse(cli("status", "--json"));
    expect(status.project.path).toBe(project);
    const bySkill = Object.fromEntries(status.skills.map((s: { name: string }) => [s.name, s]));
    expect(bySkill.stripe).toMatchObject({ source: "library", scope: "project", state: "ok", version: 1, loadedBy: ["claude-code"], description: "Stripe payments" });
    expect(bySkill.team).toMatchObject({ source: "repo", scope: "project", loadedBy: [] });
    expect(bySkill.everywhere).toMatchObject({ source: "global", scope: "global", yours: true, loadedBy: ["claude-code"] });

    const list = JSON.parse(cli("list", "--json"));
    expect(list.skills.map((s: { name: string; inThisProject: boolean }) => [s.name, s.inThisProject])).toEqual([
      ["stripe", true],
      ["terraform", false],
    ]);
  });

  test("stdout is only JSON, even when a command warns", () => {
    const out = cli("add", "nope", "--json");
    expect(JSON.parse(out)).toEqual([{ name: "nope", action: "skipped", reason: expect.any(String) }]);
    expect(JSON.parse(cli("doctor", "--json")).map((i: { id: string }) => i.id)).toContain("agent-skill");
    expect(JSON.parse(cli("agent-skill", "install", "--json")).state).toBe("installed");
  });
});
