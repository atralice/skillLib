import { existsSync, lstatSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { allowTrackedLinks, enabledHarnesses, keptGlobal } from "./config.js";
import { gitInfo, relativeTo } from "./git.js";
import { ALL_PROJECT_DIRS, harness, HARNESSES, type HarnessId } from "./harnesses.js";
import { addSkill, deleteLibrarySkill, discardEdits, importSkill, isLink, librarySkillDir, linkAll, linkEverywhere, linkGlobal, nestedSkills, projectStatus, removeSkill, syncProject, unloadGlobal, updateProject, visibilityOf, type Change, type ProjectSkill } from "./library.js";
import { tildify } from "./output.js";
import { grokDir, GROK_SKILLS_DIR, libraryDir, realPath as realPathOf } from "./paths.js";
import { skillDirsIn, treeHash } from "./skills.js";
import { readableRoots, readManifest } from "./project.js";
import { claudePlugins, cursorPluginSkills, installedPlugins, removePlugin, setPluginOn, turnOffIn, uninstallPlugin, updatePlugin, type ClaudePlugin, type InstalledPlugin } from "./plugins.js";
import { skillsLoadedIn, type SourcedSkill } from "./sources.js";
import { versionForHash, versionHistory } from "./versions.js";
import { agentSkillState, installAgentSkill } from "./agentSkill.js";
import { applyTidy, folderLabel, describeStep, gitVisibleSteps, planGlobalTidy, planProjectTidy, type Conflict, type TidyPlan } from "./tidy.js";

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

/** Copies a skill folder into your library; throws unless it went in (or was already there). */
function intoLibrary(path: string, force = false): string {
  const r = importSkill(path, { force });
  if (r.status === "exists") throw new Error(`${r.name}: your library has a different ${r.name}; update or delete it first`);
  return r.name;
}

/** Tracks a library skill in a repo's skilllib.json; throws when it couldn't. */
function track(root: string, name: string): Change {
  const c = addSkill(root, name);
  if (c.action === "skipped") throw new Error(`${name}: ${c.reason}`);
  return c;
}

/** A Claude Code install's place, for titles: " in web" for a project or local install. */
const installedIn = (p: InstalledPlugin) => (p.projectPath ? ` in ${basename(p.projectPath)}` : "");
/** Issue ids for one install: the plugin's, with the project first for a project or local install. */
const installId = (p: InstalledPlugin) => `${p.projectPath ? `${p.projectPath}:` : ""}${p.id}`;

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
  /**
   * Where the app shows it: the rows of the skills it names, in a repo (`root`) or in Global (`root`
   * null). doctor and `status --json` leave it out.
   */
  at?: { root: string | null; skill: string }[];
  /** The plugin it's about (name@marketplace; a Cursor plugin's name), for the app's Plugins rows. */
  plugin?: string;
  /** Which install of it, when the issue is about one: a project or local install's project, null for the user's (or synced) one. */
  pluginAt?: string | null;
};

