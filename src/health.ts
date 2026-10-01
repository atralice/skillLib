import { basename } from "node:path";
import { allowTrackedLinks, enabledHarnesses, keptGlobal, readConfig } from "./config.js";
import { gitInfo } from "./git.js";
import { harness, HARNESSES, type HarnessId } from "./harnesses.js";
import { addSkill, importSkill, isGitTracked, isLink, linkAll, linkGlobal, projectStatus, removeSkill, syncProject, unloadGlobal, type ProjectSkill } from "./library.js";
import { claudePlugins, cursorPluginSkills, removePlugin } from "./plugins.js";
import type { SourcedSkill } from "./sources.js";
import { agentSkillState, installAgentSkill } from "./agentSkill.js";
import { applyTidy, copyLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type Conflict, type TidyPlan } from "./tidy.js";

/** One way to fix an issue; returns a message describing what happened, or throws if it failed. */
export type Choice = { label: string; hint?: string; run: () => string };

/** Runs a fix: its message, and whether it worked. */
export function runFix(choice: Choice): { ok: boolean; message: string } {
  try {
    return { ok: true, message: choice.run() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function orThrow(r: { ok: boolean; message: string }): string {
  if (!r.ok) throw new Error(r.message);
  return r.message;
}

export type Issue = {
  id: string;
  severity: "problem" | "suggestion";
  title: string;
  detail: string;
  /**
   * One-key fix, safe to run unasked (`doctor --fix` does): it only repairs (broken links, missing
   * links, sync, identical duplicates). Anything that decides where a skill lives, removes a plugin,
   * or adds to your library or a repo's skilllib.json is a choice instead.
   */
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
      run: () => orThrow(removePlugin(plugin, "delete")),
    };
    const off: Choice = { label: `Turn the plugin ${plugin.id} off`, hint: "stays installed", run: () => orThrow(removePlugin(plugin, "off")) };
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

  // Global skills some of your agents can't see, e.g. a Codex skill in ~/.agents/skills (Claude Code
  // doesn't read it). A link fixes it. For skills you keep global on purpose that's a repair; for the
  // others it makes them load in more places, so it's a choice (moving them to repos is the other one).
  const enabled = enabledHarnesses();
  // Another copy by that name (a duplicate, a plugin's) may reach the agent already.
  const seenBy = (name: string) => new Set(loaded.filter((m) => m.name === name).flatMap((m) => m.harnesses));
  const blindOf = (m: SourcedSkill) => enabled.filter((id) => !seenBy(m.name).has(id));
  const blindGlobal = loaded.filter((m) => m.movable && m.harnesses.length && blindOf(m).length);
  for (const onPurpose of [true, false]) {
    const skills = blindGlobal.filter((m) => kept.has(m.name) === onPurpose);
    if (!skills.length) continue;
    const missing = [...new Set(skills.flatMap(blindOf))];
    const link: Choice = {
      label: `Link ${skills.length === 1 ? "it" : "them"} for ${agentNames(missing)}`,
      hint: "links only; nothing is copied or moved",
      run: () => {
        const results = skills.map((m) => ({ m, ...linkGlobal(m.path, blindOf(m)) }));
        const skipped = results.flatMap((r) => r.skipped);
        return `Linked ${plural(results.filter((r) => r.linked.length).length, "global skill")} for ${agentNames(missing)}${skipped.length ? `; skipped ${skipped.join(", ")} (a different skill has that name)` : ""}`;
      },
    };
    issues.push({
      id: `usable:global${onPurpose ? ":kept" : ""}`,
      severity: "suggestion",
      title: `${plural(skills.length, "global skill")}${onPurpose ? " you keep global" : ""} not usable by ${agentNames(missing)}`,
      detail: `${skills.map((m) => `${m.name} (only ${agentNames(m.harnesses)})`).join(", ")}. ${
        onPurpose
          ? "A link in each agent's global folder makes the one real copy reach every agent you use."
          : `Link ${skills.length === 1 ? "it" : "them"} for every agent, or move ${skills.length === 1 ? "it" : "them"} to the repos that need ${skills.length === 1 ? "it" : "them"} (skilllib → Global), which works for every agent too.`
      }`,
      ...(onPurpose ? { fix: link } : { choices: [link] }),
    });
  }

  const alsoGlobal = new Map<string, string[]>(); // skill → projects with a managed copy
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

    // Skills some of your agents can't reach here: links fix that (nothing is copied or moved).
    const partial = status.filter((s) => s.state !== "folder missing" && s.visibility.some((v) => v.paths === 0));
    if (partial.length) {
      const missing = [...new Set(partial.flatMap((s) => s.visibility.filter((v) => v.paths === 0).map((v) => v.id)))];
      const tracked = readConfig().agentsDirOk?.includes(root)
        ? []
        : [...new Set(missing.map((id) => harness(id).projectDirs[0]!))].filter((dir) => isGitTracked(root, dir));
      const run = (allowTracked: boolean) => () => {
        if (allowTracked) allowTrackedLinks(root);
        const r = linkAll(root, { allowTracked });
        return `${where}: linked ${plural(r.linked.length, "skill")} for ${agentNames(missing)}${r.blocked.length ? `; skipped ${r.blocked.join(", ")} (git tracks it)` : ""}`;
      };
      issues.push({
        id: `usable:${root}`,
        severity: "suggestion",
        title: `${where}: ${plural(partial.length, "skill")} not usable by ${agentNames(missing)}`,
        detail: `${partial
          .map((s) => `${s.name} (not ${agentNames(s.visibility.filter((v) => v.paths === 0).map((v) => v.id))})`)
          .join(", ")}. Adding links makes the one real copy reach every agent you use; nothing is copied or moved.${
          tracked.length ? ` Git tracks ${tracked.join(", ")}, so links there show in git status.` : ""
        }`,
        ...(tracked.length
          ? {
              choices: [
                { label: "Add links, but not where git tracks the folder", hint: `skips ${tracked.join(", ")}`, run: run(false) },
                { label: "Add links everywhere", hint: `remembered for ${where}; git will see them`, run: run(true) },
              ],
            }
          : { fix: { label: "Add the links", run: run(false) } }),
      });
    }

    const differing = new Set(tidy.conflicts.map((c) => c.name));
    for (const s of status) {
      // A link whose real folder lives elsewhere (maybe under another name) isn't a copy to import or track,
      // and copies that differ need a winner first (the conflict issue above).
      if (isLink(s.path) || differing.has(s.name)) continue;
      // Importing and tracking change the library and the repo's skilllib.json: choices, never run by `doctor --fix`.
      if (s.state === "local only") {
        issues.push({
          id: `local:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name}: only exists in ${where}`,
          detail: "Import it into the library to reuse it in other projects and keep it backed up. The repo then tracks it in skilllib.json.",
          choices: [
            {
              label: "Import into the library",
              hint: `${where} then tracks it`,
              run: () => {
                importSkill(s.path);
                addSkill(root, s.name);
                return `${s.name} imported and tracked in ${where}`;
              },
            },
          ],
        });
      } else if (s.state === "untracked copy of library skill") {
        issues.push({
          id: `adopt:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} isn't tracked`,
          detail: "It's identical to the library copy; track it (in skilllib.json) so future library changes reach it.",
          choices: [{ label: "Track it", hint: `adds it to ${where}'s skilllib.json`, run: () => `${addSkill(root, s.name).name} tracked in ${where}` }],
        });
      }
      if (globalNames.has(s.name) && s.managed) alsoGlobal.set(s.name, [...(alsoGlobal.get(s.name) ?? []), root]);
    }
  }

  // Project copies of skills that also load globally: one issue per skill. Where a skill lives is your
  // decision, so these are choices, never run by `doctor --fix`.
  for (const [name, roots] of alsoGlobal) {
    const wheres = roots.map((r) => basename(r)).join(", ");
    if (kept.has(name)) {
      // You keep it global on purpose: the project copies are the extra ones (Claude Code runs the global one anyway).
      issues.push({
        id: `twice:${name}`,
        severity: "suggestion",
        title: `${name}: in ${wheres}, and you keep it global`,
        detail: "The global copy already loads there, so the project copies are extra. Claude Code runs the global one anyway.",
        choices: [
          {
            label: `Remove the copies in ${wheres}`,
            hint: "the global copy stays",
            run: () => {
              const removed = roots.filter((root) => removeSkill(root, name).action === "removed").map((r) => basename(r));
              return `${name}: removed from ${removed.join(", ") || "no project"}; the global copy stays`;
            },
          },
        ],
      });
      continue;
    }
    const movable = machine.find((m) => m.name === name && m.movable);
    issues.push({
      id: `twice:${name}`,
      severity: "suggestion",
      title: `${name}: in ${wheres} and also loaded globally`,
      detail: "The project copies are enough; the global one loads it in every other project too. Or keep it global on purpose (Global → Enter).",
      choices: movable
        ? [
            {
              label: "Stop loading it globally",
              hint: "restorable from Health",
              run: () => {
                if (!libraryNames.has(name)) importSkill(movable.path);
                const r = unloadGlobal(movable.path, movable.links);
                if (!r.ok) throw new Error(`${name}: ${r.reason}`);
                return `${name} no longer loads globally`;
              },
            },
          ]
        : undefined,
    });
  }

  // The skill that lets your agents use skilllib. Installing it adds a global skill, so it's a choice;
  // refreshing one you installed is a repair.
  const agentSkill = agentSkillState();
  if (agentSkill !== "installed") {
    const install: Choice = {
      label: agentSkill === "missing" ? "Install the skilllib skill for your agents" : "Update the skilllib skill",
      hint: "one global skill, in ~/.claude/skills (and ~/.agents/skills)",
      run: () => {
        const r = installAgentSkill();
        if (!r.ok) throw new Error(`skilllib skill: ${r.reason}`);
        return `Your agents can now use skilllib (${plural(r.dirs.length, "folder")})`;
      },
    };
    issues.push({
      id: "agent-skill",
      severity: "suggestion",
      title: agentSkill === "missing" ? "Your agents don't know about skilllib" : "The skilllib skill for your agents is out of date",
      detail: "The skilllib skill lets you ask your agents which skills they can use here, where each comes from, and which of your skills a repo should add.",
      ...(agentSkill === "missing" ? { choices: [install] } : { fix: install }),
    });
  }

  return issues;
}
