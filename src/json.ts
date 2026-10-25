/*
 * The shapes `skilllib <command> --json` prints, for scripts that read them:
 *
 *   import type { StatusJson } from "skilllib";
 *   const status: StatusJson = JSON.parse(execFileSync("skilllib", ["status", "--json"], { encoding: "utf-8" }));
 *
 * This file is the package's public types entry (types only: skilllib has no
 * runtime API), so everything it exports is public: a field is only removed or
 * changed in a major version. The commands print through `json(command, data)`
 * (output.ts), which takes these types, and build each object as its type, so
 * tsc flags a field these types don't declare.
 */
import type { AgentSkillState } from "./agentSkill.js";
import type { GitState } from "./git.js";
import type { HarnessId } from "./harnesses.js";
import type { Change, SkillState } from "./library.js";
import type { SourceKind } from "./sources.js";

export type { AgentSkillState, GitState, HarnessId, SkillState, SourceKind };

/*
 * What agents read (`status --json`, `list --json`). Agents pay for every
 * token, so the shapes are compact: skills that share every attribute are
 * grouped (one entry for a repo's 60 committed skills), attributes at their
 * usual value are left out, and descriptions only appear where they're needed
 * to choose (the library).
 */

/**
 * - library: added from your skills with skilllib (pinned in skilllib.json)
 * - repo:    the team's: committed to git (any skill folder), or in .agents/skills or .grok/skills
 * - local:   only on this machine: not committed, not managed by skilllib
 */
export type ProjectSource = "library" | "repo" | "local";

/** The repo's own skills (or its subfolders') that share every attribute. */
export type StatusSkillGroup = {
  source: ProjectSource;
  skills: string[];
  /** Folder with the real copy, when it isn't .claude/skills. */
  dir?: string;
  version?: number;
  /** Only when it isn't the usual one: "ok", "local only", or a repo skill's. */
  state?: SkillState;
  /** Newer library version, when there is one. */
  latest?: number;
  git?: GitState;
  /** Only when some of your agents don't load it here. */
  agents?: HarnessId[];
  /** In your personal pins (~/.skilllib/pins): only on your machines, kept out of git. */
  personal?: true;
};

/** Global skills that come from the same place and load in the same agents. */
export type StatusGlobalGroup = {
  source: SourceKind;
  /** e.g. "railway@claude-plugins-official", "vercel-labs/agent-skills", "~/.claude/skills". */
  from: string;
  agents: HarnessId[];
  skills: string[];
};

/**
 * Problems skilllib found here or in your global skills that share a cause and remedy: a `fix` is a
 * safe repair (`skilllib doctor --fix` runs it); `choices` need the user to decide.
 * `skilllib apply <id> [choice]` applies either, one problem at a time.
 */
export type StatusIssue = {
  problems: string[];
  /** One per problem, in the same order: what `skilllib apply` takes. */
  ids: string[];
  detail: string;
  fix?: string;
  choices?: string[];
};

/** `skilllib status --json`: everything your agents can use in this repo. */
export type StatusJson = {
  project: string;
  /** The repo's top-level files and folders (folders end in "/"), so an agent can read the right ones in one step. */
  files: string[];
  agents: HarnessId[];
  skills: StatusSkillGroup[];
  /** Skills in subfolders (monorepo packages), always with their `dir`: agents load them only when they work there. */
  nested?: StatusSkillGroup[];
  /** Skills that load in every repo, as this one loads them (its .claude/settings can turn a plugin on or off). */
  global: StatusGlobalGroup[];
  issues: StatusIssue[];
  /** Claude Code uses in this repo per skill, when there were any. */
  usesHere?: Record<string, number>;
};

/** `skilllib list --json`: your library; inside a repo, split into what it has and what it could add. */
export type ListJson = {
  /** Library skills the current project already has (names only). */
  inThisProject?: string[];
  /** The rest, with what's needed to choose: description, and the projects that use it. */
  skills: { name: string; description: string; projects?: string[] }[];
};

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
  /** Where an installed, updated or reset skill now is: the real copy first, then its links. */
  dirs?: string[];
  /** Pinned in your personal pins, kept out of git: nothing to commit. */
  personal?: true;
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
export type DoctorJson = {
  id: string;
  severity: "problem" | "suggestion";
  title: string;
  detail: string;
  /** A safe repair; `doctor --fix` runs it. */
  fix?: string;
  /**
   * Fixes that need a decision: `skilllib apply <id> <n>` runs the nth (from 1). An issue that spans repos can list
   * other choices inside one (status there), and then apply takes only the label: `skilllib apply <id> "<label>"`.
   */
  choices?: string[];
  /** With --fix: what running `fix` did. */
  fixed?: { ok: boolean; message: string };
}[];

/** Any command with --json that fails: it exits 1, and this is the one line on stdout. */
export type ErrorJson = { error: string };

/** `skilllib apply <issue-id> [choice] --json` */
export type ApplyJson = { id: string; applied: string; ok: boolean; message: string };

/** `skilllib global move <name>... --to <repo>... --json`: one entry per skill. */
export type GlobalMoveJson = {
  skill: string;
  /** Added to every repo and no longer global. When false, it still loads globally and `reason` says why. */
  moved: boolean;
  reason?: string;
  /** Links in a repo's packages now pointing at nothing (the repo's own copy serves them): remove them. */
  left?: string[];
  projects: { project: string; path: string; change: ChangeJson }[];
}[];

/** `skilllib usage [--days N] --json` */
export type UsageJson = {
  usageDays: number;
  source: "Claude Code transcripts";
  skills: { skill: string; uses: number; lastUsed: string; projects: string[]; inLibrary: boolean }[];
  unusedLibrarySkills: string[];
};

/** `skilllib search --json` */
export type SearchJson = { name: string; source: string; skillId: string; installs: number }[];

/** `skilllib install --json` */
export type InstallJson = {
  name: string;
  source: string;
  status: "added" | "updated" | "unchanged" | "exists" | "skipped";
  reason?: string;
  project?: Change;
  /** Global folders written, when `--global`. */
  global?: string[];
}[];

/** `skilllib agent-skill [install|remove] --json` */
export type AgentSkillJson = {
  state: AgentSkillState;
  /** Where it's installed (or would be). Not set after `remove`. */
  dirs?: string[];
  /** After `remove`: the folders it was removed from. */
  removed?: string[];
};
