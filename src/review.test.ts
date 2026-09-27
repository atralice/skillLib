import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewPrompt } from "./review.js";

const tmp = mkdtempSync(join(tmpdir(), "skilllib-review-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("the review prompt carries each skill's facts, its SKILL.md body, and asks for a JSON decision", () => {
  const dir = join(tmp, "wrangler");
  mkdirSync(dir);
  writeFileSync(join(dir, "SKILL.md"), "---\nname: wrangler\ndescription: Cloudflare CLI\n---\nRun wrangler deploy.\n");

  const prompt = buildReviewPrompt(
    [
      {
        name: "wrangler",
        description: "Cloudflare CLI",
        source: "my global skills (global folder)",
        installedHow: "copied into ~/.claude/skills",
        path: dir,
        links: [],
        loadedBy: "Claude Code, Cursor — in every repo",
        vendor: null,
        usesTotal: 1,
        usesByProject: [["edge-app", 1]],
        installedIn: [],
        otherCopies: ["plugin cloudflare@x"],
        inYourSkills: "yes, v2",
        keptGlobal: true,
      },
    ],
    { scope: "Global skills.", usageDays: 30, harnesses: ["Claude Code", "Cursor"], projects: [{ name: "edge-app", path: "/code/edge-app" }] },
  );

  for (const fact of ["### wrangler", "marked this as global on purpose", "1 use in the last 30 days (edge-app: 1)", "plugin cloudflare@x", "yes, v2", "edge-app — /code/edge-app", "Run wrangler deploy."]) {
    expect(prompt).toContain(fact);
  }
  expect(prompt).not.toContain("description: Cloudflare CLI\n---");
  expect(prompt).toContain('"decision": "keep-global | move | delete | vendor-off"');
});
