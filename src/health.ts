import { basename, join } from "node:path";
import { enabledHarnesses, keptGlobal } from "./config.js";
import { gitInfo } from "./git.js";
import { HARNESSES, type HarnessId } from "./harnesses.js";
import { addSkill, importSkill, projectStatus, removeSkill, syncProject, unloadGlobal, type ProjectSkill } from "./library.js";
import { claudePlugins, cursorPluginSkills, removePlugin } from "./plugins.js";
import { projectSkillsDir } from "./project.js";
import type { SourcedSkill } from "./sources.js";
import { applyTidy, copyLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type Conflict, type TidyPlan } from "./tidy.js";

/** One way to fix an issue; returns a message describing what happened. */
export type Choice = { label: string; hint?: string; run: () => string };

export type Issue = {
  id: string;
  severity: "problem" | "suggestion";
  title: string;
  detail: string;
  /** One-key fix, safe to run unasked (`doctor --fix` does). */
  fix?: Choice;
  /** Fixes that need a decision; the person picks one. Never set together with `fix`. */
  choices?: Choice[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const agentNames = (ids: HarnessId[]) => ids.map((id) => HARNESSES.find((h) => h.id === id)!.name).join(", ");

/** Differing copies of one skill: which agent runs which, and a choice per copy that can win. */
function conflictIssue(c: Conflict): Issue {
  const where = c.root ? basename(c.root) : "your global folders";
  const winners = c.managed ? c.copies.filter((x) => x.dir === c.managed) : c.copies;
  return {
    id: `conflict:${c.root ?? "global"}:${c.name}`,
    severity: "problem",
    title: `${c.name} in ${where}: the copies differ`,
    detail: `Your agents run different versions: ${c.copies
      .map((x) => `${copyLabel(c, x.dir)}${x.runs.length ? ` (${agentNames(x.runs)})` : ""}`)
      .join(" vs ")}. Keep one; the others become links to it and are restorable from Health.`,
    choices: winners.map((x) => ({
      label: `Keep the ${copyLabel(c, x.dir)} copy`,
      hint: x.dir === c.managed ? "skilllib's version" : "the others become links to it",
      run: () => {
        const keep = { [c.name]: x.dir };
        const plan = (c.root ? planProjectTidy(c.root, { keep }) : planGlobalTidy({ keep })).plans.find((p) => p.name === c.name);
        if (plan) applyTidy(plan, { git: "go" });
        return `${c.name}: kept the ${copyLabel(c, x.dir)} copy`;
      },
    })),
  };
}

function applyAll(plans: TidyPlan[], git: "keep" | "go"): { skills: number; held: number } {
  const results = plans.map((p) => applyTidy(p, { git }));
  return { skills: results.filter((r) => r.applied.length).length, held: results.reduce((n, r) => n + r.held.length, 0) };
}

/**
 * Things worth fixing across the machine: broken links, skills loaded twice
 * (duplicate copies, plugins that duplicate your skills), copies that differ,
 * projects behind the library, and skills that only live in one project.
 */
export function findIssues(
  projects: string[],
  machine: SourcedSkill[],
  libraryNames: Set<string>,
  statusOf: (root: string) => ProjectSkill[] = projectStatus,
): Issue[] {
  const issues: Issue[] = [];
  const statuses = new Map(projects.map((root) => [root, statusOf(root)]));

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

  // Your global skill and a vendor copy (claude.ai, a built-in) loaded by the same agent. Your skill wins,
  // but only the vendor can turn theirs off. Plugins get their own issue; two copies of yours are tidy's job.
  const loaded = machine.filter((m) => !m.broken);
  const byName = new Map<string, SourcedSkill[]>();
  for (const m of loaded) if (m.kind !== "plugin") byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  for (const [name, copies] of byName) {
    if (copies.every((c) => c.movable) || !copies.some((c) => c.movable)) continue;
    const harnesses = HARNESSES.filter((h) => copies.filter((c) => c.harnesses.includes(h.id)).length > 1).map((h) => h.name);
    if (harnesses.length === 0) continue;
    const vendor = copies.filter((c) => !c.movable);
    issues.push({
      id: `dup:${name}`,
      severity: "problem",
      title: `${name}: loaded twice in ${harnesses.join(" and ")}`,
      detail: `${copies.map((c) => `${c.kind} (${c.origin})`).join(" and ")}. Your skill wins: turn the ${vendor.map((c) => c.kind).join(" and ")} copy off at its source${vendor.some((c) => c.kind === "claude.ai") ? " (claude.ai → Settings → Skills)" : ""}.`,
    });
  }

  // Plugins that duplicate your skills: your skill wins, the plugin goes.
  const loadedYours = new Set([...loaded.filter((m) => m.movable).map((m) => m.name), ...[...statuses.values()].flat().map((s) => s.name)]);
  const yours = new Set([...libraryNames, ...loadedYours]);
  for (const plugin of claudePlugins(machine)) {
    const dupes = plugin.skills.map((p) => basename(p)).filter((n) => yours.has(n));
    if (!dupes.length) continue;
    const others = plugin.skills.length - dupes.length;
    const pluginName = plugin.id.split("@")[0]!;
    const remove: Choice = {
      label: `Remove the plugin ${plugin.id}`,
      hint: plugin.extras.length ? `also removes its ${plugin.extras.join(", ")}` : "restorable from Health",
      run: () => removePlugin(plugin, "delete").message,
    };
    const off: Choice = { label: `Turn the plugin ${plugin.id} off`, hint: "stays installed", run: () => removePlugin(plugin, "off").message };
    const notLoaded = dupes.filter((n) => !loadedYours.has(n));
    issues.push({
      id: `plugin:${plugin.id}`,
      severity: notLoaded.length === dupes.length ? "suggestion" : "problem",
      title: `${dupes.join(", ")}: also in the Claude Code plugin ${plugin.id}`,
      detail: [
        notLoaded.length < dupes.length ? `Claude Code loads both (the plugin's as /${pluginName}:${dupes[0]}). Your skill wins.` : "",
        notLoaded.length
          ? `Your ${notLoaded.join(", ")} ${notLoaded.length === 1 ? "is" : "are"} only in Your skills, not installed anywhere: once the plugin is gone, add ${notLoaded.length === 1 ? "it" : "them"} where you need ${notLoaded.length === 1 ? "it" : "them"}.`
          : "",
        others ? `The plugin's other ${plural(others, "skill")} are copied into Your skills first, so nothing is lost.` : "",
        plugin.extras.length
          ? `It also brings ${plugin.extras.join(", ")}: ${plugin.synced ? "turning it off pauses those" : "removing it drops those, turning it off pauses them"}.`
          : "",
        plugin.synced ? "It's synced from claude.ai, so it can only be turned off here." : "",
      ]
        .filter(Boolean)
        .join(" "),
      choices: plugin.synced ? [off] : plugin.extras.length ? [off, remove] : [remove, off],
    });
  }

  // Cursor plugins can't be read or changed from outside Cursor: report them.
  if (enabledHarnesses().includes("cursor")) {
    const byPlugin = new Map<string, string[]>();
    for (const s of cursorPluginSkills().filter((x) => loadedYours.has(x.name))) byPlugin.set(s.plugin, [...(byPlugin.get(s.plugin) ?? []), s.name]);
    for (const [plugin, names] of byPlugin) {
      issues.push({
        id: `cursor-plugin:${plugin}`,
        severity: "suggestion",
        title: `${names.join(", ")}: also in the Cursor plugin ${plugin}`,
        detail: `Cursor lists both copies when that plugin is on. Your skill wins: turn the plugin off in Cursor (Settings → Plugins).`,
      });
    }
  }

  // Your global folders: identical copies become one copy plus links.
  const global = planGlobalTidy();
  if (global.plans.length) {
    issues.push({
      id: "tidy:global",
      severity: "suggestion",
      title: `${plural(global.plans.length, "global skill")} with duplicate copies`,
      detail: `${global.plans.map((p) => p.name).join(", ")}: each keeps one copy (in ~/.agents/skills when there's one) and the others become links. Restorable from Health.`,
      fix: {
        label: "Keep one copy of each",
        run: () => `${plural(applyAll(global.plans, "go").skills, "global skill")} now have one copy`,
      },
    });
  }
  issues.push(...global.conflicts.map(conflictIssue));

  const kept = keptGlobal();
  const globalNames = new Set(loaded.filter((m) => m.kind !== "plugin").map((m) => m.name));
  for (const root of projects) {
    const where = basename(root);
    const status = statuses.get(root)!;
    const behind = status.filter((s) => s.state === "update available" || s.state === "folder missing");
    if (behind.length > 0) {
      issues.push({
        id: `sync:${root}`,
        severity: "problem",
        title: `${where}: ${plural(behind.length, "skill")} out of date`,
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

    // One real copy per skill, plus only the links your agents need.
    const tidy = planProjectTidy(root);
    if (tidy.plans.length) {
      const git = gitInfo(root);
      const visible = tidy.plans.flatMap((p) => gitVisibleSteps(p, git).map((s) => describeStep(s, root)));
      const run = (mode: "keep" | "go") => () => {
        const r = applyAll(tidy.plans, mode);
        return `${where}: tidied ${plural(r.skills, "skill")}${r.held ? `; left ${plural(r.held, "change")} git would see` : ""}`;
      };
      issues.push({
        id: `tidy:${root}`,
        severity: "suggestion",
        title: `${where}: ${plural(tidy.plans.length, "skill")} with extra copies or links`,
        detail:
          tidy.plans.map((p) => `${p.name}: ${p.steps.map((s) => describeStep(s, root)).join(", ")}`).join(" · ") +
          (visible.length ? `. Git would see ${plural(visible.length, "of these change")}: ${visible.join(", ")}.` : ". Replaced copies are restorable from Health."),
        ...(visible.length
          ? {
              choices: [
                { label: "Tidy, but keep git as it is", hint: `skips the ${plural(visible.length, "change")} git would see`, run: run("keep") },
                { label: "Tidy everything", hint: `${plural(visible.length, "change")} will show in git status`, run: run("go") },
              ],
            }
          : { fix: { label: "Tidy", run: run("go") } }),
      });
    }
    issues.push(...tidy.conflicts.map(conflictIssue));

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
        const movable = machine.find((m) => m.name === s.name && m.movable);
        // You keep it global on purpose: the project copy is the extra one (and Claude Code runs the global one anyway).
        if (kept.has(s.name)) {
          issues.push({
            id: `twice:${root}:${s.name}`,
            severity: "suggestion",
            title: `${s.name}: in ${where}, and you keep it global`,
            detail: "The global copy already loads here, so this project copy is extra. Claude Code runs the global one anyway.",
            fix: {
              label: `Remove the copy in ${where}`,
              run: () => {
                const c = removeSkill(root, s.name);
                return c.action === "removed" ? `${s.name}: removed from ${where}; the global copy stays` : `${s.name}: ${c.reason}`;
              },
            },
          });
          continue;
        }
        issues.push({
          id: `twice:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name}: in ${where} and also loaded globally`,
          detail: "The project copy is enough; the global one loads it in every other project too.",
          fix: movable
            ? {
                label: "Stop loading it globally",
                run: () => {
                  if (!libraryNames.has(s.name)) importSkill(movable.path);
                  const r = unloadGlobal(movable.path, movable.links);
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
