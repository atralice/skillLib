import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byWeight, checkBrief, freshLabel, libraryFresh, promptTokens, type CheckRow } from "./check.js";

const tmp = mkdtempSync(join(tmpdir(), "skilllib-check-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function row(over: Partial<CheckRow> & Pick<CheckRow, "name">): CheckRow {
  return {
    where: "global",
    description: "d",
    everyPrompt: 10,
    uses: 0,
    lastUsed: null,
    projects: [],
    fresh: "current",
    path: join(tmp, over.name),
    lever: "yours",
    ...over,
  };
}

test("prompt tokens are a rough count of the name and description", () => {
  expect(promptTokens("ab", "cdef")).toBe(2);
  expect(promptTokens("a", "")).toBe(1);
});

test("fresh words come from the repo skill's state", () => {
  expect(freshLabel("update available", 1, 3)).toBe("v1 → v3");
  expect(freshLabel("edited locally", null, null)).toBe("edited here");
  expect(freshLabel("ok", 2, 2)).toBe("current");
  expect(freshLabel("from npx skills", null, null)).toBe("not in your library");
});

test("a global copy is compared to the library folder, and no version is recorded", () => {
  const prev = process.env.SKILLLIB_HOME;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  try {
    const write = (dir: string, body: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: wrangler\ndescription: d\n---\n${body}\n`);
    };
    write(join(tmp, "home", "library", "wrangler"), "same");
    write(join(tmp, "global", "wrangler"), "same");
    expect(libraryFresh(join(tmp, "global", "wrangler"), "wrangler")).toBe("matches your library");
    write(join(tmp, "global", "wrangler"), "edited");
    expect(libraryFresh(join(tmp, "global", "wrangler"), "wrangler")).toBe("differs from your library");
    expect(libraryFresh(join(tmp, "global", "missing"), "missing")).toBe("not in your library");
  } finally {
    if (prev === undefined) delete process.env.SKILLLIB_HOME;
    else process.env.SKILLLIB_HOME = prev;
  }
});

test("the brief says whether the cost is heavy, and only offers cuts that can be made", () => {
  const lines = checkBrief(
    [
      row({ name: "a", lever: "plugin", via: "vercel@x", everyPrompt: 3000 }),
      row({ name: "b", lever: "plugin", via: "vercel@x", everyPrompt: 2000 }),
      row({ name: "used-plugin", lever: "plugin", via: "kept@x", everyPrompt: 500, uses: 2 }),
      row({ name: "c", lever: "built-in", via: "Cursor", everyPrompt: 1500 }),
      row({ name: "d", lever: "yours", everyPrompt: 400 }),
      row({ name: "e", lever: "yours", everyPrompt: 200, uses: 5 }),
      row({ name: "f", lever: "repo", where: "repo", everyPrompt: 100, uses: 1 }),
    ],
    { days: 30, repo: "web" },
  ).join("\n");
  for (const fact of ["7 skills", "~7,600 tokens", "plus ~100 from this repo", "Heavy", "You can drop ~5,400", "vercel@x", "Turn the plugin off", "can't unload", "Cursor"]) {
    expect(lines).toContain(fact);
  }
  expect(lines).not.toContain("kept@x");
});

test("unused and stale skills come first", () => {
  expect(byWeight([row({ name: "used", uses: 4, everyPrompt: 100 }), row({ name: "idle", uses: 0, everyPrompt: 5, fresh: "v1 → v2" }), row({ name: "big", uses: 0, everyPrompt: 80 })]).map((r) => r.name)).toEqual(["idle", "big", "used"]);
});
