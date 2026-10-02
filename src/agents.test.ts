import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/** Like cli(), for a command that may fail: its exit code, stdout and stderr. */
function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd: project, env: { ...process.env }, encoding: "utf-8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-agents-")));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
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
    expect(ours[0]).toMatchObject({ kind: "skilllib", origin: "skilllib", movable: false, harnesses: ["claude-code", "codex"] });
    expect(findIssues([], machineSkills(), new Set()).map((i) => i.id)).not.toContain("agent-skill");
    // status --json says it's skilllib's own, from its folder (not a built-in an agent bundles).
    const global = JSON.parse(cli("status", "--json")).global as { source: string; from: string; skills: string[] }[];
    expect(global.find((g) => g.skills.includes("skilllib"))).toMatchObject({ source: "skilllib", from: "~/.claude/skills" });

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
    expect(status.project).toBe(project.replace(tmp, "~").replace(/\\/g, "/"));
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

  test("status lists subfolders' skills and global skills as this repo's plugin settings load them", () => {
    setHarnesses(["claude-code", "codex"]);
    skill(join(project, "packages", "web", ".claude", "skills", "web-skill"));
    skill(join(project, "packages", "api", ".agents", "skills", "api-skill"));
    const market = join(tmp, ".claude", "plugins", "marketplaces", "mkt", "plugins");
    skill(join(market, "repoplug", "skills", "repo-plug-skill"));
    skill(join(market, "myplug", "skills", "my-plug-skill"));
    writeFileSync(join(tmp, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "myplug@mkt": true } }));
    const pluginSkills = () =>
      JSON.parse(cli("status", "--json"))
        .global.filter((g: { source: string }) => g.source === "plugin")
        .flatMap((g: { skills: string[] }) => g.skills);
    expect(pluginSkills()).toEqual(["my-plug-skill"]);

    // The repo turns one plugin on and, in its local settings, the user's off.
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "repoplug@mkt": true } }));
    writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "myplug@mkt": false } }));
    const status = JSON.parse(cli("status", "--json"));
    expect(status.global.filter((g: { source: string }) => g.source === "plugin")).toEqual([
      { source: "plugin", from: "repoplug@mkt", agents: ["claude-code"], skills: ["repo-plug-skill"] },
    ]);
    expect(status.nested).toEqual([
      { source: "repo", dir: "packages/api/.agents/skills", git: "new", agents: ["codex"], skills: ["api-skill"] },
      { source: "local", dir: "packages/web/.claude/skills", git: "new", agents: ["claude-code"], skills: ["web-skill"] },
    ]);
  });

  test("a skilllib.json above the git root belongs to another checkout", () => {
    writeFileSync(join(tmp, "skilllib.json"), JSON.stringify({ skills: {} }));
    expect(JSON.parse(cli("status", "--json")).project).toBe(project.replace(tmp, "~").replace(/\\/g, "/"));
  });

  test("stdout is only JSON, even when a command warns", () => {
    const { status, stdout } = run("add", "nope", "--json");
    expect(JSON.parse(stdout)).toEqual([{ name: "nope", action: "skipped", reason: expect.any(String) }]);
    expect(status).toBe(1);
    expect(JSON.parse(cli("doctor", "--json")).map((i: { id: string }) => i.id)).toContain("agent-skill");
    expect(JSON.parse(cli("agent-skill", "install", "--json")).state).toBe("installed");
  });
});

describe("exit codes: a command that did nothing fails", () => {
  beforeEach(() => {
    setHarnesses(["claude-code"]);
    skill(join(tmp, "src", "stripe"), "Stripe payments");
    importSkill(join(tmp, "src", "stripe"));
  });

  test("add, remove, update and sync exit 1 when a skill is skipped, and say which", () => {
    const partial = run("add", "stripe", "nope");
    expect(partial.status).toBe(1);
    expect(partial.stdout).toContain("+ stripe");
    expect(partial.stderr).toContain("nope: not in the library");

    writeFileSync(join(project, ".claude", "skills", "stripe", "SKILL.md"), "---\ndescription: d\n---\nmy edit\n");
    expect(run("remove", "stripe").status).toBe(1);
    // Already on the newest version: nothing to update, so no "has local edits" either.
    const latest = run("update", "stripe");
    expect([latest.status, latest.stderr]).toEqual([0, ""]);
    skill(join(tmp, "src", "stripe"), "Stripe payments, v2");
    importSkill(join(tmp, "src", "stripe"), { force: true });
    expect(run("update", "stripe").status).toBe(1);
    expect(run("update", "nope").stderr).toContain("nope: not managed");
    expect(run("sync").status).toBe(1);

    // Forced, the edits are backed up and `restore` brings them back.
    const forced = run("sync", "--force");
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain("stripe v1 reset");
    expect(forced.stdout).toContain("skilllib restore stripe");
    expect(run("restore", "stripe").status).toBe(0);
    expect(readFileSync(join(project, ".claude", "skills", "stripe", "SKILL.md"), "utf-8")).toContain("my edit");

    // A teammate's clone: the library here doesn't have the pinned skill, so sync can't help.
    rmSync(join(project, ".claude", "skills", "stripe"), { recursive: true });
    rmSync(join(tmp, "home", "library", "stripe"), { recursive: true });
    rmSync(join(tmp, "home", "store", "stripe"), { recursive: true });
    const sync = run("sync");
    expect(sync.status).toBe(1);
    expect(sync.stderr).toContain("not in your library");
    const status = run("status").stdout;
    expect(status).not.toContain("`skilllib sync` to restore");
    expect(status).toContain("stripe isn't in your library");
  });

  test("link doesn't claim success when git-tracked folders blocked every link", () => {
    setHarnesses(["claude-code", "codex"]);
    rmSync(join(project, ".git"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: project });
    skill(join(project, ".claude", "skills", "own"));
    skill(join(project, ".agents", "skills", "team"));
    execFileSync("git", ["add", "."], { cwd: project });
    const r = run("link");
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("already usable");
    expect(r.stderr).toContain("--allow-tracked");
    expect(run("link", "--allow-tracked").status).toBe(0);
    expect(run("link").stdout).toContain("already usable");
  });

  test("tidy <name> --keep <folder> rejects an unknown name or folder, listing the copies", () => {
    setHarnesses(["claude-code", "codex"]);
    skill(join(project, ".claude", "skills", "differs"), "one");
    skill(join(project, ".agents", "skills", "differs"), "two");
    const folder = run("tidy", "differs", "--keep", ".nope/skills");
    expect(folder.status).toBe(1);
    expect(folder.stderr).toContain("pick one of: .claude/skills, .agents/skills");
    expect(folder.stdout).not.toContain("every skill has one copy");
    const name = run("tidy", "diffffers", "--keep", ".agents/skills");
    expect(name.status).toBe(1);
    expect(name.stderr).toContain("diffffers: no skill by that name");
    expect(run("tidy", "--keep", ".agents/skills").status).toBe(1);

    const kept = run("tidy", "differs", "--keep", ".agents/skills");
    expect(kept.status).toBe(0);
    expect(lstatSync(join(project, ".claude", "skills", "differs")).isSymbolicLink()).toBe(true);
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
