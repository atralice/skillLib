import { expect, test } from "bun:test";
import { summarize, usesFromTranscriptLine } from "./usage.js";

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
