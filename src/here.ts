import { basename } from "node:path";
import { librarySkills, projectStatus, type SkillState } from "./library.js";
import { enabledHarnesses, visibleProjects } from "./config.js";
import { gitInfo, relativeTo, type GitState } from "./git.js";
import type { HarnessId } from "./harnesses.js";
import { readManifest } from "./project.js";
import { readSkillInfo } from "./skills.js";
import { libraryOrigins, machineSkills, type SourceKind } from "./sources.js";
import { latestVersion } from "./versions.js";

/**
 * Where a skill an agent can use here comes from:
 * - library: added from your skills with skilllib (pinned in skilllib.json)
 * - repo:    committed to the repo's .agents/skills by the team
 * - local:   a folder in the repo's skill folders that skilllib doesn't manage
 * - global, skills.sh, claude.ai, plugin, built-in: loaded in every repo
 */
export type HereSource = "library" | "repo" | "local" | SourceKind;

export type HereSkill = {
  name: string;
  description: string;
  source: HereSource;
  /** "project" skills load only in this repo; "global" ones load in every repo. */
  scope: "project" | "global";
  /** Plain-language detail, e.g. "vercel-labs/agent-skills" or "railway@claude-plugins-official". */
  origin: string;
  path: string;
  /** Your agents that load it here. */
  loadedBy: HarnessId[];
  /** Global skills only you (not a vendor) can move or delete. */
  yours: boolean;
  /** Project skills: skilllib's status for it, installed and newest version, git state. */
  state?: SkillState;
  version?: number | null;
  latest?: number | null;
  git?: GitState | null;
};

export type Here = { project: { name: string; path: string }; agents: HarnessId[]; skills: HereSkill[] };

/** Every skill your agents can use in `root`: the repo's own, then everything loaded globally. */
export function usableHere(root: string): Here {
  const agents = enabledHarnesses();
  const git = gitInfo(root);
  const origins = libraryOrigins();
  const project = projectStatus(root).map(
    (s): HereSkill => ({
      name: s.name,
      description: readSkillInfo(s.path).description,
      source: s.managed ? "library" : s.state.startsWith("repo skill") ? "repo" : "local",
      scope: "project",
      origin: s.managed ? (origins[s.name] ? `your skills (from ${origins[s.name]})` : "your skills") : s.location,
      path: s.path,
      loadedBy: s.visibility.filter((v) => v.paths > 0).map((v) => v.id),
      yours: true,
      state: s.state,
      version: s.version,
      latest: s.latest,
      git: git ? git.of(relativeTo(root, s.path)) : null,
    }),
  );
  const global = machineSkills(agents)
    .filter((m) => !m.broken && m.harnesses.length > 0)
    .map(
      (m): HereSkill => ({
        name: m.name,
        description: m.description,
        source: m.kind,
        scope: "global",
        origin: m.origin,
        path: m.path,
        loadedBy: m.harnesses,
        yours: m.movable,
      }),
    );
  return { project: { name: basename(root), path: root }, agents, skills: [...project, ...global] };
}

export type LibraryEntry = {
  name: string;
  description: string;
  path: string;
  latest: number | null;
  origin: string;
  /** Project names that added it. */
  projects: string[];
  /** Whether the current project already has a skill with this name (null outside a project). */
  inThisProject: boolean | null;
};

/** Your library, with where each skill is installed. */
export function libraryEntries(currentProject: string | null): LibraryEntry[] {
  const origins = libraryOrigins();
  const manifests = visibleProjects().map((p) => ({ name: basename(p), skills: readManifest(p).skills }));
  const here = currentProject ? new Set(projectStatus(currentProject).map((s) => s.name)) : null;
  return librarySkills().map((s) => ({
    name: s.name,
    description: s.description,
    path: s.dir,
    latest: latestVersion(s.name)?.version ?? null,
    origin: origins[s.name] ?? "",
    projects: manifests.filter((m) => s.name in m.skills).map((m) => m.name),
    inThisProject: here ? here.has(s.name) : null,
  }));
}
