import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRoot, discoverProjects, harnessesChosen, keptGlobal, setHarnesses, setHidden, setKeepGlobal, visibleProjects } from "./config.js";
import { findIssues, runFix, usageIssues } from "./health.js";
import { addSkill, createSkill, deleteGlobal, importSkill, linkAll, linkGlobal, listBackups, projectStatus, restoreBackup } from "./library.js";
import { readManifest } from "./project.js";
import { libraryOrigins, machineSkills } from "./sources.js";

let tmp: string;

function skill(dir: string, body = "x") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\ndescription: d\n---\n${body}\n`);
}

const realHome = process.env.HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skilllib-health-"));
  process.env.HOME = tmp;
  process.env.SKILLLIB_HOME = join(tmp, "home");
  process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
  delete process.env.CODEX_HOME;
  setHarnesses(["claude-code"]);
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env.HOME = realHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

test("project folders are scanned for git repos, and hidden projects drop out", () => {
  for (const repo of ["code/web", "code/nested/api"]) mkdirSync(join(tmp, repo, ".git"), { recursive: true });
  mkdirSync(join(tmp, "code", "web", "node_modules", "dep", ".git"), { recursive: true });
  addRoot(join(tmp, "code"));

  expect(discoverProjects()).toEqual([join(tmp, "code", "nested", "api"), join(tmp, "code", "web")]);
  setHidden(join(tmp, "code", "web"), true);
  expect(visibleProjects()).toEqual([join(tmp, "code", "nested", "api")]);
});

test("finds broken links, duplicates, and local-only skills, and fixes them", () => {
  const project = join(tmp, "code", "web");
  mkdirSync(join(project, ".git"), { recursive: true });
  skill(join(project, ".claude", "skills", "deploy"));
  symlinkSync(join(tmp, "nowhere"), join(tmp, ".claude", "skills", "gone"));
  skill(join(tmp, ".claude", "skills", "twice"));
  skill(join(tmp, ".claude", "skills", "synced", "b", "twice"));

  const issues = findIssues([project], machineSkills(), new Set());
  expect(issues.map((i) => i.id)).toEqual(["broken:gone", "dup:twice", "review:global", `local:${project}:deploy`, "agent-skill"]);

  // doctor --fix only runs the fixes; importing is a choice.
  expect(issues.find((i) => i.id.startsWith("local:"))?.fix).toBeUndefined();
  expect(issues.find((i) => i.id.startsWith("local:"))?.title).toBe("deploy in web isn't in your library");
  for (const issue of issues) issue.fix?.run();
  expect(existsSync(join(tmp, "home", "library", "deploy"))).toBe(false);
  for (const issue of issues) issue.choices?.[0]?.run();
  // Your skill wins over the claude.ai copy, but only claude.ai can turn its copy off.
  const left = findIssues([project], machineSkills(), new Set(["deploy", "twice"])).filter((i) => i.id !== "review:global");
  expect(left.map((i) => [i.id, i.fix, i.choices])).toEqual([["dup:twice", undefined, undefined]]);
  expect(left[0]?.detail).toContain("Your skill wins");
  expect(existsSync(join(tmp, ".claude", "skills", "twice"))).toBe(true);
  expect(existsSync(join(tmp, "home", "library", "deploy", "SKILL.md"))).toBe(true);

  // Everything moved out can be put back.
  const gone = listBackups().find((b) => b.name === "gone");
  expect(gone && restoreBackup(gone)).toMatchObject({ ok: true });
  expect(lstatSync(join(tmp, ".claude", "skills", "gone")).isSymbolicLink()).toBe(true);
});

test("flags a project skill that also loads globally", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  skill(join(tmp, ".claude", "skills", "alpha"));
  importSkill(join(tmp, ".claude", "skills", "alpha"));
  addSkill(project, "alpha");

  const other = join(tmp, "api");
  mkdirSync(other);
  addSkill(other, "alpha");

  // One issue for both projects, and a choice: doctor --fix never moves your global skills.
  const issues = findIssues([project, other], machineSkills(), new Set(["alpha"])).filter((i) => i.id !== "agent-skill");
  expect(issues.map((i) => [i.id, i.title, i.fix])).toEqual([
    ["review:global", "1 global skill of yours loads in every repo", undefined],
    ["twice:alpha", "alpha: in web, api and also loaded globally", undefined],
  ]);
  expect(issues[0]?.choices).toBeUndefined();
  expect(runFix(issues[1]!.choices![0]!)).toEqual({ ok: true, message: "alpha no longer loads globally" });
  expect(existsSync(join(tmp, ".claude", "skills", "alpha"))).toBe(false);
});

test("keeping a skill global on purpose is remembered by name and can be undone", () => {
  expect([...keptGlobal()]).toEqual([]);
  setKeepGlobal(["commit", "ponytail"], true);
  setKeepGlobal(["commit"], true);
  expect([...keptGlobal()]).toEqual(["commit", "ponytail"]);
  setKeepGlobal(["ponytail"], false);
  expect([...keptGlobal()]).toEqual(["commit"]);
  // Other settings survive.
  expect(harnessesChosen()).toBe(true);
});

test("deleting a kept global skill forgets the mark, so a reinstall isn't silently kept", () => {
  skill(join(tmp, ".claude", "skills", "commit"));
  setKeepGlobal(["commit", "other"], true);
  expect(deleteGlobal(join(tmp, ".claude", "skills", "commit")).ok).toBe(true);
  expect([...keptGlobal()]).toEqual(["other"]);
});

test("a project copy of a skill you keep global is the extra one", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  skill(join(tmp, ".claude", "skills", "alpha"));
  importSkill(join(tmp, ".claude", "skills", "alpha"));
  addSkill(project, "alpha");
  setKeepGlobal(["alpha"], true);

  const [issue] = findIssues([project], machineSkills(), new Set(["alpha"]));
  expect(issue?.id).toBe("twice:alpha");
  expect(issue?.choices?.map((c) => c.label)).toEqual(["Remove the copies in web"]);
  issue?.choices?.[0]?.run();
  expect(readManifest(project).skills.alpha).toBeUndefined();
  expect(existsSync(join(tmp, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
});

test("tidy issues: a plain fix when git won't notice, a choice when it would, and doctor --fix never picks", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".claude", "skills", "mine"), "same");
  skill(join(project, ".agents", "skills", "mine"), "same");
  skill(join(tmp, ".claude", "skills", "g"), "same");
  skill(join(tmp, ".agents", "skills", "g"), "same");
  skill(join(project, ".claude", "skills", "deploy"), "a");
  skill(join(project, ".agents", "skills", "deploy"), "b");

  const issues = findIssues([project], machineSkills(), new Set());
  const byId = (id: string) => issues.find((i) => i.id === id);
  expect(byId("tidy:global")?.fix).toBeDefined();
  expect(byId(`tidy:${project}`)?.fix).toBeDefined(); // not a git repo: nothing for git to see
  expect(byId(`conflict:${project}:deploy`)?.fix).toBeUndefined();
  expect(byId(`conflict:${project}:deploy`)?.choices?.map((c) => c.label)).toEqual(["Keep the .claude/skills copy", "Keep the .agents/skills copy"]);

  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync("git", ["add", "."], { cwd: project });
  const inRepo = findIssues([project], machineSkills(), new Set()).find((i) => i.id === `tidy:${project}`);
  expect(inRepo?.fix).toBeUndefined();
  expect(inRepo?.choices?.map((c) => c.label)).toEqual(["Tidy, but keep git as it is", "Tidy everything"]);
});

test("a skill some of your agents can't reach gets a link fix, with a choice when git tracks the folder", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".agents", "skills", "team")); // Codex sees it, Claude Code doesn't

  const issue = () => findIssues([project], machineSkills(), new Set()).find((i) => i.id === `usable:${project}`);
  expect(issue()?.title).toBe("web: 1 skill not usable by Claude Code");
  expect(issue()?.fix?.label).toBe("Add the links");
  issue()?.fix?.run();
  expect(lstatSync(join(project, ".claude", "skills", "team")).isSymbolicLink()).toBe(true);
  expect(issue()).toBeUndefined();

  const repo = join(tmp, "repo");
  skill(join(repo, ".agents", "skills", "team"));
  skill(join(repo, ".claude", "skills", "committed"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  const tracked = () => findIssues([repo], machineSkills(), new Set()).find((i) => i.id === `usable:${repo}`);
  expect(tracked()?.fix).toBeUndefined();
  // Every link it needs goes where git tracks the folder: skipping those would link nothing, so that choice isn't offered.
  expect(tracked()?.choices?.map((c) => c.label)).toEqual(["Add links everywhere"]);

  // When some link can go where git doesn't track the folder, skipping the others is a choice too.
  setHarnesses(["claude-code", "codex", "zed"]);
  const both = join(tmp, "both");
  skill(join(both, ".agents", "skills", "team"));
  skill(join(both, ".codex", "skills", "tool")); // Zed reads only .agents/skills, which git tracks
  execFileSync("git", ["init", "-q"], { cwd: both });
  execFileSync("git", ["add", "."], { cwd: both });
  const mixed = findIssues([both], machineSkills(), new Set()).find((i) => i.id === `usable:${both}`);
  expect(mixed?.choices?.map((c) => c.label)).toEqual(["Add links, but not where git tracks the folder", "Add links everywhere"]);
});

test("a skill only links into folders git tracks could reach, while it isn't committed: commit it first, no link fix", () => {
  setHarnesses(["claude-code", "codex", "cursor"]);
  const repo = join(tmp, "repo");
  skill(join(repo, ".claude", "skills", "team"));
  skill(join(repo, ".agents", "skills", "tool"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  linkAll(repo, { allowTracked: true });
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "links");
  skill(join(repo, ".cursor", "skills", "mine")); // not committed; Claude Code and Codex read folders git tracks

  const issues = findIssues([repo], machineSkills(), new Set());
  expect(issues.find((i) => i.id === `usable:${repo}`)).toBeUndefined();
  const commit = issues.find((i) => i.id === `uncommitted:${repo}:mine`)!;
  expect(commit.title).toBe("mine in repo: Claude Code, Codex can't use it until it's committed");
  expect(commit.detail).toContain("Commit it, then link it");
  expect(commit.fix).toBeUndefined();
  expect(commit.choices).toBeUndefined();

  // Committed, the link fix is back.
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "mine");
  const after = findIssues([repo], machineSkills(), new Set());
  expect(after.some((i) => i.id === `uncommitted:${repo}:mine`)).toBe(false);
  expect(after.find((i) => i.id === `usable:${repo}`)?.choices?.map((c) => c.label)).toEqual(["Add links everywhere"]);
});

test("a link fix that links nothing fails instead of reporting success", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".agents", "skills", "team"));
  const issue = findIssues([project], machineSkills(), new Set()).find((i) => i.id === `usable:${project}`)!;
  // Something else takes the link's place before the fix runs.
  mkdirSync(join(project, ".claude", "skills", "team"), { recursive: true });
  expect(runFix(issue.fix!)).toEqual({ ok: false, message: "web: nothing linked" });
});

test("a pinned skill whose folder is missing: sync restores it from the library; one the library lacks can only be removed", () => {
  const project = join(tmp, "web");
  mkdirSync(join(project, ".git"), { recursive: true });
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  addSkill(project, "alpha");
  rmSync(join(project, ".claude", "skills", "alpha"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(project, "skilllib.json"), "utf-8"));
  manifest.skills["ghost-skill"] = { version: 1, hash: "abc" };
  writeFileSync(join(project, "skilllib.json"), JSON.stringify(manifest));

  const issues = findIssues([project], machineSkills(), new Set(["alpha"]));
  const sync = issues.find((i) => i.id === `sync:${project}`)!;
  expect(sync.title).toBe("web: 1 skill in skilllib.json not installed");
  expect(sync.detail).toBe("alpha: the folder is missing");
  const ghost = issues.find((i) => i.id === `unavailable:${project}:ghost-skill`)!;
  expect(ghost.title).toBe("ghost-skill: pinned in web's skilllib.json, but not in your library");
  expect(ghost.detail).toContain("import it, or set SKILLLIB_HOME to the library that has it");
  expect(ghost.fix).toBeUndefined();
  expect(issues.some((i) => i.title.includes("out of date"))).toBe(false);

  // Sync restores alpha and says ghost-skill was skipped.
  const r = runFix(sync.fix!);
  expect(r.ok).toBe(true);
  expect(r.message).toStartWith("web: restored 1 skill; skipped ghost-skill: not in your library");
  expect(existsSync(join(project, ".claude", "skills", "alpha", "SKILL.md"))).toBe(true);
  // Nothing left it can restore: no sync fix to report ✓ for.
  expect(findIssues([project], machineSkills(), new Set(["alpha"])).some((i) => i.id === `sync:${project}`)).toBe(false);

  expect(runFix(ghost.choices![0]!)).toEqual({ ok: true, message: "ghost-skill: removed from web's skilllib.json" });
  expect(readManifest(project).skills["ghost-skill"]).toBeUndefined();
});

test("a newer library version is an update to choose, not a sync that does nothing", () => {
  const project = join(tmp, "web");
  mkdirSync(join(project, ".git"), { recursive: true });
  skill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "alpha"));
  addSkill(project, "alpha");
  skill(join(tmp, "src", "alpha"), "v2");
  importSkill(join(tmp, "src", "alpha"), { force: true });

  const issues = findIssues([project], machineSkills(), new Set(["alpha"]));
  expect(issues.some((i) => i.id === `sync:${project}`)).toBe(false);
  const update = issues.find((i) => i.id === `update:${project}`)!;
  expect(update.title).toBe("web: 1 skill out of date");
  expect(update.detail).toBe("alpha (v1 → v2)");
  expect(update.fix).toBeUndefined();
  expect(runFix(update.choices![0]!)).toEqual({ ok: true, message: "web: updated 1 skill" });
  expect(readManifest(project).skills.alpha?.version).toBe(2);
});

test("a link to a folder under another name isn't offered for import (that made a second copy)", () => {
  const project = join(tmp, "trader");
  skill(join(project, ".agents", "skills", "Trading Best Practices"));
  mkdirSync(join(project, ".claude", "skills"), { recursive: true });
  symlinkSync("../../.agents/skills/Trading Best Practices", join(project, ".claude", "skills", "trading-best-practices"));

  const ids = findIssues([project], machineSkills(), new Set()).map((i) => i.id);
  expect(ids.filter((id) => id.startsWith("local:") || id.startsWith("adopt:"))).toEqual([]);
});

test("copies that differ aren't offered for import or tracking until you pick one", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".claude", "skills", "deploy"), "a");
  skill(join(project, ".agents", "skills", "deploy"), "b");
  const ids = findIssues([project], machineSkills(), new Set()).map((i) => i.id);
  expect(ids).toContain(`conflict:${project}:deploy`);
  expect(ids).not.toContain(`local:${project}:deploy`);
});

test("skills npx skills installed in a project keep their source and aren't called local only", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  writeFileSync(
    join(project, "skills-lock.json"),
    JSON.stringify({ version: 1, skills: { "video-edit": { source: "genmedia-labs/skills" }, copied: { source: "acme/skills" } } }),
  );
  // Symlink method: real copy in .agents/skills, link in .claude/skills.
  skill(join(project, ".agents", "skills", "video-edit"));
  mkdirSync(join(project, ".claude", "skills"), { recursive: true });
  symlinkSync(join(project, ".agents", "skills", "video-edit"), join(project, ".claude", "skills", "video-edit"));
  // Copy method: a real copy in each folder.
  skill(join(project, ".agents", "skills", "copied"));
  skill(join(project, ".claude", "skills", "copied"));

  expect(projectStatus(project).map((s) => [s.name, s.state, s.source])).toEqual([
    ["copied", "from npx skills", "acme/skills"],
    ["video-edit", "from npx skills", "genmedia-labs/skills"],
  ]);
  // No "only exists in web → import it" (tidy may still fold the copy-method duplicate into a link).
  const ids = findIssues([project], machineSkills(), new Set()).map((i) => i.id);
  expect(ids.filter((id) => id.startsWith("local:") || id.startsWith("adopt:"))).toEqual([]);

  importSkill(join(project, ".claude", "skills", "video-edit"));
  expect(libraryOrigins()["video-edit"]).toBe("skills.sh: genmedia-labs/skills");
});

test("a repo's own skill that also loads globally is flagged, and never offered for removal", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "web");
  skill(join(project, ".agents", "skills", "alpha")); // committed by the team; Codex loads it
  skill(join(tmp, ".claude", "skills", "alpha")); // Claude Code loads this one

  const twice = () => findIssues([project], machineSkills(), new Set()).find((i) => i.id === "twice:alpha");
  // No agent loads both copies: nothing to fix (unloading the global one would take it from Claude Code).
  expect(twice()).toBeUndefined();

  skill(join(tmp, ".agents", "skills", "alpha")); // now Codex loads a global copy too
  expect(twice()?.title).toBe("alpha: in web and also loaded globally");
  expect(twice()?.detail).toContain("load both the repo's copy and the global one");
  expect(twice()?.choices?.map((c) => c.label)).toEqual(["Stop loading it globally"]);

  // Kept global on purpose: skilllib can't remove the team's copy, so it only says so.
  setKeepGlobal(["alpha"], true);
  expect(twice()?.choices).toBeUndefined();
  expect(twice()?.detail).toContain("web has its own copy");
});

test("local edits to an installed skill: save them as a new version, or discard them (restorable)", () => {
  const project = join(tmp, "web");
  mkdirSync(project);
  skill(join(tmp, "src", "alpha"), "v1");
  importSkill(join(tmp, "src", "alpha"));
  const origin = libraryOrigins().alpha;
  addSkill(project, "alpha");
  const copy = join(project, ".claude", "skills", "alpha", "SKILL.md");
  const edited = () => findIssues([project], machineSkills(), new Set(["alpha"])).find((i) => i.id === `edited:${project}:alpha`);

  expect(edited()).toBeUndefined();
  writeFileSync(copy, "---\ndescription: d\n---\nmy edit\n");
  expect(edited()?.choices?.map((c) => c.label)).toEqual(["Save as a new version in Your skills", "Discard the edits"]);
  expect(runFix(edited()!.choices![0]!)).toEqual({ ok: true, message: "alpha: saved as v2; web uses it" });
  expect(readManifest(project).skills.alpha?.version).toBe(2);
  expect(readFileSync(join(tmp, "home", "library", "alpha", "SKILL.md"), "utf-8")).toContain("my edit");
  expect(libraryOrigins().alpha).toBe(origin); // still where it first came from
  expect(edited()).toBeUndefined();

  writeFileSync(copy, "---\ndescription: d\n---\noops\n");
  expect(runFix(edited()!.choices![1]!)).toEqual({ ok: true, message: "alpha: edits discarded, back to v2" });
  expect(readFileSync(copy, "utf-8")).toContain("my edit");
  const backup = listBackups().find((b) => b.kind === "edit-backup");
  expect(backup && restoreBackup(backup)).toMatchObject({ ok: true });
  expect(readFileSync(copy, "utf-8")).toContain("oops");
});

test("nested skills count for skills loaded twice, but are never linked, imported or tracked from Health", () => {
  setHarnesses(["claude-code", "codex"]);
  const project = join(tmp, "mono");
  skill(join(project, "packages", "web", ".claude", "skills", "alpha"));
  skill(join(project, "packages", "web", ".claude", "skills", "solo"));
  skill(join(tmp, ".claude", "skills", "alpha"));

  const issues = findIssues([project], machineSkills(), new Set());
  expect(issues.find((i) => i.id === "twice:alpha")?.title).toBe("alpha: in mono and also loaded globally");
  // Codex doesn't load them from the root, but a link there would make them repo-wide.
  expect(issues.map((i) => i.id).filter((id) => /^(usable|local|adopt|tidy):(?!global)/.test(id))).toEqual([]);
});

test("usage hints: skills a repo hasn't used, and library skills in no repo; skills newer than the window are left out", () => {
  const project = join(tmp, "web");
  skill(join(tmp, "src", "alpha"));
  skill(join(tmp, "src", "idle"));
  importSkill(join(tmp, "src", "alpha"));
  importSkill(join(tmp, "src", "idle"));
  addSkill(project, "alpha");
  skill(join(project, ".agents", "skills", "team"));
  const library = new Set(["alpha", "idle"]);
  const none = { inProject: () => 0, total: () => 0 };

  // Everything was just added: nothing is "unused in 30 days" yet.
  expect(usageIssues([project], machineSkills(), library, { ...none, days: 30 })).toEqual([]);

  Bun.sleepSync(5); // file times have sub-millisecond precision; "0 days" means added before now
  const issues = usageIssues([project], machineSkills(), library, { ...none, days: 0 });
  expect(issues.map((i) => [i.id, i.title])).toEqual([
    [`unused:${project}`, "web: 2 skills unused in 0 days"],
    ["unused:library", "1 skill in Your skills: in no repo, unused in 0 days"],
  ]);
  // Only what skilllib installed is offered for removal; the repo's own is the team's.
  expect(issues[0]?.choices?.map((c) => c.label)).toEqual(["Remove the 1 skill skilllib installed from web"]);
  expect(runFix(issues[0]!.choices![0]!)).toEqual({ ok: true, message: "web: removed alpha" });
  expect(runFix(issues[1]!.choices![0]!)).toEqual({ ok: true, message: "Deleted 1 skill from Your skills" });
  expect(listBackups().map((b) => [b.name, b.kind])).toEqual([["idle", "trash"]]);

  // A skill `skilllib new` just made has no version yet: judged by its folder's age, so not flagged within the window.
  expect(createSkill("fresh", "d").ok).toBe(true);
  expect(usageIssues([], machineSkills(), new Set(["fresh"]), { ...none, days: 30 })).toEqual([]);

  // Used there: no hint. And without Claude Code there are no transcripts, so no hints at all.
  expect(usageIssues([project], machineSkills(), new Set(), { inProject: () => 1, total: () => 1, days: 0 })).toEqual([]);
  setHarnesses(["codex"]);
  expect(usageIssues([project], machineSkills(), library, { ...none, days: 0 })).toEqual([]);
});

test("Codex's global skills, in ~/.agents/skills and ~/.codex/skills, get a link for Claude Code", () => {
  setHarnesses(["claude-code", "codex"]);
  skill(join(tmp, ".agents", "skills", "shared"));
  skill(join(tmp, ".codex", "skills", "legacy"));
  skill(join(tmp, ".codex", "skills", ".system", "imagegen")); // Codex's bundled skills: not yours
  const loads = () => Object.fromEntries(machineSkills().map((m) => [m.name, m.harnesses]));
  expect(loads()).toEqual({ legacy: ["codex"], shared: ["codex"] });

  // Not kept global: linking makes them load in more places, so it's a choice doctor --fix never makes.
  const issue = findIssues([], machineSkills(), new Set()).find((i) => i.id === "usable:global")!;
  expect(issue.title).toBe("2 global skills not usable by Claude Code");
  expect(issue.fix).toBeUndefined();
  runFix(issue.choices![0]!);
  expect(lstatSync(join(tmp, ".claude", "skills", "legacy")).isSymbolicLink()).toBe(true);
  expect(loads()).toEqual({ legacy: ["claude-code", "codex"], shared: ["claude-code", "codex"] });
  expect(findIssues([], machineSkills(), new Set()).map((i) => i.id)).not.toContain("usable:global");
});

test("a skill you keep global gets the link as a plain fix; another copy by that name already counts", () => {
  setHarnesses(["claude-code", "codex"]);
  skill(join(tmp, ".agents", "skills", "kept"));
  skill(join(tmp, ".agents", "skills", "twin"));
  skill(join(tmp, ".claude", "skills", "twin"));
  setKeepGlobal(["kept"], true);
  const ids = findIssues([], machineSkills(), new Set()).map((i) => i.id);
  expect(ids).toContain("usable:global:kept");
  expect(ids).not.toContain("usable:global");
  findIssues([], machineSkills(), new Set()).find((i) => i.id === "usable:global:kept")!.fix!.run();
  expect(existsSync(join(tmp, ".claude", "skills", "kept", "SKILL.md"))).toBe(true);
});

test("Codex honors CODEX_HOME for its user skills, and reads .codex/skills in a repo", () => {
  process.env.CODEX_HOME = join(tmp, "codex-home");
  setHarnesses(["codex"]);
  skill(join(tmp, "codex-home", "skills", "moved"));
  skill(join(tmp, ".codex", "skills", "stale")); // not read once CODEX_HOME points elsewhere
  expect(machineSkills().map((m) => [m.name, m.harnesses])).toEqual([["moved", ["codex"]], ["stale", []]]);

  const project = join(tmp, "web");
  mkdirSync(join(project, ".git"), { recursive: true });
  skill(join(project, ".codex", "skills", "repo-only"));
  expect(projectStatus(project).find((s) => s.name === "repo-only")!.visibility).toEqual([{ id: "codex", paths: 1 }]);
  delete process.env.CODEX_HOME;
});

test("an empty CODEX_HOME means ~/.codex, never a folder relative to where you run skilllib", () => {
  process.env.CODEX_HOME = "";
  setHarnesses(["codex"]);
  skill(join(tmp, ".codex", "skills", "legacy"));
  expect(machineSkills().map((m) => [m.name, m.harnesses])).toEqual([["legacy", ["codex"]]]);
  delete process.env.CODEX_HOME;
});

test("linking a global skill replaces a broken link in the way, and leaves a different skill alone", () => {
  skill(join(tmp, ".agents", "skills", "x"));
  skill(join(tmp, ".agents", "skills", "y"));
  skill(join(tmp, ".claude", "skills", "y"));
  symlinkSync(join(tmp, "gone"), join(tmp, ".claude", "skills", "x"));
  expect(linkGlobal(join(tmp, ".agents", "skills", "x"), ["claude-code"]).linked).toEqual([join(tmp, ".claude", "skills", "x")]);
  expect(existsSync(join(tmp, ".claude", "skills", "x", "SKILL.md"))).toBe(true);
  expect(linkGlobal(join(tmp, ".agents", "skills", "y"), ["claude-code"])).toEqual({ linked: [], skipped: [join(tmp, ".claude", "skills", "y")] });
});
