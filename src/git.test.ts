import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitInfo } from "./git.js";

const root = mkdtempSync(join(tmpdir(), "skilllib-git-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function skill(rel: string) {
  mkdirSync(join(root, rel), { recursive: true });
  writeFileSync(join(root, rel, "SKILL.md"), "x\n");
}

test("tells committed, changed, new and gitignored skill folders apart", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(root, ".gitignore"), ".claude/skills/\n");
  skill(".agents/skills/team");
  skill(".agents/skills/edited");
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFileSync(join(root, ".agents/skills/edited/SKILL.md"), "changed\n");
  skill(".agents/skills/fresh");
  skill(".claude/skills/mine");

  const info = gitInfo(root)!;
  expect(["team", "edited", "fresh"].map((n) => info.of(`.agents/skills/${n}`))).toEqual(["committed", "changed", "new"]);
  expect(info.of(".claude/skills/mine")).toBe("ignored");
  expect(gitInfo(tmpdir())).toBeNull();
});
