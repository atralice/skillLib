import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { librarySkills, projectStatus, type SkillState } from "./library.js";
import { enabledHarnesses, visibleProjects } from "./config.js";
import { gitInfo, relativeTo, type GitState } from "./git.js";
import type { HarnessId } from "./harnesses.js";
import { readManifest } from "./project.js";
import { tildify } from "./output.js";
import { machineSkills, type SourceKind } from "./sources.js";
import { findIssues } from "./health.js";

/*
 * What agents read (`status --json`, `list --json`). Agents pay for every
 * token, so the shapes are compact: skills that share every attribute are
 * grouped (one entry for a repo's 60 committed skills), attributes at their
 * usual value are left out, and descriptions only appear where they're needed
 * to choose (the library).
 */

/**
 * - library: added from your skills with skilllib (pinned in skilllib.json)
 * - repo:    committed to the repo's .agents/skills by the team
 * - local:   in the repo's skill folders, not managed by skilllib
 */
export type ProjectSource = "library" | "repo" | "local";

/** The repo's own skills that share every attribute. */
export type HereGroup = {
  source: ProjectSource;
  skills: string[];
  /** Folder with the real copy, when it isn't .claude/skills. */
  dir?: string;
  version?: number;
  /** Only when it isn't "ok". */
  state?: SkillState;
  /** Newer library version, when there is one. */
  latest?: number;
  git?: GitState;
  /** Only when some of your agents don't load it here. */
  agents?: HarnessId[];
};

export type GlobalGroup = {
  source: SourceKind;
  /** e.g. "railway@claude-plugins-official", "vercel-labs/agent-skills", "~/.claude/skills". */
  from: string;
  agents: HarnessId[];
  skills: string[];
};

/**
 * Problems skilllib found here or in your global skills that share a cause and remedy: a `fix` is a
 * safe repair (`skilllib doctor --fix` runs it); `choices` need the user to decide (skilllib → Health).
 */
export type HereIssue = { problems: string[]; detail: string; fix?: string; choices?: string[] };

export type Here = {
  project: string;
  /** The repo's top-level files and folders (folders end in "/"), so an agent can read the right ones in one step. */
  files: string[];
  agents: HarnessId[];
  skills: HereGroup[];
  global: GlobalGroup[];
  issues: HereIssue[];
  /** Claude Code uses in this repo per skill, when there were any. */
  usesHere?: Record<string, number>;
};

/** Groups items by a key, collecting names. */
function groupBy<T extends { skills: string[] }>(items: [key: string, name: string, make: () => T][]): T[] {
  const groups = new Map<string, T>();
  for (const [key, name, make] of items) {
    const group = groups.get(key) ?? make();
    group.skills.push(name);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Where a global skill comes from, stated once for its whole group. */
function globalFrom(kind: SourceKind, origin: string, path: string): string {
  if (kind === "global") return tildify(path.replace(/[\\/][^\\/]+$/, ""));
  return origin;
}

const SKIP = new Set(["node_modules", "dist", "build", "target", "vendor", "coverage"]);

function topLevel(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => !d.name.startsWith(".") && !SKIP.has(d.name))
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
      .sort()
      .slice(0, 60);
  } catch {
    return [];
  }
}

/** Every skill your agents can use in `root`: the repo's own, then global ones grouped by source. */
export function usableHere(root: string, uses: Map<string, number> = new Map()): Here {
  const agents = enabledHarnesses();
  const git = gitInfo(root);
  const project = projectStatus(root);
  const skills = groupBy<HereGroup>(
    project.map((s) => {
      const loadedBy = s.visibility.filter((v) => v.paths > 0).map((v) => v.id);
      const behind = s.managed && s.latest !== null && s.version !== null && s.latest > s.version;
      const attrs = {
        source: (s.managed ? "library" : s.state.startsWith("repo skill") ? "repo" : "local") as ProjectSource,
        ...(s.location !== ".claude/skills" && { dir: s.location }),
        ...(s.version !== null && { version: s.version }),
        ...(s.state !== "ok" && s.state !== "local only" && !s.state.startsWith("repo skill") && { state: s.state }),
        ...(behind && { latest: s.latest! }),
        ...(git && { git: git.of(relativeTo(root, s.path)) }),
        ...(!sameSet(loadedBy, agents) && { agents: loadedBy }),
      };
      return [JSON.stringify(attrs), s.name, () => ({ ...attrs, skills: [] })];
    }),
  );

  const machine = machineSkills(agents);
  const global = groupBy<GlobalGroup>(
    machine
      .filter((m) => !m.broken && m.harnesses.length > 0)
      .map((m) => {
        const from = globalFrom(m.kind, m.origin, m.path);
        return [`${m.kind}\0${from}\0${m.harnesses.join()}`, m.name, () => ({ source: m.kind, from, agents: m.harnesses, skills: [] })];
      }),
  );
  const issues = new Map<string, HereIssue>();
  for (const i of findIssues([root], machine, new Set(librarySkills().map((l) => l.name)))) {
    const choices = i.choices?.map((c) => c.label);
    const key = `${i.detail}\0${i.fix?.label ?? ""}\0${choices?.join() ?? ""}`;
    const issue = issues.get(key) ?? { problems: [], detail: i.detail, ...(i.fix && { fix: i.fix.label }), ...(choices && { choices }) };
    issue.problems.push(i.title);
    issues.set(key, issue);
  }
  const usesHere = Object.fromEntries([...uses].filter(([, n]) => n > 0));
  return {
    project: tildify(root),
    files: topLevel(root),
    agents,
    skills,
    global,
    issues: [...issues.values()],
    ...(Object.keys(usesHere).length > 0 && { usesHere }),
  };
}

export type Library = {
  /** Library skills the current project already has (names only). */
  inThisProject?: string[];
  /** The rest, with what's needed to choose: description, and the projects that use it. */
  skills: { name: string; description: string; projects?: string[] }[];
};

/** The first sentence of a description, at most 200 characters: enough to choose; `show` has the rest. */
export function firstSentence(description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  const sentence = line.match(/^(.{40,}?[.!?])(?:\s|$)/)?.[1] ?? line;
  return sentence.length > 200 ? sentence.slice(0, 199).trimEnd() + "…" : sentence;
}

/** Your library; inside a project, split into what it has and what it could add. */
export function libraryFor(currentProject: string | null): Library {
  const manifests = visibleProjects().map((p) => ({ name: basename(p), skills: readManifest(p).skills }));
  const here = currentProject ? new Set(projectStatus(currentProject).map((s) => s.name)) : null;
  const all = librarySkills();
  const describe = (s: (typeof all)[number]) => {
    const projects = manifests.filter((m) => s.name in m.skills).map((m) => m.name);
    return { name: s.name, description: firstSentence(s.description), ...(projects.length > 0 && { projects }) };
  };
  if (!here) return { skills: all.map(describe) };
  return { inThisProject: all.filter((s) => here.has(s.name)).map((s) => s.name), skills: all.filter((s) => !here.has(s.name)).map(describe) };
}
