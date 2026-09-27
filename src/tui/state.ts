import { basename, join } from "node:path";
import { projectOfFactory } from "../commands.js";
import { librarySkillDir, librarySkills, listBackups, projectStatus, type Backup, type ProjectSkill, type Visibility } from "../library.js";
import { enabledHarnesses, harnessesChosen, readConfig, visibleProjects } from "../config.js";
import type { HarnessId } from "../harnesses.js";
import { findIssues, type Issue } from "../health.js";
import { findProjectRoot, isProjectCandidate } from "../project.js";
import { libraryOrigins, machineSkills, type SourcedSkill } from "../sources.js";
import { readSkillInfo } from "../skills.js";
import { forgetLatest, latestVersion, versionHistory, type Version } from "../versions.js";
export { versionHistory, type Version };
import { scanUsage, summarize } from "../usage.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";

export const USAGE_DAYS = 30;

export type LibraryRow = { name: string; description: string; origin: string; projects: string[]; version: number | null };

export type ProjectRow = {
  name: string;
  /** In this project's .claude/skills (managed or not). */
  installed: boolean;
  /** Present in the library. */
  inLibrary: boolean;
  state: ProjectSkill["state"] | "available";
  description: string;
  /** Managed by skilllib.json (a dependency). */
  managed: boolean;
  version: number | null;
  latest: number | null;
  /** Project folder with the real copy (e.g. ".claude/skills"); "" for library-only rows. */
  location: string;
  /** Folder on disk: the project copy, or the library copy for available rows. */
  path: string;
  /** Which of your harnesses load it here. */
  visibility: Visibility;
};

export type Snapshot = {
  cwdProject: string | null;
  projects: string[];
  /** Skills per project (installed + available from the library). */
  rows: Map<string, ProjectRow[]>;
  library: LibraryRow[];
  machine: SourcedSkill[];
  issues: Issue[];
  backups: Backup[];
  roots: string[];
  /** Harnesses you use (from config, or detected until you choose). */
  harnesses: HarnessId[];
  harnessesChosen: boolean;
};

/** Everything the screens show except usage, read fresh from disk. */
export function loadSnapshot(): Snapshot {
  forgetLatest();
  const cwdRoot = findProjectRoot();
  const cwdProject =
    isProjectCandidate(cwdRoot) && (existsSync(join(cwdRoot, ".git")) || existsSync(join(cwdRoot, "skilllib.json")))
      ? cwdRoot
      : null;
  // Each project's status hashes every skill folder, so compute it once per snapshot.
  const statusCache = new Map<string, ProjectSkill[]>();
  const statusOf = (p: string) => {
    let status = statusCache.get(p);
    if (!status) statusCache.set(p, (status = projectStatus(p)));
    return status;
  };
  // The project you're in first, then projects that have skills, then the rest; each alphabetical.
  const hasSkills = (p: string) => statusOf(p).length > 0;
  const byName = (a: string, b: string) => basename(a).localeCompare(basename(b));
  const others = visibleProjects().filter((p) => p !== cwdProject);
  const projects = [
    ...(cwdProject ? [cwdProject] : []),
    ...others.filter(hasSkills).sort(byName),
    ...others.filter((p) => !hasSkills(p)).sort(byName),
  ];
  const origins = libraryOrigins();
  const machine = machineSkills();
  // Skills imported before origins were recorded: infer from a same-named skill on this machine.
  const inferred = (name: string) => {
    // Only global and skills.sh skills could have been imported; vendor copies can share the name.
    const m = machine.find((s) => s.name === name && !s.broken && s.movable) ?? machine.find((s) => s.name === name && !s.broken);
    return m ? (m.kind === "global" ? "global folder" : `${m.kind}: ${m.origin}`) : "";
  };
  const library = librarySkills().map((s) => ({
    name: s.name,
    description: s.description,
    origin: origins[s.name] ?? inferred(s.name),
    // Managed status entries are the manifest, already read above; no need to re-read every manifest per skill.
    projects: projects.filter((p) => statusOf(p).some((x) => x.managed && x.name === s.name)).sort(),
    version: latestVersion(s.name)?.version ?? null,
  }));
  return {
    cwdProject,
    projects,
    rows: new Map(projects.map((p) => [p, projectRows(p, library, statusOf(p))])),
    library,
    machine,
    issues: findIssues(projects, machine, new Set(library.map((l) => l.name)), statusOf),
    backups: listBackups(),
    roots: readConfig().roots,
    harnesses: enabledHarnesses(),
    harnessesChosen: harnessesChosen(),
  };
}

