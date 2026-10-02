import { lstatSync } from "node:fs";
import { basename, dirname } from "node:path";
import { allowTrackedLinks, enabledHarnesses, keptGlobal } from "./config.js";
import { gitInfo } from "./git.js";
import { HARNESSES, type HarnessId } from "./harnesses.js";
import { addSkill, deleteLibrarySkill, discardEdits, importSkill, isLink, librarySkillDir, linkAll, linkEverywhere, linkGlobal, nestedSkills, projectStatus, removeSkill, syncProject, unloadGlobal, updateProject, type ProjectSkill } from "./library.js";
import { tildify } from "./output.js";
import { libraryDir } from "./paths.js";
import { claudePlugins, cursorPluginSkills, removePlugin, turnOffIn, type ClaudePlugin } from "./plugins.js";
import { skillsLoadedIn, type SourcedSkill } from "./sources.js";
import { versionHistory } from "./versions.js";
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
 * `loadedIn` is what agents load in a repo besides its own skills: the machine's,
 * with plugins that repo's Claude Code settings turn on or off. `nestedOf` lists
 * skill folders below a repo's root (monorepos); they count for skills loaded twice.
 */
export function findIssues(
  projects: string[],
  machine: SourcedSkill[],
  libraryNames: Set<string>,
  statusOf: (root: string) => ProjectSkill[] = projectStatus,
  loadedIn: (root: string) => SourcedSkill[] = (root) => skillsLoadedIn(root, machine),
  nestedOf: (root: string) => ProjectSkill[] = nestedSkills,
): Issue[] {
  const issues: Issue[] = [];
  const statuses = new Map(projects.map((root) => [root, statusOf(root)]));
  const nested = new Map(projects.map((root) => [root, nestedOf(root)]));

  for (const skill of machine.filter((m) => m.broken)) {
    issues.push({
      id: `broken:${skill.name}`,
      severity: "problem",
      title: `${skill.name}: broken link in ${tildify(dirname(skill.path))}`,
      detail: "It points at a folder that no longer exists, so it loads nothing.",
      fix: {
        label: "Remove the link",
        run: () => {
          const r = unloadGlobal(skill.path);
          if (!r.ok) throw new Error(`${skill.name}: ${r.reason}`);
          return `Removed broken link ${skill.name}`;
        },
      },
    });
  }

  // Your global skill and a vendor copy (claude.ai, a built-in, /etc/codex/skills) loaded by the same agent. Your skill wins,
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
      detail: `${copies.map((c) => `${c.kind} (${c.origin})`).join(" and ")}. Your skill wins: turn the ${vendor.map((c) => c.kind).join(" and ")} copy off at its source${vendor.some((c) => c.kind === "claude.ai") ? " (claude.ai → Settings → Skills)" : ""}${vendor.some((c) => c.kind === "system") ? ` (whoever manages ${vendor.find((c) => c.kind === "system")!.origin})` : ""}.`,
    });
  }

  // Plugins that duplicate your skills: your skill wins, and the plugin goes, everywhere or only in the repos where both load.
  const loadedHere = new Map(projects.map((root) => [root, loadedIn(root)]));
  // Skill names an agent (Claude Code unless said) loads in a repo: its own and nested ones it can see.
  const namesIn = (root: string, agent: HarnessId = "claude-code") => [
    ...new Set([...statuses.get(root)!, ...nested.get(root)!].filter((s) => s.visibility.some((v) => v.id === agent && v.paths > 0)).map((s) => s.name)),
  ];
  // Which of your agents load a plugin in a repo: its settings can turn it off for Claude Code, but Cursor ignores them.
  const pluginAgentsIn = (plugin: ClaudePlugin, root: string) => new Set(loadedHere.get(root)!.filter((m) => plugin.skills.includes(m.path)).flatMap((m) => m.harnesses));
  const globalYours = new Set(loaded.filter((m) => m.movable).map((m) => m.name));
  const installedYours = new Set([...globalYours, ...[...statuses.values()].flat().map((s) => s.name)]);
  const repoChoices = (plugin: ClaudePlugin, root: string, names: string[]): Choice[] => {
    const where = basename(root);
    const copies = statuses.get(root)!.filter((s) => names.includes(s.name));
    const allManaged = names.every((n) => copies.some((c) => c.name === n && c.managed));
    return [
      { label: `Turn the plugin ${plugin.id} off in ${where} only`, hint: "other repos keep it; in .claude/settings.local.json, a local-only file", run: () => orThrow(turnOffIn(plugin, root)) },
      // Only copies skilllib installed: Your skills keeps them. A repo's own skill is the team's, never removed from here.
      ...(names.length && allManaged
        ? [
            {
              label: `Remove your ${copies.map((s) => s.name).join(", ")} from ${where}`,
              hint: "the plugin's copy stays; Your skills keeps yours",
              run: () => {
                for (const s of copies) {
                  const r = removeSkill(root, s.name);
                  if (r.action !== "removed") throw new Error(`${s.name}: ${r.reason}`);
                }
                return `${copies.map((s) => s.name).join(", ")} removed from ${where}; the plugin's copy stays`;
              },
            },
          ]
        : []),
    ];
  };

  const machinePlugins = claudePlugins(machine);
  for (const plugin of machinePlugins) {
    const names = plugin.skills.map((p) => basename(p));
    // Repos where Claude Code still loads the plugin (a repo can turn it off) and has a copy of one of its skills.
    const inRepos = projects
      .filter((root) => pluginAgentsIn(plugin, root).has("claude-code"))
      .map((root) => [root, namesIn(root).filter((n) => names.includes(n))] as const)
      .filter(([, d]) => d.length);
    // Repos that turned it off for Claude Code, where Cursor still lists both: turning it off there again, or removing
    // the repo's copy (Claude Code would have neither), changes nothing useful. Only the plugin-wide choices help.
    const cursorRepos = enabledHarnesses().includes("claude-code")
      ? projects
          .filter((root) => !pluginAgentsIn(plugin, root).has("claude-code") && pluginAgentsIn(plugin, root).has("cursor"))
          .map((root) => [root, namesIn(root, "cursor").filter((n) => names.includes(n))] as const)
          .filter(([, d]) => d.length)
      : [];
    const claudeYours = new Set([...globalYours, ...inRepos.flatMap(([, d]) => d)]);
    const loadedYours = new Set([...claudeYours, ...cursorRepos.flatMap(([, d]) => d)]);
    const dupes = names.filter((n) => libraryNames.has(n) || loadedYours.has(n));
    if (!dupes.length) continue;
    const others = plugin.skills.length - dupes.length;
    const pluginName = plugin.id.split("@")[0]!;
    const remove: Choice = {
      label: `Remove the plugin ${plugin.id}`,
      hint: plugin.extras.length ? `also removes its ${plugin.extras.join(", ")}` : "restorable from Health",
      run: () => orThrow(removePlugin(plugin, "delete")),
    };
    const off: Choice = { label: `Turn the plugin ${plugin.id} off`, hint: "stays installed", run: () => orThrow(removePlugin(plugin, "off")) };
    const bothLoad = dupes.filter((n) => loadedYours.has(n));
    const claudeBoth = dupes.filter((n) => claudeYours.has(n));
    const cursorWheres = cursorRepos.map(([root]) => basename(root));
    const notInstalled = dupes.filter((n) => !installedYours.has(n));
    issues.push({
      id: `plugin:${plugin.id}`,
      severity: bothLoad.length ? "problem" : "suggestion",
      title: `${dupes.join(", ")}: also in the Claude Code plugin ${plugin.id}`,
      detail: [
        claudeBoth.length ? `Claude Code loads both (the plugin's as /${pluginName}:${claudeBoth[0]}). Your skill wins.` : "",
        cursorWheres.length
          ? `${cursorWheres.join(", ")} ${cursorWheres.length === 1 ? "turns" : "turn"} it off for Claude Code, but Cursor ignores repo settings and lists both there: only turning the plugin off or removing it changes that.`
          : "",
        notInstalled.length
          ? `Your ${notInstalled.join(", ")} ${notInstalled.length === 1 ? "is" : "are"} only in Your skills, not installed anywhere: once the plugin is gone, add ${notInstalled.length === 1 ? "it" : "them"} where you need ${notInstalled.length === 1 ? "it" : "them"}.`
          : "",
        others ? `The plugin's other ${others === 1 ? "skill is" : `${others} skills are`} copied into Your skills first, so nothing is lost.` : "",
        plugin.extras.length
          ? `It also brings ${plugin.extras.join(", ")}: ${plugin.synced ? "turning it off pauses those" : "removing it drops those, turning it off pauses them"}.`
          : "",
        plugin.synced ? "It's synced from claude.ai, so it can only be turned off here." : "",
        inRepos.length ? `Or keep it and turn it off only in ${inRepos.map(([root]) => basename(root)).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      choices: [...(plugin.synced ? [off] : plugin.extras.length ? [off, remove] : [remove, off]), ...inRepos.flatMap(([root, d]) => repoChoices(plugin, root, d))],
    });
  }

  // Plugins a repo's own Claude Code settings turn on: they collide only there.
  const machinePluginSkills = new Set(machinePlugins.flatMap((p) => p.skills));
  for (const root of projects) {
    const where = basename(root);
    const repoOnly = loadedHere.get(root)!.filter((m) => m.kind === "plugin" && !machinePluginSkills.has(m.path));
    for (const plugin of claudePlugins(repoOnly, root)) {
      const names = plugin.skills.map((p) => basename(p));
      const inRepo = namesIn(root).filter((n) => names.includes(n));
      const dupes = names.filter((n) => inRepo.includes(n) || globalYours.has(n));
      if (!dupes.length) continue;
      issues.push({
        id: `plugin:${root}:${plugin.id}`,
        severity: "problem",
        title: `${dupes.join(", ")}: also in the Claude Code plugin ${plugin.id}, on in ${where}`,
        detail: `${where}'s Claude Code settings turn the plugin on, so Claude Code loads both there (the plugin's as /${plugin.id.split("@")[0]}:${dupes[0]}). Your skill wins.`,
        choices: repoChoices(plugin, root, inRepo),
      });
    }
  }

  // Cursor plugins can't be read or changed from outside Cursor: report them.
  if (enabledHarnesses().includes("cursor")) {
    const byPlugin = new Map<string, string[]>();
    for (const s of cursorPluginSkills().filter((x) => installedYours.has(x.name))) byPlugin.set(s.plugin, [...(byPlugin.get(s.plugin) ?? []), s.name]);
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
        run: () => {
          const r = applyAll(global.plans, "go");
          if (!r.skills) throw new Error("No global skill changed");
          return `${plural(r.skills, "global skill")} now ${r.skills === 1 ? "has" : "have"} one copy`;
        },
      },
    });
  }
  issues.push(...global.conflicts.map(conflictIssue));

  // Your global skills you haven't decided about load in every repo. Where each lives is your call: no fix.
  const kept = keptGlobal();
  const unreviewed = [...new Set(loaded.filter((m) => m.movable && !kept.has(m.name)).map((m) => m.name))];
  if (unreviewed.length) {
    issues.push({
      id: "review:global",
      severity: "suggestion",
      title: `${plural(unreviewed.length, "global skill")} of yours ${unreviewed.length === 1 ? "loads" : "load"} in every repo`,
      detail: `${unreviewed.join(", ")}. Choose which repos keep each (Global → Clean up…), or mark the ones you want everywhere as global on purpose (skilllib global keep <name>).`,
    });
  }

  // Global skills some of your agents can't see, e.g. a Codex skill in ~/.agents/skills (Claude Code
  // doesn't read it). A link fixes it. For skills you keep global on purpose that's a repair; for the
  // others it makes them load in more places, so it's a choice (moving them to repos is the other one).
  const enabled = enabledHarnesses();
  // Another copy by that name (a duplicate, a plugin's) may reach the agent already.
  const seenBy = new Map<string, Set<HarnessId>>();
  for (const m of loaded) seenBy.set(m.name, new Set([...(seenBy.get(m.name) ?? []), ...m.harnesses]));
  const blindOf = (m: SourcedSkill) => enabled.filter((id) => !seenBy.get(m.name)!.has(id));
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
        if (!results.some((r) => r.linked.length)) throw new Error(`Nothing linked${skipped.length ? `; skipped ${skipped.join(", ")} (a different skill has that name)` : ""}`);
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

  const alsoGlobal = new Map<string, { root: string; managed: boolean }[]>(); // skill → projects with a copy
  // A repo copy and a global copy load twice only if one of your agents loads both.
  const globalCopies = loaded.filter((m) => m.kind !== "plugin");
  const alsoLoadedGlobally = (s: ProjectSkill) =>
    globalCopies.some((m) => m.name === s.name && m.harnesses.some((id) => s.visibility.some((v) => v.id === id && v.paths > 0)));
  for (const root of projects) {
    const where = basename(root);
    const status = statuses.get(root)!;
    // sync restores a missing folder from your library: a skill the library doesn't have can't come back that way.
    const restorable = status.filter((s) => s.state === "folder missing" && s.latest !== null);
    if (restorable.length > 0) {
      issues.push({
        id: `sync:${root}`,
        severity: "problem",
        title: `${where}: ${plural(restorable.length, "skill")} in skilllib.json not installed`,
        detail: `${restorable.map((s) => s.name).join(", ")}: the folder is missing`,
        fix: {
          label: "Sync the project",
          run: () => {
            const changes = syncProject(root);
            const done = changes.filter((c) => c.action !== "skipped");
            const skipped = changes.filter((c) => c.action === "skipped").map((c) => `${c.name}: ${c.reason}`);
            if (!done.length) throw new Error(`${where}: nothing restored${skipped.length ? `; ${skipped.join("; ")}` : ""}`);
            return `${where}: restored ${plural(done.length, "skill")}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`;
          },
        },
      });
    }
    for (const s of status.filter((s) => s.state === "folder missing" && s.latest === null))
      issues.push({
        id: `unavailable:${root}:${s.name}`,
        severity: "problem",
        title: `${s.name}: pinned in ${where}'s skilllib.json, but not in your library`,
        detail: `Its folder is missing, and your library (${tildify(libraryDir())}) has no copy to restore: import it, or set SKILLLIB_HOME to the library that has it.`,
        // Editing skilllib.json is the team's call: a choice, never run by `doctor --fix`.
        choices: [
          {
            label: "Remove it from skilllib.json",
            hint: `${where} stops pinning it`,
            run: () => {
              const r = removeSkill(root, s.name);
              if (r.action !== "removed") throw new Error(`${s.name}: ${r.reason}`);
              return `${s.name}: removed from ${where}'s skilllib.json`;
            },
          },
        ],
      });
    // A newer library version: moving to it is a fix, as in the TUI ("Update to vN"). Local edits are never overwritten.
    const behind = status.filter((s) => s.state === "update available");
    if (behind.length > 0)
      issues.push({
        id: `update:${root}`,
        severity: "suggestion",
        title: `${where}: ${plural(behind.length, "skill")} out of date`,
        detail: behind.map((s) => `${s.name} (v${s.version} → v${s.latest})`).join(", "),
        fix: {
          label: "Update to the newest versions",
          run: () => {
            const changes = updateProject(root, behind.map((s) => s.name));
            const done = changes.filter((c) => c.action !== "skipped");
            const skipped = changes.filter((c) => c.action === "skipped").map((c) => `${c.name}: ${c.reason}`);
            if (!done.length) throw new Error(`${where}: nothing updated${skipped.length ? `; ${skipped.join("; ")}` : ""}`);
            return `${where}: updated ${plural(done.length, "skill")}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`;
          },
        },
      });

    // One real copy per skill, plus only the links your agents need.
    const tidy = planProjectTidy(root);
    if (tidy.plans.length) {
      const git = gitInfo(root);
      const visible = tidy.plans.flatMap((p) => gitVisibleSteps(p, git).map((s) => describeStep(s, root)));
      const run = (mode: "keep" | "go") => () => {
        const r = applyAll(tidy.plans, mode);
        if (!r.skills) throw new Error(`${where}: nothing tidied${r.held ? `; left ${plural(r.held, "change")} git would see` : ""}`);
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
    const blindHere = status
      .filter((s) => s.state !== "folder missing" && s.visibility.some((v) => v.paths === 0))
      .map((s) => ({ s, would: linkEverywhere(root, s.name, s.location, { dryRun: true }) }));
    // Only links into folders git tracks would help, and git doesn't share the real copy: those links would be
    // broken for teammates, so skilllib never adds them (see linkEverywhere). Committing it comes first.
    for (const { s, would } of blindHere.filter(({ would: w }) => !w.created.length && !w.blocked.length && w.uncommitted.length))
      issues.push({
        id: `uncommitted:${root}:${s.name}`,
        severity: "suggestion",
        title: `${s.name} in ${where}: ${agentNames(s.visibility.filter((v) => v.paths === 0).map((v) => v.id))} can't use it until it's committed`,
        detail: `Git tracks ${would.uncommitted.join(", ")}, but not ${s.location}/${s.name}: a link there would be broken for teammates. Commit it, then link it (\`skilllib link --allow-tracked\`, or from Health).`,
      });
    const partial = blindHere.filter(({ would }) => would.created.length || would.blocked.length).map(({ s }) => s);
    if (partial.length) {
      const missing = [...new Set(partial.flatMap((s) => s.visibility.filter((v) => v.paths === 0).map((v) => v.id)))];
      const tracked = [...new Set(blindHere.flatMap(({ would }) => would.blocked))];
      const run = (allowTracked: boolean) => () => {
        if (allowTracked) allowTrackedLinks(root);
        const r = linkAll(root, { allowTracked });
        const notes = `${r.blocked.length ? `; skipped ${r.blocked.join(", ")} (git tracks ${r.blocked.length === 1 ? "it" : "them"})` : ""}${
          r.uncommitted.length ? `; ${r.uncommitted.join(", ")} not linked into folders git tracks (not committed, so teammates would get broken links)` : ""
        }`;
        if (!r.linked.length) throw new Error(`${where}: nothing linked${notes}`);
        return `${where}: linked ${plural(r.linked.length, "skill")} for ${agentNames(missing)}${notes}`;
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
                // Only when some link goes where git doesn't track: otherwise this one would link nothing.
                ...(blindHere.some(({ would }) => would.created.length)
                  ? [{ label: "Add links, but not where git tracks the folder", hint: `skips ${tracked.join(", ")}`, run: run(false) }]
                  : []),
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
          title: `${s.name} in ${where} isn't in your library`,
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
      if (s.state === "edited locally" || s.state === "edited locally, update available") {
        // Keeping the edits is also fine: skilllib never overwrites them. So these are choices, and "keep" is doing nothing.
        const newer = s.state !== "edited locally";
        const pinned = s.version ? `v${s.version}` : "the library version";
        issues.push({
          id: `edited:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} has local edits`,
          detail: `It no longer matches ${pinned} from Your skills${newer ? `, and v${s.latest} is out` : ""}. Save the edits as a new version so your other repos can get them, or discard them. Keeping them is fine too: skilllib never overwrites edits.`,
          choices: [
            {
              label: "Save as a new version in Your skills",
              hint: newer ? `becomes v${s.latest! + 1}; v${s.latest}'s changes aren't merged in` : `becomes v${(s.latest ?? 0) + 1}; ${where} uses it`,
              run: () => {
                importSkill(s.path, { force: true });
                const c = addSkill(root, s.name);
                if (c.action === "skipped") throw new Error(`${s.name}: ${c.reason}`);
                return `${s.name}: saved as v${c.to}; ${where} uses it`;
              },
            },
            {
              label: "Discard the edits",
              hint: `back to ${pinned}; the edited copy is restorable from Health`,
              run: () => {
                const c = discardEdits(root, s.name);
                if (c.action === "skipped") throw new Error(`${s.name}: ${c.reason}`);
                return `${s.name}: edits discarded, back to v${c.to}`;
              },
            },
          ],
        });
      }
      if (alsoLoadedGlobally(s)) alsoGlobal.set(s.name, [...(alsoGlobal.get(s.name) ?? []), { root, managed: s.managed }]);
    }
  }

  // Nested skill folders load too, in their part of the repo.
  for (const root of projects) {
    for (const n of nested.get(root)!) {
      const copies = alsoGlobal.get(n.name) ?? [];
      if (alsoLoadedGlobally(n) && !copies.some((c) => c.root === root)) alsoGlobal.set(n.name, [...copies, { root, managed: false }]);
    }
  }

  // Project copies of skills that also load globally: one issue per skill. Where a skill lives is your
  // decision, so these are choices, never run by `doctor --fix`.
  for (const [name, copies] of alsoGlobal) {
    const wheres = copies.map((c) => basename(c.root)).join(", ");
    // Only copies skilllib installed can be removed from here; a repo's own skill is the team's.
    const removable = copies.filter((c) => c.managed).map((c) => c.root);
    const repoOwn = copies.filter((c) => !c.managed).map((c) => basename(c.root));
    if (kept.has(name)) {
      // You keep it global on purpose: the project copies are the extra ones (Claude Code runs the global one anyway).
      const removeWheres = removable.map((r) => basename(r)).join(", ");
      issues.push({
        id: `twice:${name}`,
        severity: "suggestion",
        title: `${name}: in ${wheres}, and you keep it global`,
        detail: `The global copy already loads there, so the project copies are extra. Claude Code runs the global one anyway.${
          repoOwn.length ? ` ${repoOwn.join(", ")} ${repoOwn.length === 1 ? "has its own copy" : "have their own copies"}: remove ${repoOwn.length === 1 ? "it" : "them"} in the repo, or stop keeping ${name} global.` : ""
        }`,
        choices: removable.length
          ? [
              {
                label: `Remove the copies in ${removeWheres}`,
                hint: "the global copy stays",
                run: () => {
                  const removed = removable.filter((root) => removeSkill(root, name).action === "removed").map((r) => basename(r));
                  return `${name}: removed from ${removed.join(", ") || "no project"}; the global copy stays`;
                },
              },
            ]
          : undefined,
      });
      continue;
    }
    const movable = machine.find((m) => m.name === name && m.movable);
    issues.push({
      id: `twice:${name}`,
      severity: "suggestion",
      title: `${name}: in ${wheres} and also loaded globally`,
      detail: `${
        repoOwn.length === copies.length ? `Agents there load both the repo's copy and the global one.` : "The project copies are enough; the global one loads it in every other project too."
      } ${movable ? "Stop loading it globally, or keep it global on purpose (Global → Enter)." : `The global copy comes from ${machine.find((m) => m.name === name && !m.movable)?.origin ?? "a vendor"}: turn it off there.`}`,
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

/** When a skill folder appeared: creation time where the filesystem keeps it, else its inode change time (a copy can't carry an old one over). */
export function addedAt(path: string): number {
  try {
    const st = lstatSync(path);
    return st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
  } catch {
    return Date.now();
  }
}

/**
 * Hints from usage: skills a repo has that you haven't used there in `days`
 * days, and library skills in no repo that you haven't used at all. Apart from
 * findIssues because usage comes from reading transcripts (slow, async). Only
 * Claude Code leaves transcripts skilllib can read, so without it there are no
 * hints: everything would look unused. Skills added within `days` are left out.
 */
export function usageIssues(
  projects: string[],
  machine: SourcedSkill[],
  libraryNames: Set<string>,
  uses: { inProject: (root: string, skill: string) => number; total: (skill: string) => number; days: number },
  statusOf: (root: string) => { name: string; managed: boolean; path: string; state: string }[] = projectStatus,
): Issue[] {
  if (!enabledHarnesses().includes("claude-code")) return [];
  const issues: Issue[] = [];
  const since = Date.now() - uses.days * 24 * 60 * 60 * 1000;

  for (const root of projects) {
    const where = basename(root);
    const unused = statusOf(root).filter((s) => s.state !== "folder missing" && uses.inProject(root, s.name) === 0 && addedAt(s.path) <= since);
    if (!unused.length) continue;
    const removable = unused.filter((s) => s.managed);
    issues.push({
      id: `unused:${root}`,
      severity: "suggestion",
      title: `${where}: ${plural(unused.length, "skill")} unused in ${uses.days} days`,
      detail: `${unused.map((s) => s.name).join(", ")}: no Claude Code session in ${where} used ${unused.length === 1 ? "it" : "them"}. Each one's name and description still takes context in every session there.${
        unused.length > removable.length ? " The repo's own skills are the team's: remove those in the repo if nobody needs them." : ""
      }`,
      choices: removable.length
        ? [
            {
              label: `Remove ${removable.length === unused.length ? "them" : `the ${plural(removable.length, "skill")} skilllib installed`} from ${where}`,
              hint: "Your skills keeps them; edited ones stay",
              run: () => {
                const changes = removable.map((s) => removeSkill(root, s.name));
                const removed = changes.filter((c) => c.action === "removed").map((c) => c.name);
                const kept = changes.filter((c) => c.action !== "removed").map((c) => c.name);
                return `${where}: removed ${removed.join(", ") || "nothing"}${kept.length ? `; kept ${kept.join(", ")} (local edits)` : ""}`;
              },
            },
          ]
        : undefined,
    });
  }

  // Library skills in no repo and not loaded globally, unused everywhere.
  const installed = new Set([...projects.flatMap((root) => statusOf(root).map((s) => s.name)), ...machine.filter((m) => !m.broken).map((m) => m.name)]);
  const idle = [...libraryNames].filter((name) => {
    // No version yet (a skill `skilllib new` just made): its folder's age instead.
    const first = versionHistory(name)[0];
    return !installed.has(name) && uses.total(name) === 0 && (first ? Date.parse(first.date) : addedAt(librarySkillDir(name))) <= since;
  });
  if (idle.length) {
    issues.push({
      id: "unused:library",
      severity: "suggestion",
      title: `${plural(idle.length, "skill")} in Your skills: in no repo, unused in ${uses.days} days`,
      detail: `${idle.sort().join(", ")}. They load nowhere, so they take no context: add the ones you want to a repo, or delete the ones you've outgrown.`,
      choices: [
        {
          label: `Delete ${idle.length === 1 ? "it" : `all ${idle.length}`} from Your skills`,
          hint: "restorable from Health",
          run: () => {
            const done = idle.map((name) => [name, deleteLibrarySkill(name)] as const);
            const failed = done.filter(([, r]) => !r.ok).map(([name]) => name);
            return `Deleted ${plural(done.length - failed.length, "skill")} from Your skills${failed.length ? `; kept ${failed.join(", ")}` : ""}`;
          },
        },
      ],
    });
  }
  return issues;
}
