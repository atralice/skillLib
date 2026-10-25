import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanUsage, summarize, usesFromTranscriptLine } from "./usage.js";

test("reads Skill calls, skill file reads, and slash commands from transcript lines", () => {
  const assistant = JSON.stringify({
    type: "assistant",
    cwd: "/code/app/.claude/worktrees/x",
    timestamp: "2026-09-26T12:00:00.000Z",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "Skill", input: { skill: "stylex" } },
        { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/code/app/.claude/skills/stylex/refs.md" } },
        { type: "tool_use", id: "t3", name: "Read", input: { file_path: "/code/app/src/x.ts" } },
      ],
    },
  });
  const slash = JSON.stringify({
    type: "user",
    uuid: "u1",
    cwd: "/code/other",
    timestamp: "2026-09-27T12:00:00.000Z",
    message: { content: "<command-name>/stylex</command-name>" },
  });
  const builtin = JSON.stringify({ type: "user", message: { content: "<command-name>/goal</command-name>" } });

  const uses = [assistant, slash, builtin, "not json {Skill"].flatMap(usesFromTranscriptLine);
  expect(uses.map((u) => [u.skill, u.source])).toEqual([
    ["stylex", "invoked"],
    ["stylex", "file read"],
    ["stylex", "slash"],
  ]);

  const [summary] = summarize(uses, (cwd) => (cwd.startsWith("/code/app") ? "/code/app" : null));
  expect(summary?.uses).toBe(3);
  expect(summary?.lastUsed).toBe("2026-09-27T12:00:00.000Z");
  expect([...(summary?.projects ?? [])]).toEqual(["/code/app"]);
});

test("a plugin's copy of a skill counts as the skill", () => {
  const use = (skill: string, key: string) => ({ skill, source: "slash" as const, cwd: "", at: "2026-09-27T12:00:00.000Z", key });
  expect(summarize([use("ponytail:ponytail", "a"), use("ponytail", "b")]).map((s) => [s.skill, s.uses])).toEqual([["ponytail", 2]]);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a transcript folder that can't be read is skipped, not the whole count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skilllib-usage-"));
  const before = process.env.CLAUDE_CONFIG_DIR;
  const home = process.env.SKILLLIB_HOME;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.SKILLLIB_HOME = join(dir, "home");
  const locked = join(dir, "projects", "locked");
  mkdirSync(locked, { recursive: true });
  mkdirSync(join(dir, "projects", "open"));
  writeFileSync(join(locked, "a.jsonl"), "{}\n");
  writeFileSync(join(dir, "projects", "open", "b.jsonl"), "{}\n");
  chmodSync(locked, 0o000);
  try {
    expect(await scanUsage(30)).toEqual([]);
  } finally {
    chmodSync(locked, 0o755);
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    if (home === undefined) delete process.env.SKILLLIB_HOME;
    else process.env.SKILLLIB_HOME = home;
  }
});

test.skipIf(process.platform === "win32")("a transcript that's a looping link or a FIFO is skipped, not an error or a hang", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skilllib-usage-"));
  const before = process.env.CLAUDE_CONFIG_DIR;
  const home = process.env.SKILLLIB_HOME;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.SKILLLIB_HOME = join(dir, "home");
  const project = join(dir, "projects", "p");
  mkdirSync(project, { recursive: true });
  symlinkSync("loop.jsonl", join(project, "loop.jsonl"));
  execFileSync("mkfifo", [join(project, "pipe.jsonl")]);
  try {
    expect(await scanUsage(30)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    if (home === undefined) delete process.env.SKILLLIB_HOME;
    else process.env.SKILLLIB_HOME = home;
  }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a transcript is parsed once, and again only after it changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skilllib-usage-"));
  const before = process.env.CLAUDE_CONFIG_DIR;
  const home = process.env.SKILLLIB_HOME;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.SKILLLIB_HOME = join(dir, "home");
  const file = join(dir, "projects", "p", "a.jsonl");
  mkdirSync(join(file, ".."), { recursive: true });
  const line = (skill: string, at: string) =>
    JSON.stringify({ type: "assistant", timestamp: at, cwd: "/code", message: { content: [{ type: "tool_use", id: skill, name: "Skill", input: { skill } }] } });
  const recent = new Date().toISOString();
  const older = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(file, `${line("old", older)}\n${line("new", recent)}\n`);
  try {
    expect((await scanUsage(1)).map((u) => u.skill)).toEqual(["new"]);
    const cache = join(dir, "home", "usage-cache.json");
    const written = statSync(cache).mtimeMs;
    chmodSync(file, 0o000);
    // The older use was stored even though --days 1 didn't count it, and the file isn't read again.
    expect((await scanUsage(30)).map((u) => u.skill)).toEqual(["old", "new"]);
    expect(statSync(cache).mtimeMs).toBe(written);
    chmodSync(file, 0o644);
    writeFileSync(file, `${line("other", recent)}\n`);
    expect((await scanUsage(30)).map((u) => u.skill)).toEqual(["other"]);
  } finally {
    chmodSync(file, 0o644);
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    if (home === undefined) delete process.env.SKILLLIB_HOME;
    else process.env.SKILLLIB_HOME = home;
  }
});
