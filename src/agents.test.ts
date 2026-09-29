import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentSkillState, installAgentSkill, removeAgentSkill } from "./agentSkill.js";
import { setHarnesses } from "./config.js";
import { findIssues } from "./health.js";
import { importSkill } from "./library.js";
import { firstSentence } from "./here.js";
import { machineSkills } from "./sources.js";

let tmp: string;
let project: string;
const realHome = process.env.HOME;
// Node reads the home folder from USERPROFILE on Windows, HOME elsewhere.
const realProfile = process.env.USERPROFILE;

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
  process.env.USERPROFILE = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  project = join(tmp, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
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
    expect(JSON.parse(cli("add", "stripe", "--json"))).toEqual([{ name: "stripe", action: "installed", to: 1, dirs: [".claude/skills"] }]);

    const status = JSON.parse(cli("status", "--json"));
    expect(status.project).toBe(project.replace(tmp, "~"));
    expect(status.skills).toEqual([
      { source: "library", version: 1, git: "new", skills: ["stripe"] },
      { source: "repo", dir: ".agents/skills", git: "new", agents: [], skills: ["team"] },
    ]);
    expect(status.global).toEqual([{ source: "global", from: "~/.claude/skills", agents: ["claude-code"], skills: ["everywhere"] }]);
    // Installing a global skill is the user's decision, so it's a choice, not something doctor --fix does.
    expect(status.issues.flatMap((i: { choices?: string[] }) => i.choices ?? [])).toContain("Install the skilllib skill for your agents");

    // Inside a project, the library splits into what it has and what it could add (with a short description).
    expect(JSON.parse(cli("list", "--json"))).toEqual({ inThisProject: ["stripe"], skills: [{ name: "terraform", description: "Terraform infra" }] });
  });

  test("a skilllib.json above the git root belongs to another checkout", () => {
    writeFileSync(join(tmp, "skilllib.json"), JSON.stringify({ skills: {} }));
    expect(JSON.parse(cli("status", "--json")).project).toBe(project.replace(tmp, "~"));
  });

  test("stdout is only JSON, even when a command warns", () => {
    const out = cli("add", "nope", "--json");
    expect(JSON.parse(out)).toEqual([{ name: "nope", action: "skipped", reason: expect.any(String) }]);
    expect(JSON.parse(cli("doctor", "--json")).map((i: { id: string }) => i.id)).toContain("agent-skill");
    expect(JSON.parse(cli("agent-skill", "install", "--json")).state).toBe("installed");
  });
});

test("descriptions shorten to their first sentence", () => {
  expect(firstSentence("Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents.")).toBe(
    "Build AI agents on Cloudflare Workers using the Agents SDK.",
  );
  expect(firstSentence("Short. But this is only one sentence really")).toBe("Short. But this is only one sentence really");
  expect(firstSentence("x".repeat(300))).toHaveLength(200);
});

test("a link left dangling by a deleted skilllib skill doesn't block install or remove", () => {
  setHarnesses(["claude-code", "codex"]);
  expect(installAgentSkill().ok).toBe(true);
  const real = join(tmp, ".claude", "skills", "skilllib");
  const link = join(tmp, ".agents", "skills", "skilllib");
  rmSync(real, { recursive: true });
  expect(installAgentSkill().ok).toBe(true);
  expect(agentSkillState()).toBe("installed");
  rmSync(real, { recursive: true });
  expect(removeAgentSkill()).toEqual([link]);
  expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
});

test("outside a repo, status --json reports no project skills (the folders there are global)", () => {
  setHarnesses(["claude-code"]);
  skill(join(tmp, ".claude", "skills", "everywhere"));
  project = tmp;
  const status = JSON.parse(cli("status", "--json"));
  expect(status.skills).toEqual([]);
  expect(status.global.flatMap((g: { skills: string[] }) => g.skills)).toContain("everywhere");
});