/** What a sync or update fix did: the skills it changed and the ones it skipped. It fails when it changed none. */
function summarize(where: string, verb: string, changes: Change[]): string {
  const done = changes.filter((c) => c.action !== "skipped");
  const skipped = changes.filter((c) => c.action === "skipped").map((c) => `${c.name}: ${c.reason}`);
  if (!done.length) throw new Error(`${where}: nothing ${verb}${skipped.length ? `; ${skipped.join("; ")}` : ""}`);
  return `${where}: ${verb} ${plural(done.length, "skill")}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Issue.at for skills in one repo, or in Global (`root` null). */
const rows = (root: string | null, skills: string[]) => skills.map((skill) => ({ root, skill }));
const agentNames = (ids: HarnessId[]) => ids.map((id) => harness(id).name).join(", ");

/**
 * Differing copies of one skill: which agent runs which, and a choice per copy that can win. When keeping a
 * copy would change files git tracks, that's said, and a second choice makes those changes too.
 */
function conflictIssue(c: Conflict): Issue {
  const where = c.root ? basename(c.root) : "your global folders";
  const winners = c.managed ? c.copies.filter((x) => x.dir === c.managed) : c.copies;
  const planFor = (dir: string) => (c.root ? planProjectTidy(c.root, { keep: { [c.name]: dir } }) : planGlobalTidy({ keep: { [c.name]: dir } })).plans.find((p) => p.name === c.name);
  const keep = (dir: string, git: "keep" | "go"): Choice["run"] => () => {
    const plan = planFor(dir);
    const r = plan ? applyTidy(plan, { git }) : null;
    if (!r?.applied.length) throw new Error(`${c.name}: nothing changed${r?.held.length ? " (git would see every change)" : ""}`);
    return `${c.name}: kept the ${folderLabel(c.root, dir)} copy${r.held.length ? `; held back ${plural(r.held.length, "change")} git would see` : ""}`;
  };
  return {
    id: `conflict:${c.root ?? "global"}:${c.name}`,
    severity: "problem",
    title: `${c.name} in ${where}: the copies differ`,
    detail: `Your agents run different versions: ${c.copies
      .map((x) => `${folderLabel(c.root, x.dir)}${x.runs.length ? ` (${agentNames(x.runs)})` : ""}`)
      .join(" vs ")}. Keep one; the others become links to it and are restorable with skilllib restore (Settings › Backups in the app).`,
    at: rows(c.root, [c.name]),
    choices: winners.flatMap((x): Choice[] => {
      const plan = planFor(x.dir);
      const visible = plan ? gitVisibleSteps(plan).map((s) => describeStep(s, c.root!)) : [];
      const label = `Keep the ${folderLabel(c.root, x.dir)} copy`;
      if (!visible.length) return [{ label, hint: x.dir === c.managed ? "skilllib's version" : "the others become links to it", run: keep(x.dir, "go") }];
      return [
        { label: `${label}, but keep git as it is`, hint: `skips what git would see: ${visible.join(", ")}`, run: keep(x.dir, "keep") },
        { label: `${label}, and change what git tracks`, hint: `git will see: ${visible.join(", ")}`, run: keep(x.dir, "go") },
      ];
    }),
  };
}

function applyAll(plans: TidyPlan[], git: "keep" | "go"): { skills: number; held: number } {
  const results = plans.map((p) => applyTidy(p, { git }));
  return { skills: results.filter((r) => r.applied.length).length, held: results.reduce((n, r) => n + r.held.length, 0) };
}

/**
 * Links in a repo's skill folders that point at nothing, with no real copy of that skill in the repo: they load
 * nothing. (Next to a real copy, a broken link is tidy's: it points it at the copy.) Removing one is a fix,
 * unless git tracks it: then it's the team's link, and removing it is a choice git will see.
 */
function brokenLinksIn(root: string): Issue[] {
  const where = basename(root);
  // tidy works in every repo skill folder except .grok/skills (the team's, for Grok): there a broken link is always ours to report.
  const tidied = ALL_PROJECT_DIRS.filter((d) => d !== GROK_SKILLS_DIR);
  const hasCopy = (name: string) => tidied.some((d) => !isLink(join(root, d, name)) && existsSync(join(root, d, name, "SKILL.md")));
  let git: ReturnType<typeof gitInfo> | undefined;
  return ALL_PROJECT_DIRS.flatMap((dir) => {
    const folder = join(root, dir);
    if (!existsSync(folder)) return [];
    return readdirSync(folder).flatMap((name): Issue[] => {
      const path = join(folder, name);
      if (!isLink(path) || existsSync(path) || (dir !== GROK_SKILLS_DIR && hasCopy(name))) return [];
      const remove: Choice = {
        label: "Remove the link",
        run: () => {
          unlinkSync(path);
          return `Removed the broken link ${dir}/${name} in ${where}`;
        },
      };
      git ??= gitInfo(root);
      const tracked = ["committed", "changed"].includes(git?.of(relativeTo(root, path)) ?? "");
      return [
        {
          id: `broken:${root}:${dir}/${name}`,
          severity: "problem",
          title: `${name}: broken link in ${where}/${dir}`,
          detail: `It points at a folder that no longer exists, so it loads nothing.${tracked ? " Git tracks the link, so removing it shows in git status." : ""}`,
          at: rows(root, [name]),
          ...(tracked ? { choices: [remove] } : { fix: remove }),
        },
      ];
    });
  });
}

/**
 * A skill Grok runs from its own folder (~/.grok/skills, or a repo's .grok/skills, the team's) while your other
 * agents run a different copy. tidy never rewrites Grok's folder, so this is reported, with what would line them up.
 */
function grokDiffers(projects: string[], machine: SourcedSkill[], statusOf: (root: string) => ProjectSkill[]): Issue[] {
  if (!enabledHarnesses().includes("grok")) return [];
  const issue = (root: string | null, name: string, grokCopy: string, other: string): Issue => ({
    id: `grok-differs:${root ?? "global"}:${name}`,
    severity: "suggestion",
    title: `${name}${root ? ` in ${basename(root)}` : ""}: Grok runs a different copy`,
    detail: `Grok reads ${grokCopy} first; your other agents run ${other}, and the two differ. skilllib doesn't change Grok's folder: update or remove that copy there to make them match.`,
    at: rows(root, [name]),
  });
  const grokGlobal = join(grokDir(), "skills");
  const global = skillDirsIn(grokGlobal)
    .filter((path) => !isLink(path))
    .flatMap((path) => {
      const name = basename(path);
      const other = machine.find((m) => m.name === name && m.movable && !m.broken && m.harnesses.some((id) => id !== "grok") && realPathOf(dirname(m.path)) !== realPathOf(grokGlobal));
      return other && treeHash(other.path) !== treeHash(path) ? [issue(null, name, tildify(path), tildify(other.path))] : [];
    });
  const repos = projects.flatMap((root) =>
    skillDirsIn(join(root, GROK_SKILLS_DIR))
      .filter((path) => !isLink(path))
      .flatMap((path) => {
        const name = basename(path);
        const other = statusOf(root).find((s) => s.name === name && !s.path.startsWith(join(root, GROK_SKILLS_DIR)));
        return other && treeHash(other.path) !== treeHash(path) ? [issue(root, name, `${GROK_SKILLS_DIR}/${name}`, relativeTo(root, other.path))] : [];
      }),
  );
  return [...global, ...repos];
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
  roots: string[],
  machine: SourcedSkill[],
  libraryNames: Set<string>,
  statusOf: (root: string) => ProjectSkill[] = projectStatus,
  loadedIn: (root: string) => SourcedSkill[] = (root) => skillsLoadedIn(root, machine),
  nestedOf: (root: string) => ProjectSkill[] = nestedSkills,
): Issue[] {
  // A repo whose skilllib.json can't be read (a merge conflict) is one problem, not the end of the scan.
  const { readable: projects, unreadable } = readableRoots(roots);
  const issues: Issue[] = unreadable.map(({ root, reason }) => ({
    id: `manifest:${root}`,
    severity: "problem",
    title: `${basename(root)}: skilllib.json can't be read`,
    detail: `${reason}. Until it's fixed, skilllib leaves ${basename(root)} out.`,
    at: [],
  }));
  const statuses = new Map(projects.map((root) => [root, statusOf(root)]));
  issues.push(...grokDiffers(projects, machine, (root) => statuses.get(root)!));
  const nested = new Map(projects.map((root) => [root, nestedOf(root)]));

  for (const skill of machine.filter((m) => m.broken)) {
    issues.push({
      id: `broken:${skill.path}`,
      severity: "problem",
      title: `${skill.name}: broken link in ${tildify(dirname(skill.path))}`,
      detail: "It points at a folder that no longer exists, so it loads nothing.",
      at: rows(null, [skill.name]),
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
      at: rows(null, [name]),
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
      hint: plugin.extras.length ? `also removes its ${plugin.extras.join(", ")}` : "restorable with skilllib restore",
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
      // Global's rows (yours and the plugin's), and the repos where both load.
      at: [...rows(null, dupes), ...[...inRepos, ...cursorRepos].flatMap(([root, d]) => rows(root, d))],
      plugin: plugin.id,
    });
  }

  // A newer version in a plugin's marketplace. Updating changes code that runs in your sessions: a choice, never `doctor --fix`.
  if (enabledHarnesses().includes("claude-code"))
    for (const p of installedPlugins().filter((x) => x.update && !x.synced && !x.settingsOnly)) {
      const update: Choice = { label: p.update === "newer" ? "Update it" : `Update to ${p.update}`, hint: `runs claude plugin update ${p.id}`, run: () => orThrow(updatePlugin(p)) };
      issues.push({
        id: `plugin-update:${installId(p)}`,
        severity: "suggestion",
        title: `${p.id}${installedIn(p)}: ${p.update === "newer" ? "its marketplace has a newer commit" : `update available (${p.version ?? "?"} → ${p.update})`}`,
        detail: "Updates can bring new commands, hooks or MCP servers. If the marketplace asks to run a command, skilllib stops and you update it yourself. Claude Code uses the new version after a restart.",
        choices: [update],
        plugin: p.id,
        pluginAt: p.projectPath ?? null,
      });
    }

  // Plugins a repo's own Claude Code settings turn on: they collide only there.
  const machinePluginSkills = new Set(machinePlugins.flatMap((p) => p.skills));
  for (const root of projects) {
    const where = basename(root);
    const repoOnly = loadedHere.get(root)!.filter((m) => m.kind === "plugin" && !machinePluginSkills.has(m.path));
    // A repo's Claude Code settings matter only to Claude Code.
    for (const plugin of enabledHarnesses().includes("claude-code") ? claudePlugins(repoOnly, root) : []) {
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
        at: rows(root, dupes),
        plugin: plugin.id,
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
        at: [...rows(null, names.filter((n) => globalYours.has(n))), ...projects.flatMap((root) => rows(root, names.filter((n) => statuses.get(root)!.some((s) => s.name === n))))],
        plugin,
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
      detail: `${global.plans.map((p) => p.name).join(", ")}: each keeps one copy (in ~/.agents/skills when there's one) and the others become links. Restorable with skilllib restore.`,
      at: rows(null, global.plans.map((p) => p.name)),
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
  const unreviewed = [...new Set(loaded.filter((m) => m.movable && m.harnesses.length && !kept.has(m.name)).map((m) => m.name))];
  if (unreviewed.length) {
    issues.push({
      id: "review:global",
      severity: "suggestion",
      title: `${plural(unreviewed.length, "global skill")} of yours ${unreviewed.length === 1 ? "loads" : "load"} in every repo`,
      detail: `${unreviewed.join(", ")}. Move each to the repos that need it (skilllib global move <name> --to <repo>...), or mark the ones you want everywhere as global on purpose (skilllib global keep <name>).`,
      at: rows(null, unreviewed),
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
          : `Link ${skills.length === 1 ? "it" : "them"} for every agent, or move ${skills.length === 1 ? "it" : "them"} to the repos that need ${skills.length === 1 ? "it" : "them"} (skilllib global move), which works for every agent too.`
      }`,
      at: rows(null, [...new Set(skills.map((m) => m.name))]),
      ...(onPurpose ? { fix: link } : { choices: [link] }),
    });
  }

  const alsoGlobal = new Map<string, { root: string; managed: boolean; nested?: boolean }[]>(); // skill → projects with a copy
  // A repo copy and a global copy load twice only if one of your agents loads both.
  const globalCopies = loaded.filter((m) => m.kind !== "plugin");
  const alsoLoadedGlobally = (s: ProjectSkill) =>
    globalCopies.some((m) => m.name === s.name && m.harnesses.some((id) => s.visibility.some((v) => v.id === id && v.paths > 0)));
  for (const root of projects) {
    const where = basename(root);
    const status = statuses.get(root)!;
    issues.push(...brokenLinksIn(root));
    // sync restores a missing folder from your library: the pinned content, found by its hash. A skill the
    // library doesn't have, or a pin from another library, can't come back that way.
    const pins = readManifest(root).skills;
    const missing = status.filter((s) => s.state === "folder missing" && s.latest !== null);
    const restorable = missing.filter((s) => versionForHash(s.name, pins[s.name]?.hash ?? "") !== null);
    for (const s of missing.filter((m) => !restorable.includes(m)))
      issues.push({
        id: `pin:${root}:${s.name}`,
        severity: "problem",
        title: `${s.name}: the version ${where}'s skilllib.json pins isn't in your library`,
        detail: `The folder is missing, and no version in Your skills has the content it pins (pinned from another library?). Install your newest v${s.latest}; ${where}'s skilllib.json then pins it.`,
        at: rows(root, [s.name]),
        // It changes what the shared skilllib.json pins: a choice, never run by `doctor --fix`.
        choices: [{ label: `Install your newest (v${s.latest})`, hint: `${where}'s skilllib.json pins it`, run: () => `${s.name}: installed v${track(root, s.name).to}` }],
      });
    if (restorable.length > 0) {
      issues.push({
        id: `sync:${root}`,
        severity: "problem",
        title: `${where}: ${plural(restorable.length, "skill")} in skilllib.json not installed`,
        detail: `${restorable.map((s) => s.name).join(", ")}: the folder is missing`,
        at: rows(root, restorable.map((s) => s.name)),
        fix: {
          label: "Sync the project",
          run: () => summarize(where, "restored", syncProject(root)),
        },
      });
    }
    for (const s of status.filter((s) => s.state === "folder missing" && s.latest === null))
      issues.push({
        id: `unavailable:${root}:${s.name}`,
        severity: "problem",
        title: `${s.name}: pinned in ${where}'s skilllib.json, but not in your library`,
        detail: `Its folder is missing, and your library (${tildify(libraryDir())}) has no copy to restore: import it, or set SKILLLIB_HOME to the library that has it.`,
        at: rows(root, [s.name]),
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
        at: rows(root, behind.map((s) => s.name)),
        fix: {
          label: "Update to the newest versions",
          run: () => summarize(where, "updated", updateProject(root, behind.map((s) => s.name))),
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
          (visible.length ? `. Git would see ${plural(visible.length, "of these change")}: ${visible.join(", ")}.` : ". Replaced copies are restorable with skilllib restore."),
        at: rows(root, tidy.plans.map((p) => p.name)),
        ...(visible.length
          ? {
              choices: [
                // "Keep git as it is" only when it leaves something to do.
                ...(visible.length < tidy.plans.reduce((n, p) => n + p.steps.length, 0)
                  ? [{ label: "Tidy, but keep git as it is", hint: `skips the ${plural(visible.length, "change")} git would see`, run: run("keep") }]
                  : []),
                { label: "Tidy everything", hint: `${plural(visible.length, "change")} will show in git status`, run: run("go") },
              ],
            }
          : { fix: { label: "Tidy", run: run("go") } }),
      });
    }
    issues.push(...tidy.conflicts.map(conflictIssue));

    // Skills some of your agents can't reach here: links fix that (nothing is copied or moved). An agent that
    // already loads a global copy by that name isn't missing it: a link would make it load twice (that's twice:).
    const loadsGlobally = (name: string, id: HarnessId) => globalCopies.some((m) => m.name === name && m.harnesses.includes(id));
    const blindHere = status
      .filter((s) => s.state !== "folder missing" && s.visibility.some((v) => v.paths === 0 && !loadsGlobally(s.name, v.id)))
      .map((s) => ({ s, would: linkEverywhere(root, s.name, s.location, { dryRun: true }) }));
    // Only links into folders git tracks would help, and git doesn't share the real copy: those links would be
    // broken for teammates, so skilllib never adds them (see linkEverywhere). Committing it comes first.
    for (const { s, would } of blindHere.filter(({ would: w }) => !w.created.length && !w.blocked.length && w.uncommitted.length))
      issues.push({
        id: `uncommitted:${root}:${s.name}`,
        severity: "suggestion",
        title: `${s.name} in ${where}: ${agentNames(s.visibility.filter((v) => v.paths === 0).map((v) => v.id))} can't use it until it's committed`,
        detail: `Git tracks ${would.uncommitted.join(", ")}, but not ${s.location}/${s.name}: a link there would be broken for teammates. Commit it, then link it (\`skilllib link --allow-tracked\`).`,
        at: rows(root, [s.name]),
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
        at: rows(root, partial.map((s) => s.name)),
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
    // A copy git has committed is the team's (as in the TUI): copy it into the library, but don't make skilllib.json track it.
    const git = gitInfo(root);
    const committed = (s: ProjectSkill) => ["committed", "changed"].includes(git?.of(relativeTo(root, s.path)) ?? "");
    for (const s of status) {
      // A link whose real folder lives elsewhere (maybe under another name) isn't a copy to import or track,
      // and copies that differ need a winner first (the conflict issue above).
      if (isLink(s.path) || differing.has(s.name)) continue;
      // Importing and tracking change the library and the repo's skilllib.json: choices, never run by `doctor --fix`.
      if (s.state === "local only" && committed(s)) {
        issues.push({
          id: `local:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} isn't in your library`,
          detail: "Copy it into the library to reuse it in other projects. The repo's copy stays as it is: it's the team's (committed).",
          at: rows(root, [s.name]),
          choices: [
            {
              label: "Copy into the library",
              hint: `${where}'s copy stays as it is`,
              run: () => {
                intoLibrary(s.path);
                return `${s.name} copied into your library; ${where}'s copy stays as it is`;
              },
            },
          ],
        });
      } else if (s.state === "local only") {
        issues.push({
          id: `local:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} isn't in your library`,
          detail: "Import it into the library to reuse it in other projects and keep it backed up. The repo then tracks it in skilllib.json.",
          at: rows(root, [s.name]),
          choices: [
            {
              label: "Import into the library",
              hint: "copies it into Your skills",
              run: () => {
                intoLibrary(s.path);
                track(root, s.name);
                return `${s.name} imported and tracked in ${where}`;
              },
            },
          ],
        });
      } else if (s.state === "untracked copy of library skill" && !committed(s)) {
        // (A committed copy is the team's: never tracked from here, so update and remove never touch it.)
        issues.push({
          id: `adopt:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} isn't tracked`,
          detail: "It's identical to the library copy; track it (in skilllib.json) so future library changes reach it.",
          at: rows(root, [s.name]),
          choices: [{ label: "Track it", hint: `adds it to ${where}'s skilllib.json`, run: () => `${track(root, s.name).name} tracked in ${where}` }],
        });
      } else if (s.state === "untracked, differs from library" || s.state === "repo skill, differs from library") {
        // The team's copy (committed, or in a folder that's the repo's own) is never replaced or tracked from here.
        const teams = s.state.startsWith("repo skill") || committed(s);
        issues.push({
          id: `differs:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} differs from your library`,
          detail: teams
            ? `It's the team's copy (committed, or in the repo's own .agents/skills), and no version in Your skills matches it. Update your library from it if it's the one to keep; ${where}'s copy stays as it is.`
            : `No version in Your skills matches it. Update your library from it (${where} then tracks it), or replace it with your library's.`,
          at: rows(root, [s.name]),
          choices: [
            {
              label: "Update your library from it",
              hint: teams ? `a new version in Your skills; ${where}'s copy stays as it is` : `a new version in Your skills; ${where} then tracks it`,
              run: () => {
                intoLibrary(s.path, true);
                if (teams) return `${s.name}: your library has ${where}'s copy; ${where}'s copy stays as it is`;
                const c = track(root, s.name);
                return `${s.name}: your library has ${where}'s copy as v${c.to}; ${where} tracks it`;
              },
            },
            ...(teams
              ? []
              : [
                  {
                    label: "Replace it with your library's",
                    hint: "this copy is restorable with skilllib restore",
                    run: () => {
                      // addSkill checks first, then backs the copy up as it replaces it: nothing is moved if it can't.
                      const c = addSkill(root, s.name, { force: true });
                      if (c.action === "skipped") throw new Error(`${s.name}: ${c.reason}`);
                      return `${s.name} in ${where} is your library's v${c.to} now; the old copy is restorable with skilllib restore`;
                    },
                  },
                ]),
          ],
        });
      } else if (s.state === "from npx skills" && !(committed(s) && versionForHash(s.name, treeHash(s.path) ?? "") !== null)) {
        // Installed with `npx skills add`: skilllib doesn't manage it. Committed, it's the team's: copy it, never track it
        // (and once your library has this copy, there's nothing left to do).
        const teams = committed(s);
        issues.push({
          id: `npx:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} came from npx skills, not your library`,
          detail: `Installed with \`npx skills add\`${s.source ? ` (${s.source})` : ""}. Import it into your library to reuse it in other projects and keep it backed up${teams ? `; ${where}'s copy stays as it is (committed)` : `; ${where} then tracks it in skilllib.json`}.`,
          at: rows(root, [s.name]),
          choices: [
            {
              label: "Import it into your library",
              hint: teams ? `${where}'s copy stays as it is` : `${where} then tracks it`,
              run: () => {
                intoLibrary(s.path);
                if (teams) return `${s.name} copied into your library; ${where}'s copy stays as it is`;
                track(root, s.name);
                return `${s.name} imported and tracked in ${where}`;
              },
            },
          ],
        });
      }
      // Tracked, but deleted from your library: sync can't bring it back, and no other repo can add it. Copying it back adds to your library: a choice.
      if (s.state === "not in library")
        issues.push({
          id: `not-in-lib:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} is tracked, but no longer in your library`,
          detail: `${where}'s skilllib.json pins it, but your library has no copy: if the folder goes, sync can't restore it, and your other repos can't add it. Copy ${where}'s copy back into the library.`,
          at: rows(root, [s.name]),
          choices: [
            {
              label: "Copy it back into your library",
              hint: `${where}'s copy stays as it is`,
              run: () => {
                intoLibrary(s.path);
                return `${s.name} copied back into your library`;
              },
            },
          ],
        });
      if (s.state === "edited locally" || s.state === "edited locally, update available") {
        // Keeping the edits is also fine: skilllib never overwrites them. So these are choices, and "keep" is doing nothing.
        const newer = s.state !== "edited locally";
        const pinned = s.version ? `v${s.version}` : "the library version";
        issues.push({
          id: `edited:${root}:${s.name}`,
          severity: "suggestion",
          title: `${s.name} in ${where} has local edits`,
          detail: `It no longer matches ${pinned} from Your skills${newer ? `, and v${s.latest} is out` : ""}. Save the edits as a new version so your other repos can get them, or discard them. Keeping them is fine too: skilllib never overwrites edits.`,
          at: rows(root, [s.name]),
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
              hint: `back to ${pinned}; the edited copy is restorable with skilllib restore`,
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
      if (alsoLoadedGlobally(n) && !copies.some((c) => c.root === root)) alsoGlobal.set(n.name, [...copies, { root, managed: false, nested: true }]);
    }
  }

  // Project copies of skills that also load globally: one issue per skill. Where a skill lives is your
  // decision, so these are choices, never run by `doctor --fix`.
  for (const [name, copies] of alsoGlobal) {
    const wheres = copies.map((c) => basename(c.root)).join(", ");
    // Only copies skilllib installed can be removed from here; a repo's own skill is the team's.
    const removable = copies.filter((c) => c.managed).map((c) => c.root);
    const repoOwn = copies.filter((c) => !c.managed).map((c) => basename(c.root));
    // Each repo's row, and Global's.
    const at = [...copies.flatMap((c) => rows(c.root, [name])), ...rows(null, [name])];
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
        at,
        choices: removable.length
          ? [
              {
                label: `Remove the copies in ${removeWheres}`,
                hint: "the global copy stays",
                run: () => {
                  const removed = removable.filter((root) => removeSkill(root, name).action === "removed").map((r) => basename(r));
                  if (!removed.length) throw new Error(`${name}: removed from no project (local edits?)`);
                  return `${name}: removed from ${removed.join(", ")}; the global copy stays`;
                },
              },
            ]
          : undefined,
      });
      continue;
    }
    const movable = machine.find((m) => m.name === name && m.movable);
    issues.push({
      at,
      id: `twice:${name}`,
      severity: "suggestion",
      title: `${name}: in ${wheres} and also loaded globally`,
      detail: `${
        repoOwn.length === copies.length ? `Agents there load both the repo's copy and the global one.` : "The project copies are enough; the global one loads it in every other project too."
      } ${movable ? "Stop loading it globally, or keep it global on purpose (skilllib global keep)." : `The global copy comes from ${machine.find((m) => m.name === name && !m.movable)?.origin ?? "a vendor"}: turn it off there.`}`,
      choices: movable
        ? [
            {
              label: "Stop loading it globally",
              hint: "restorable with skilllib restore",
              run: () => {
                // Only when every agent you use still has it in each repo: one that sees just the global copy would lose it.
                // (A nested copy loads where it lives, in its package: no link at the repo root is needed there.)
                const blind = copies.filter((c) => !c.nested).flatMap((c) => visibilityOf(c.root, name).flatMap((v) => (v.paths === 0 ? [`${harness(v.id).name} in ${basename(c.root)}`] : [])));
                if (blind.length) throw new Error(`${name}: ${blind.join(", ")} only see the global copy; link the repo copies first (skilllib link)`);
                if (!libraryNames.has(name)) importSkill(movable.path);
                for (const m of machine.filter((x) => x.name === name && x.movable)) {
                  const r = unloadGlobal(m.path, m.links);
                  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
                }
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
      at: rows(null, ["skilllib"]),
      ...(agentSkill === "missing" ? { choices: [install] } : { fix: install }),
    });
  }

  return issues;
}

/** When a skill folder appeared: creation time where the filesystem keeps it, else its inode change time (a copy can't carry an old one over). */
function addedAt(path: string): number {
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
  uses: {
    inProject: (root: string, skill: string) => number;
    total: (skill: string) => number;
    days: number;
    /** Uses by the name sessions record it under (a plugin's skill as plugin:skill); without it, no plugin hints. */
    asUsed?: (key: string) => number;
  },
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
      title: `${where}: ${plural(unused.length, "skill")} unused in ${plural(uses.days, "day")}`,
      detail: `${unused.map((s) => s.name).join(", ")}: no Claude Code session in ${where} used ${unused.length === 1 ? "it" : "them"}. Each one's name and description still takes context in every session there.${
        unused.length > removable.length ? " The repo's own skills are the team's: remove those in the repo if nobody needs them." : ""
      }`,
      at: rows(root, unused.map((s) => s.name)),
      choices: removable.length
        ? [
            {
              label: `Remove ${removable.length === unused.length ? "them" : `the ${plural(removable.length, "skill")} skilllib installed`} from ${where}`,
              hint: "Your skills keeps them; edited ones stay",
              run: () => {
                const changes = removable.map((s) => removeSkill(root, s.name));
                const removed = changes.filter((c) => c.action === "removed").map((c) => c.name);
                const kept = changes.filter((c) => c.action !== "removed").map((c) => c.name);
                if (!removed.length) throw new Error(`${where}: removed nothing; kept ${kept.join(", ")} (local edits)`);
                return `${where}: removed ${removed.join(", ")}${kept.length ? `; kept ${kept.join(", ")} (local edits)` : ""}`;
              },
            },
          ]
        : undefined,
    });
  }

  // Plugins that are on and ship skills, none used: they still take context in every session. Turning one off is a choice.
  if (uses.asUsed)
    for (const p of installedPlugins().filter((x) => x.agent === "claude-code" && x.on && x.skills.length)) {
      const name = p.id.split("@")[0]!;
      if (p.skills.some((path) => uses.asUsed!(`${name}:${basename(path)}`) > 0)) continue;
      issues.push({
        id: `plugin-unused:${installId(p)}`,
        severity: "suggestion",
        title: `${p.id}${installedIn(p)}: its skills weren't used in ${plural(uses.days, "day")}`,
        detail: `No Claude Code session used ${p.skills.map((path) => `/${name}:${basename(path)}`).join(", ")}. Each one's name and description still takes context in every session.${
          p.extras.length ? ` It also brings ${p.extras.join(", ")}: turning it off pauses those too.` : ""
        }`,
        choices: [
          { label: `Turn the plugin ${p.id} off`, hint: "stays installed", run: () => orThrow(setPluginOn(p, false)) },
          ...(p.synced || p.settingsOnly ? [] : [{ label: `Uninstall the plugin ${p.id}`, hint: "its data stays; restorable with skilllib restore", run: () => orThrow(uninstallPlugin(p)) }]),
        ],
        plugin: p.id,
        pluginAt: p.projectPath ?? null,
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
      title: `${plural(idle.length, "skill")} in Your skills: in no repo, unused in ${plural(uses.days, "day")}`,
      detail: `${idle.sort().join(", ")}. They load nowhere, so they take no context: add the ones you want to a repo, or delete the ones you've outgrown.`,
      // Your skills' rows (none loads globally, so none is in Global).
      at: rows(null, idle),
      choices: [
        {
          label: `Delete ${idle.length === 1 ? "it" : `all ${idle.length}`} from Your skills`,
          hint: "restorable with skilllib restore",
          run: () => {
            const done = idle.map((name) => [name, deleteLibrarySkill(name)] as const);
            const failed = done.filter(([, r]) => !r.ok).map(([name]) => name);
            if (failed.length === done.length) throw new Error(`Deleted nothing; kept ${failed.join(", ")}`);
            return `Deleted ${plural(done.length - failed.length, "skill")} from Your skills${failed.length ? `; kept ${failed.join(", ")}` : ""}`;
          },
        },
      ],
    });
  }
  return issues;
}
