import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { skilllibHome, MANIFEST_FILE } from "./paths.js";
import { ALL_PROJECT_DIRS, HARNESSES, type HarnessId } from "./harnesses.js";
import { isProjectCandidate, knownProjects, rememberProjects } from "./project.js";
import { skillDirsIn } from "./skills.js";

/**
 * ~/.skilllib/config.json
 * - roots: folders that contain your projects; scanned for git repos
 * - hidden: projects you don't want listed
 * - harnesses: the coding agents you use; decides where skills get installed.
 *   Unset until you choose (first run asks).
 * - agentsDirOk: projects where you allowed writing links into a git-tracked .agents/skills
 * - keepGlobal: names of your global skills you chose to keep global; skilllib stops nagging about them
 */
export type Config = { roots: string[]; hidden: string[]; harnesses?: HarnessId[]; agentsDirOk?: string[]; keepGlobal?: string[] };

function configFile(): string {
  return join(skilllibHome(), "config.json");
}

export function readConfig(): Config {
  try {
    const data = JSON.parse(readFileSync(configFile(), "utf-8")) as Partial<Config>;
    return { ...data, roots: data.roots ?? [], hidden: data.hidden ?? [] };
  } catch {
    return { roots: [], hidden: [] };
  }
}

function writeConfig(config: Config) {
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}

export function expandHome(path: string): string {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}

export function addRoot(path: string): string {
  const root = expandHome(path);
  const config = readConfig();
  if (!config.roots.includes(root)) writeConfig({ ...config, roots: [...config.roots, root].sort() });
  return root;
}

export function removeRoot(path: string): boolean {
  const root = expandHome(path);
  const config = readConfig();
  if (!config.roots.includes(root)) return false;
  writeConfig({ ...config, roots: config.roots.filter((r) => r !== root) });
  return true;
}

export function setHidden(project: string, hidden: boolean) {
  const config = readConfig();
  const rest = config.hidden.filter((h) => h !== project);
  writeConfig({ ...config, hidden: hidden ? [...rest, project].sort() : rest });
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "vendor", "target", "Library", "Applications", "Pictures", "Music", "Movies"]);

/** Git repos and folders with skills under `dir`. Doesn't descend into a repo once found. */
export function findProjects(dir: string, depth = 4): string[] {
  if (depth < 0 || !existsSync(dir)) return [];
  if (isProjectCandidate(dir)) {
    const isRepo = existsSync(join(dir, ".git"));
    const hasSkills = ALL_PROJECT_DIRS.some((d) => skillDirsIn(join(dir, d)).length > 0) || existsSync(join(dir, MANIFEST_FILE));
    if (isRepo || hasSkills) return [dir];
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_DIRS.has(d.name))
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
  return entries.flatMap((e) => findProjects(e, depth - 1));
}

/** Scans every configured root and remembers what it finds. Returns the full visible project list. */
export function discoverProjects(): string[] {
  const { roots } = readConfig();
  rememberProjects(roots.flatMap((r) => findProjects(r)));
  return visibleProjects();
}

export function visibleProjects(): string[] {
  const hidden = new Set(readConfig().hidden);
  return knownProjects().filter((p) => !hidden.has(p));
}

/** Harnesses you use. Before you choose, the ones installed on this machine. */
export function enabledHarnesses(): HarnessId[] {
  return readConfig().harnesses ?? HARNESSES.filter((h) => h.installed()).map((h) => h.id);
}

export function harnessesChosen(): boolean {
  return readConfig().harnesses !== undefined;
}

export function setHarnesses(ids: HarnessId[]) {
  writeConfig({ ...readConfig(), harnesses: HARNESSES.map((h) => h.id).filter((id) => ids.includes(id)) });
}

/** Remembers that you allowed skilllib to add links in this project's git-tracked skill folders. */
export function allowTrackedLinks(root: string) {
  const config = readConfig();
  writeConfig({ ...config, agentsDirOk: [...new Set([...(config.agentsDirOk ?? []), root])].sort() });
}

/** Global skills you marked as global on purpose. */
export function keptGlobal(): Set<string> {
  return new Set(readConfig().keepGlobal ?? []);
}

/** Marks (or unmarks) skills as global on purpose. Only records the decision; no files change. */
export function setKeepGlobal(names: string[], keep: boolean) {
  const kept = keptGlobal();
  for (const n of names) {
    if (keep) kept.add(n);
    else kept.delete(n);
  }
  writeConfig({ ...readConfig(), keepGlobal: [...kept].sort() });
}
