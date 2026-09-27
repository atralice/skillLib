import { basename, join } from "node:path";
import { addSkill, importSkill, projectStatus, syncProject, unloadGlobal, updateProject, type ProjectSkill } from "./library.js";
import { HARNESSES } from "./harnesses.js";
import { projectSkillsDir } from "./project.js";
import type { SourcedSkill } from "./sources.js";

export type Issue = {
  id: string;
  severity: "problem" | "suggestion";
  title: string;
  detail: string;
  /** One-key fix; returns a message describing what happened. */
  fix?: { label: string; run: () => string };
};

/**
 * Things worth fixing across the machine: broken links, skills loaded twice,
 * projects behind the library, and skills that only live in one project.
 */
export function findIssues(
  projects: string[],
  machine: SourcedSkill[],
  libraryNames: Set<string>,
  statusOf: (root: string) => ProjectSkill[] = projectStatus,
): Issue[] {
  const issues: Issue[] = [];

  for (const skill of machine.filter((m) => m.broken)) {
    issues.push({
      id: `broken:${skill.name}`,
      severity: "problem",
      title: `${skill.name}: broken link in ${skill.path.replace(/\/[^/]+$/, "").replace(/^\/Users\/[^/]+/, "~")}`,
      detail: "It points at a folder that no longer exists, so it loads nothing.",
      fix: {
        label: "Remove the link",
        run: () => {
          const r = unloadGlobal(skill.path);
          return r.ok ? `Removed broken link ${skill.name}` : `${skill.name}: ${r.reason}`;
        },
      },
    });
  }

  // Loaded twice: one harness sees two different copies with the same name.
  const loaded = machine.filter((m) => !m.broken);
  const byName = new Map<string, SourcedSkill[]>();
  for (const m of loaded) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  for (const [name, copies] of byName) {
    const harnesses = HARNESSES.filter((h) => copies.filter((c) => c.harnesses.includes(h.id)).length > 1).map((h) => h.name);
    if (harnesses.length === 0) continue;
    const movable = copies.find((c) => c.movable);
    issues.push({
      id: `dup:${name}`,
      severity: "problem",
      title: `${name}: loaded twice in ${harnesses.join(" and ")}`,
      detail: copies.map((c) => `${c.kind} (${c.origin})`).join(" and "),
      fix:
        movable && copies.some((c) => !c.movable)
          ? {
              label: "Keep the vendor copy, stop loading yours globally",
              run: () => {
                if (!libraryNames.has(name)) importSkill(movable.path);
                const r = unloadGlobal(movable.path, movable.links);
                return r.ok ? `${name} now loads once` : `${name}: ${r.reason}`;
              },
            }
          : undefined,
    });
  }

  const globalNames = new Set(loaded.map((m) => m.name));
  for (const root of projects) {
    const where = basename(root);
    const status = statusOf(root);
    const behind = status.filter((s) => s.state === "update available" || s.state === "folder missing");
    if (behind.length > 0) {
      issues.push({
        id: `sync:${root}`,
        severity: "problem",
        title: `${where}: ${behind.length} skill${behind.length === 1 ? "" : "s"} out of date`,
        detail: behind.map((s) => s.name).join(", "),
        fix: {
          label: "Sync the project",
          run: () => {
            const changes = syncProject(root);
            return `${where}: ${changes.filter((c) => c.action !== "skipped").length} updated`;
          },
        },
      });
    }
    for (const s of status) {
      if (s.state === "local only") {
        issues.push({
          id: `local:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name}: only exists in ${where}`,
          detail: "Import it into the library to reuse it in other projects and keep it backed up.",
          fix: {
            label: "Import into the library",
            run: () => {
              importSkill(join(projectSkillsDir(root), s.name));
              addSkill(root, s.name);
              return `${s.name} imported and tracked in ${where}`;
            },
          },
        });
      } else if (s.state === "untracked copy of library skill") {
        issues.push({
          id: `adopt:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} isn't tracked`,
          detail: "It's identical to the library copy; track it so future library changes reach it.",
          fix: { label: "Track it", run: () => `${addSkill(root, s.name).name} tracked in ${where}` },
        });
      }
      if (globalNames.has(s.name) && s.managed) {
        issues.push({
          id: `twice:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name}: in ${where} and also loaded globally`,
          detail: "The project copy is enough; the global one loads it in every other project too.",
          fix: machine.some((m) => m.name === s.name && m.movable)
            ? {
                label: "Stop loading it globally",
                run: () => {
                  const g = machine.find((m) => m.name === s.name && m.movable)!;
                  if (!libraryNames.has(s.name)) importSkill(g.path);
                  const r = unloadGlobal(g.path, g.links);
                  return r.ok ? `${s.name} no longer loads globally` : `${s.name}: ${r.reason}`;
                },
              }
            : undefined,
        });
      }
    }
  }

  return issues;
}
