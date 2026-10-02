import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { librarySkills, nestedSkills, projectStatus, type ProjectSkill } from "./library.js";
import { enabledHarnesses, visibleProjects } from "./config.js";
import { gitInfo, relativeTo } from "./git.js";
import { projectHere, readManifest } from "./project.js";
import { tildify } from "./output.js";
import { machineSkills, skillsLoadedIn, type SourceKind } from "./sources.js";
import { findIssues } from "./health.js";
import type { ListJson, StatusGlobalGroup, StatusIssue, StatusJson, StatusSkillGroup } from "./json.js";

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
  // Always "/", like the other source labels, so it reads the same on every OS.
  if (kind === "global" || kind === "skilllib") return tildify(path.replace(/[\\/][^\\/]+$/, "")).replace(/\\/g, "/");
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

/** Every skill your agents can use in `root`: the repo's own, its subfolders', then global ones grouped by source. */
export function usableHere(root: string, uses: Map<string, number> = new Map()): StatusJson {
  const agents = enabledHarnesses();
  // Outside a repo (e.g. a session started in ~), the skill folders here are the global ones: no project skills,
  // and subfolders are just folders.
  const inRepo = projectHere(root) === root;
  // Monorepo packages' own skill folders.
  const nestedHere = inRepo ? nestedSkills(root, { enabled: agents }) : [];
  const git = gitInfo(root, [...new Set(nestedHere.map((s) => s.location))]);
  const group = (list: ProjectSkill[]) =>
    groupBy<StatusSkillGroup>(
      list.map((s) => {
        const loadedBy = s.visibility.filter((v) => v.paths > 0).map((v) => v.id);
        const behind = s.managed && s.latest !== null && s.version !== null && s.latest > s.version;
        const gitState = git?.of(relativeTo(root, s.path));
        // A copy git tracks is the team's wherever it lives (.claude/skills too), as the TUI shows it.
        const repo = !s.managed && (s.state.startsWith("repo skill") || gitState === "committed" || gitState === "changed");
        const usual = s.state === "ok" || s.state === "local only" || (repo && s.state !== "from npx skills");
        // Left out at their usual value: JSON.stringify drops undefined (as a spread would), and tsc checks each name.
        const attrs: Omit<StatusSkillGroup, "skills"> = {
          source: s.managed ? "library" : repo ? "repo" : "local",
          dir: s.location !== ".claude/skills" ? s.location : undefined,
          version: s.version ?? undefined,
          state: usual ? undefined : s.state,
          latest: behind ? s.latest! : undefined,
          git: gitState,
          agents: sameSet(loadedBy, agents) ? undefined : loadedBy,
        };
        return [JSON.stringify(attrs), s.name, () => ({ ...attrs, skills: [] })];
      }),
    );
  const skills = group(inRepo ? projectStatus(root) : []);
  const nested = group(nestedHere);

  const machine = machineSkills(agents);
  // As this repo loads them: its .claude/settings(.local).json can turn a plugin on or off just here.
  // (findIssues takes the machine's skills and applies the repo's settings itself.)
  const loaded = inRepo ? skillsLoadedIn(root, machine, agents) : machine;
  const global = groupBy<StatusGlobalGroup>(
    loaded
      .filter((m) => !m.broken && m.harnesses.length > 0)
      .map((m) => {
        const from = globalFrom(m.kind, m.origin, m.path);
        return [`${m.kind}\0${from}\0${m.harnesses.join()}`, m.name, () => ({ source: m.kind, from, agents: m.harnesses, skills: [] })];
      }),
  );
  const issues = new Map<string, StatusIssue>();
  for (const i of findIssues(inRepo ? [root] : [], machine, new Set(librarySkills().map((l) => l.name)))) {
    const choices = i.choices?.map((c) => c.label);
    const key = `${i.detail}\0${i.fix?.label ?? ""}\0${choices?.join() ?? ""}`;
    const issue = issues.get(key) ?? { problems: [], detail: i.detail, fix: i.fix?.label, choices };
    issue.problems.push(i.title);
    issues.set(key, issue);
  }
  const usesHere = Object.fromEntries([...uses].filter(([, n]) => n > 0));
  return {
    project: tildify(root),
    files: topLevel(root),
    agents,
    skills,
    nested: nested.length > 0 ? nested : undefined,
    global,
    issues: [...issues.values()],
    usesHere: Object.keys(usesHere).length > 0 ? usesHere : undefined,
  };
}

/** The first sentence of a description, at most 200 characters: enough to choose; `show` has the rest. */
export function firstSentence(description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  const sentence = line.match(/^(.{40,}?[.!?])(?:\s|$)/)?.[1] ?? line;
  return sentence.length > 200 ? sentence.slice(0, 199).trimEnd() + "…" : sentence;
}

/** Your library; inside a project, split into what it has and what it could add. */
export function libraryFor(currentProject: string | null): ListJson {
  const manifests = visibleProjects().map((p) => ({ name: basename(p), skills: readManifest(p).skills }));
  const here = currentProject ? new Set(projectStatus(currentProject).map((s) => s.name)) : null;
  const all = librarySkills();
  const describe = (s: (typeof all)[number]): ListJson["skills"][number] => {
    const projects = manifests.filter((m) => s.name in m.skills).map((m) => m.name);
    return { name: s.name, description: firstSentence(s.description), projects: projects.length > 0 ? projects : undefined };
  };
  if (!here) return { skills: all.map(describe) };
  return { inThisProject: all.filter((s) => here.has(s.name)).map((s) => s.name), skills: all.filter((s) => !here.has(s.name)).map(describe) };
}
