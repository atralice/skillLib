import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHarnesses } from "./config.js";
import { importSkill } from "./library.js";

let tmp: string;
let repo: string;
const realHome = process.env.HOME;
// Node reads the home folder from USERPROFILE on Windows, HOME elsewhere.
const realProfile = process.env.USERPROFILE;

/** Runs the CLI from source in `cwd` (not a terminal, so bare `skilllib` is the piped overview). */
function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function cliWith(env: Record<string, string>, cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(import.meta.dir, "index.ts"), ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "skilllib-contract-")));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.SKILLLIB_HOME = join(tmp, ".skilllib");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code", "codex"]);
  mkdirSync(join(tmp, "src", "alpha"), { recursive: true });
  writeFileSync(join(tmp, "src", "alpha", "SKILL.md"), "---\ndescription: d\n---\nbody\n");
  importSkill(join(tmp, "src", "alpha"));
  repo = join(tmp, "code", "web");
  mkdirSync(join(repo, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
  delete process.env.CLAUDE_CONFIG_DIR;
});

type Row = {
  /** What the row shows, for the test's name. */
  name: string;
  /** Commands to run first (without --json checks), each in the repo. */
  before?: string[][];
  args: string[];
  /** The exit code the contract gives. */
  code: 0 | 1;
  /** A stopping error: stdout is {"error": "..."}. */
  error?: true;
  /** Extra environment for this row. */
  env?: Record<string, string>;
};

// The table is read once when the file loads, for the tests' names: `tmp` isn't set yet then.
const src = () => join(tmp ?? "", "src", "alpha");

const rows: (() => Row)[] = [
  () => ({ name: "status", args: ["status"], code: 0 }),
  () => ({ name: "list", args: ["list"], code: 0 }),
  () => ({ name: "show", args: ["show", "alpha"], code: 0 }),
  () => ({ name: "show of an unknown skill", args: ["show", "nope"], code: 1, error: true }),
  () => ({ name: "projects", args: ["projects"], code: 0 }),
  () => ({ name: "outdated", args: ["outdated"], code: 0 }),
  () => ({ name: "usage", args: ["usage"], code: 0 }),
  () => ({ name: "doctor", args: ["doctor"], code: 0 }),
  () => ({ name: "check", args: ["check"], code: 0 }),
  () => ({ name: "agent-skill", args: ["agent-skill"], code: 0 }),
  () => ({ name: "version", args: ["version"], code: 0 }),
  () => ({ name: "help", args: ["help"], code: 0 }),
  () => ({ name: "add", args: ["add", "alpha"], code: 0 }),
  () => ({ name: "add of a skill the library doesn't have", args: ["add", "nope"], code: 1 }),
  () => ({ name: "remove", before: [["add", "alpha"]], args: ["remove", "alpha"], code: 0 }),
  () => ({ name: "remove of a skill the repo doesn't have", args: ["remove", "alpha"], code: 1 }),
  () => ({ name: "sync", before: [["add", "alpha"]], args: ["sync"], code: 0 }),
  () => ({ name: "update", before: [["add", "alpha"]], args: ["update"], code: 0 }),
  () => ({ name: "import", args: ["import", src()], code: 0 }),
  () => ({ name: "import of a folder with no SKILL.md", args: ["import", join(tmp ?? "", "src")], code: 1 }),
  () => ({ name: "install from a folder", args: ["install", src()], code: 0 }),
  () => ({ name: "apply of an unknown issue", args: ["apply", "nope:1"], code: 1, error: true }),
  () => ({ name: "plugin off for an unknown plugin", args: ["plugin", "off", "nope@nowhere"], code: 1, error: true }),
  () => ({ name: "an unknown flag", args: ["status", "--nope"], code: 1, error: true }),
  () => ({ name: "an unknown command", args: ["nope"], code: 1, error: true }),
  // Nothing listens on port 1, so the search fails at once: the error path, with no network.
  () => ({ name: "search when skills.sh can't be reached", args: ["search", "react"], code: 1, error: true, env: { SKILLLIB_SKILLS_API: "http://127.0.0.1:1" } }),
];

describe("--json: one line of JSON on stdout, and the exit code says whether all of it was done", () => {
  for (const make of rows) {
    const name = make().name;
    test(name, () => {
      const row = make();
      for (const args of row.before ?? []) cli(repo, ...args);
      const r = cliWith(row.env ?? {}, repo, ...row.args, "--json");
      // The name first, so a failure says which row it was.
      expect([row.name, r.out.endsWith("\n"), r.out.trim().split("\n").length]).toEqual([row.name, true, 1]);
      const data = JSON.parse(r.out);
      expect([row.name, r.code]).toEqual([row.name, row.code]);
      // A result can be a string (version) or a list: only a plain object can be the error document.
      const isError = typeof data === "object" && data !== null && !Array.isArray(data) && "error" in data;
      expect([row.name, isError]).toEqual([row.name, row.error === true]);
      if (row.error) expect(Object.keys(data)).toEqual(["error"]);
    });
  }

  test("install of a skill the library has another version of", () => {
    writeFileSync(join(src(), "SKILL.md"), "---\ndescription: d\n---\nanother body\n");
    const r = cli(repo, "install", src(), "--json");
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.out)[0]).toMatchObject({ name: "alpha", status: "exists" });
    expect(r.code).toBe(1);
  });
});