/** A project's skills plus the library skills it could add. */
export function projectRows(root: string, library: LibraryRow[], status: ProjectSkill[] = projectStatus(root)): ProjectRow[] {
  const byName = new Map(status.map((s) => [s.name, s]));
  const libraryNames = new Set(library.map((l) => l.name));
  const installed = status.map(
    (s): ProjectRow => ({
      name: s.name,
      installed: true,
      inLibrary: libraryNames.has(s.name),
      state: s.state,
      managed: s.managed,
      version: s.version,
      latest: s.latest,
      location: s.location,
      path: s.path,
      visibility: s.visibility,
      description:
        library.find((l) => l.name === s.name)?.description ??
        readSkillInfo(s.path).description,
    }),
  );
  const available = library
    .filter((l) => !byName.has(l.name))
    .map(
      (l): ProjectRow => ({
        name: l.name,
        installed: false,
        inLibrary: true,
        state: "available",
        description: l.description,
        managed: false,
        version: null,
        latest: l.version,
        location: "",
        path: librarySkillDir(l.name),
        visibility: [],
      }),
    );
  // Alphabetical, not installed-first, so toggling a row doesn't move it out from under the cursor.
  return [...installed, ...available].sort((a, b) => a.name.localeCompare(b.name));
}

export type Usage = {
  /** Uses per skill across all sessions. */
  total: Map<string, number>;
  /** Uses per project root, per skill. */
  byProject: Map<string, Map<string, number>>;
  /** `inProject`: the skill was a project skill in a session that used it. */
  rows: { skill: string; uses: number; lastUsed: string; projects: string[]; inProject: boolean }[];
};

export async function loadUsage(projects: string[]): Promise<Usage> {
  const projectOf = projectOfFactory(projects);
  const uses = await scanUsage(USAGE_DAYS);
  const summaries = summarize(uses, projectOf);
  const projectSkill = new Set(
    uses
      .filter((u) => u.cwd && (existsSync(join(u.cwd, ".claude", "skills", u.skill)) || existsSync(join(u.cwd, ".agents", "skills", u.skill))))
      .map((u) => u.skill),
  );
  const byProject = new Map<string, Map<string, number>>();
  for (const use of uses) {
    const root = projectOf(use.cwd);
    if (!root) continue;
    const counts = byProject.get(root) ?? new Map<string, number>();
    counts.set(use.skill, (counts.get(use.skill) ?? 0) + 1);
    byProject.set(root, counts);
  }
  return {
    total: new Map(summaries.map((s) => [s.skill, s.uses])),
    byProject,
    rows: summaries.map((s) => ({
      skill: s.skill,
      uses: s.uses,
      lastUsed: s.lastUsed.slice(0, 10),
      projects: [...s.projects].map((p) => basename(p)),
      inProject: projectSkill.has(s.skill),
    })),
  };
}

export type Preview = { description: string; body: string[]; files: number };

/** Description and the first lines of SKILL.md's body, for the preview panel. */
export function readPreview(dir: string): Preview | null {
  const path = join(dir, "SKILL.md");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  let files = 0;
  try {
    files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
  } catch {
    files = 0;
  }
  return { description: readSkillInfo(dir).description, body, files };
}
