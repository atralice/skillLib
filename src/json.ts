/*
 * The shapes `skilllib <command> --json` prints, for scripts that read them:
 *
 *   import type { StatusJson } from "skilllib";
 *   const status: StatusJson = JSON.parse(execFileSync("skilllib", ["status", "--json"], { encoding: "utf-8" }));
 *
 * This file is the package's public types entry (types only: skilllib has no
 * runtime API). commands.ts checks every --json result against these with
 * `satisfies`, so they can't drift from what the CLI prints.
 */
import type { AgentSkillState } from "./agentSkill.js";
import type { Issue } from "./health.js";
import type { Library } from "./here.js";
import type { Change, SkillState } from "./library.js";

export type { AgentSkillState } from "./agentSkill.js";
export type { GitState } from "./git.js";
export type { HarnessId } from "./harnesses.js";
export type { GlobalGroup, Here, HereGroup, HereIssue, Library, ProjectSource } from "./here.js";
export type { SkillState } from "./library.js";
export type { SourceKind } from "./sources.js";

/** `skilllib status --json`: everything your agents can use in this repo. */
export type { Here as StatusJson } from "./here.js";

/** `skilllib list --json`: your library; inside a repo, split into what it has and what it could add. */
export type ListJson = Library;

/** `skilllib show <name> --json` */
export type ShowJson = {
  name: string;
  description: string;
  path: string;
  /** Newest version in your library. */
  latest: number | null;
  /** Where it came from, e.g. a plugin or an `npx skills` repo; "" when unknown. */
  origin: string;
  /** Projects that have it in their skilllib.json. */
  projects: string[];
  /** The whole SKILL.md. */
  skillMd: string;
};

/** `skilllib projects --json` */
export type ProjectsJson = {
  name: string;
  path: string;
  skills: { name: string; managed: boolean; state: SkillState; version: number | null; latest: number | null }[];
}[];

/** One skill that `add`, `remove`, `sync` or `update` changed or skipped. */
export type ChangeJson = Change & {
  /** Where an installed or updated skill now is: the real copy first, then its links. */
  dirs?: string[];
};

/** `skilllib add|remove --json`, and `sync|update --json` without --all. */
export type ChangesJson = ChangeJson[];

/** `skilllib sync|update --all --json`: the changes in each project. */
export type AllChangesJson = { project: string; path: string; changes: ChangeJson[] }[];

/** `skilllib outdated [--all] --json` */
export type OutdatedJson = { project: string; path: string; skill: string; installed: number; latest: number; state: SkillState }[];

/** `skilllib import <dir>... --json` */
export type ImportJson = {
  path: string;
  /** Missing when the folder has no SKILL.md. */
  name?: string;
  status: "added" | "updated" | "unchanged" | "exists" | "no SKILL.md";
}[];

/** `skilllib doctor [--fix] --json` */
export type DoctorJson = (Pick<Issue, "id" | "severity" | "title" | "detail"> & {
  /** A safe repair; `doctor --fix` runs it. */
  fix?: string;
  /** Fixes that need a decision (skilllib → Health). */
  choices?: string[];
  /** With --fix: what running `fix` did. */
  fixed?: { ok: boolean; message: string };
})[];

/** `skilllib usage [--days N] --json` */
export type UsageJson = {
  usageDays: number;
  source: "Claude Code transcripts";
  skills: { skill: string; uses: number; lastUsed: string; projects: string[]; inLibrary: boolean }[];
  unusedLibrarySkills: string[];
};

/** `skilllib agent-skill [install|remove] --json` */
export type AgentSkillJson = {
  state: AgentSkillState;
  /** Where it's installed (or would be). Not set after `remove`. */
  dirs?: string[];
  /** After `remove`: the folders it was removed from. */
  removed?: string[];
};
