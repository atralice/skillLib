import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { HARNESSES, type HarnessId } from "./harnesses.js";
import { enabledHarnesses } from "./config.js";
import { basename, join, resolve } from "node:path";
import { claudeDir, codexSystemDir, OWN_SKILL_MARKER, skilllibHome, userHome } from "./paths.js";
import { readSkillInfo, skillDirsIn } from "./skills.js";

/**
 * Where a skill Claude Code can load comes from.
 * - global: a real folder in ~/.claude/skills (you, or a tool, copied it there)
 * - skills.sh: a symlink into ~/.agents/skills, installed by `npx skills`
 * - claude.ai: synced from your claude.ai account
 * - plugin: shipped inside an enabled Claude Code plugin
 * - system: a machine-wide folder an admin manages (/etc/codex/skills)
 */
export type SourceKind = "global" | "skills.sh" | "claude.ai" | "plugin" | "built-in" | "system";

export type SourcedSkill = {
  name: string;
  kind: SourceKind;
  /** Human-readable origin, e.g. "vercel-labs/agent-skills" or "railway@claude-plugins-official". */
  origin: string;
  path: string;
  description: string;
  /** Only ~/.claude/skills entries can be moved out by skilllib; vendors manage the rest. */
  movable: boolean;
  broken: boolean;
  /** Your harnesses that load it in every project. */
  harnesses: HarnessId[];
  /** Other global entries (symlinks) that point at this skill. */
  links: string[];
};

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function skillsShLock(): Record<string, { source?: string }> {
  return readJson<{ skills?: Record<string, { source?: string }> }>(join(resolve(claudeDir(), ".."), ".agents", ".skill-lock.json"))?.skills ?? {};
}

/** Skills `npx skills add` installed into a project (not globally), by name. */
export function projectSkillsLock(root: string): Record<string, { source?: string }> {
  return readJson<{ skills?: Record<string, { source?: string }> }>(join(root, "skills-lock.json"))?.skills ?? {};
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Your enabled harnesses that read global folder `dir`. */
function harnessesReading(dir: string, enabled: HarnessId[]): HarnessId[] {
  return enabled.filter((id) => HARNESSES.find((h) => h.id === id)?.globalDirs().includes(dir));
}

/** Machine-wide folders an admin manages: read, never changed. */
const systemDirs = () => [codexSystemDir()];

/** Your global skill folders that your harnesses read (~/.claude/skills or $CLAUDE_CONFIG_DIR/skills, ~/.agents/skills, …). */
export function globalSkillDirs(): string[] {
  return [...new Set(HARNESSES.flatMap((h) => h.globalDirs()))].filter((d) => !systemDirs().includes(d));
}

/** Skills in the system folders (/etc/codex/skills). */
function systemSkills(enabled: HarnessId[]): SourcedSkill[] {
  return systemDirs().flatMap((dir) =>
    skillDirsIn(dir).map((path) => ({
      name: basename(path),
      kind: "system" as const,
      origin: dir.replace(/\\/g, "/"),
      path,
      description: readSkillInfo(path).description,
      movable: false,
      broken: false,
      harnesses: harnessesReading(dir, enabled),
      links: [],
    })),
  ).filter((s) => s.harnesses.length > 0);
}

/**
 * Skills in every global folder a supported harness reads. A symlink to
 * another listed skill (e.g. ~/.claude/skills/x → ~/.agents/skills/x, as
 * `npx skills` does) is the same skill: it's folded into the target, and the
 * target counts as loaded by every harness reading either folder.
 */
function globalFolderSkills(enabled: HarnessId[]): SourcedSkill[] {
  const lock = skillsShLock();
  const agentsDir = join(userHome(), ".agents", "skills");
  const entries = globalSkillDirs().flatMap((dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => !name.startsWith(".") && name !== "synced")
      .flatMap((name) => {
        const path = join(dir, name);
        const isLink = lstatSync(path).isSymbolicLink();
        const broken = !existsSync(join(path, "SKILL.md"));
        if (!isLink && broken) return [];
        return [{ dir, name, path, isLink, broken, real: realpathOrNull(path) }];
      });
  });

  const realOf = new Map(entries.filter((e) => !e.isLink && e.real).map((e) => [e.real!, e]));
  const linksTo = new Map<string, typeof entries>();
  const skills: SourcedSkill[] = [];
  for (const e of entries) {
    const target = e.isLink && e.real ? realOf.get(e.real) : undefined;
    if (target) {
      linksTo.set(target.path, [...(linksTo.get(target.path) ?? []), e]);
      continue;
    }
    // Link targets use backslashes on Windows; compare with forward slashes.
    const target_ = e.isLink ? readlinkSync(e.path).replace(/\\/g, "/") : "";
    const inAgents = e.dir === agentsDir || target_.includes(".agents/skills");
    const locked = lock[e.name]?.source;
    if (existsSync(join(e.path, OWN_SKILL_MARKER))) {
      // The skill that teaches agents to use skilllib: deliberately global, so not yours to clean up.
      skills.push({ name: e.name, kind: "built-in", origin: "skilllib", path: e.path, description: readSkillInfo(e.path).description, movable: false, broken: false, harnesses: harnessesReading(e.dir, enabled), links: [] });
      continue;
    }
    skills.push({
      name: e.name,
      kind: locked || (e.isLink && inAgents) ? "skills.sh" : "global",
      origin: locked ?? (e.isLink && inAgents ? "skills.sh (not in its lock file)" : e.isLink ? `link → ${target_}` : `${tildify(e.dir)} (origin unknown)`),
      path: e.path,
      description: e.broken ? "" : readSkillInfo(e.path).description,
      movable: true,
      broken: e.broken,
      harnesses: e.broken ? [] : harnessesReading(e.dir, enabled),
      links: [],
    });
  }
  for (const skill of skills) {
    const links = linksTo.get(skill.path) ?? [];
    skill.links = links.map((l) => l.path);
    const reading = new Set([...skill.harnesses, ...links.flatMap((l) => harnessesReading(l.dir, enabled))]);
    skill.harnesses = enabled.filter((id) => reading.has(id));
  }
  return skills;
}

/** Home-relative path for labels, always with "/" so it reads the same on every OS. */
function tildify(p: string): string {
  const shown = p.startsWith(userHome()) ? "~" + p.slice(userHome().length) : p;
  return shown.replace(/\\/g, "/");
}

/** Cursor's own bundled skills (~/.cursor/skills-cursor). */
function cursorBuiltInSkills(enabled: HarnessId[]): SourcedSkill[] {
  if (!enabled.includes("cursor")) return [];
  return skillDirsIn(join(userHome(), ".cursor", "skills-cursor")).map((path) => ({
    name: basename(path),
    kind: "built-in" as const,
    origin: "Cursor",
    path,
    description: readSkillInfo(path).description,
    movable: false,
    broken: false,
    harnesses: ["cursor" as const],
    links: [],
  }));
}

/**
 * Skills synced from claude.ai, in ~/.claude/skills/synced/<bucket>/<skill>.
 * Claude Code loads them from its sync; Cursor, which walks ~/.claude/skills
 * recursively, loads them too.
 */
function claudeAiSkills(enabled: HarnessId[]): SourcedSkill[] {
  const synced = join(claudeDir(), "skills", "synced");
  const harnesses = harnessesReading(join(claudeDir(), "skills"), enabled);
  if (!existsSync(synced) || harnesses.length === 0) return [];
  return readdirSync(synced)
    .filter((d) => !d.startsWith("."))
    .flatMap((bucket) =>
      skillDirsIn(join(synced, bucket)).map((path) => ({
        name: basename(path),
        kind: "claude.ai" as const,
        origin: "claude.ai account",
        path,
        description: readSkillInfo(path).description,
        movable: false,
        broken: false,
        harnesses,
        links: [],
      })),
    );
}

type InstalledPlugins = { plugins?: Record<string, { scope?: string; installPath?: string }[]> };
type PluginSettings = { enabledPlugins?: Record<string, boolean> };

/** Turns a Claude Code plugin on or off for every repo (enabledPlugins in ~/.claude/settings.json). */
export function setPluginEnabled(id: string, on: boolean) {
  const file = join(claudeDir(), "settings.json");
  // A file we can't parse holds settings we'd wipe by rewriting it: leave it alone.
  const settings = existsSync(file) ? readJson<{ enabledPlugins?: Record<string, boolean> }>(file) : {};
  if (!settings) throw new Error(`${file} isn't valid JSON, so skilllib won't rewrite it`);
  settings.enabledPlugins = { ...settings.enabledPlugins, [id]: on };
  mkdirSync(claudeDir(), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

function repoSettingsFiles(root: string): string[] {
  return [join(root, ".claude", "settings.json"), join(root, ".claude", "settings.local.json")];
}

/**
 * enabledPlugins as Claude Code resolves it: ~/.claude/settings.json, then (in
 * a repo) its .claude/settings.json and .claude/settings.local.json, each
 * overriding the one before for the plugins it names.
 */
export function enabledPlugins(root?: string): Record<string, boolean> {
  const files = [join(claudeDir(), "settings.json"), ...(root ? repoSettingsFiles(root) : [])];
  return Object.assign({}, ...files.map((f) => readJson<PluginSettings>(f)?.enabledPlugins ?? {}));
}

/**
 * Skills in enabled Claude Code plugins. Claude Code follows enabledPlugins as
 * it resolves in `root` (a repo can turn one on or off). Cursor imports these
 * plugins too, but only user-scope installs your user settings turn on: not the
 * ones synced from claude.ai.
 */
function pluginSkills(harnesses: HarnessId[], root?: string): SourcedSkill[] {
  const claude = harnesses.includes("claude-code");
  const cursor = harnesses.includes("cursor");
  if (!claude && !cursor) return [];
  const plugins = join(claudeDir(), "plugins");
  const installed = readJson<InstalledPlugins>(join(plugins, "installed_plugins.json"))?.plugins ?? {};
  const user = enabledPlugins();
  const enabled = root ? enabledPlugins(root) : user;

  const fromMarketplaces = [...new Set([...Object.keys(enabled), ...Object.keys(user)])]
    .filter((id) => (claude && enabled[id]) || (cursor && user[id]))
    .flatMap((id) => {
      const [name = "", marketplace = ""] = id.split("@");
      const candidates = [
        ...(installed[id] ?? []).flatMap((i) => (i.installPath ? [i.installPath] : [])),
        join(plugins, "marketplaces", marketplace, "plugins", name),
        join(plugins, "marketplaces", marketplace, "external_plugins", name),
        join(plugins, "marketplaces", marketplace),
      ];
      const dir = candidates.find((c) => existsSync(join(c, "skills")));
      if (!dir) return [];
      const inCursor = cursor && user[id] && (installed[id] ?? []).some((i) => i.scope === "user" && i.installPath === dir);
      const loadedBy: HarnessId[] = [...(claude && enabled[id] ? ["claude-code" as const] : []), ...(inCursor ? ["cursor" as const] : [])];
      return loadedBy.length ? skillDirsIn(join(dir, "skills")).map((path) => ({ path, origin: id, loadedBy })) : [];
    });

  // Plugins synced from claude.ai live under plugins/synced/<bucket>/<id>/. Claude Code calls them
  // "<name>@synced" and skips the ones set to false in enabledPlugins (`claude plugin disable`).
  const syncedDir = join(plugins, "synced");
  const fromSynced = claude && existsSync(syncedDir)
    ? readdirSync(syncedDir)
        .filter((b) => !b.startsWith("."))
        .flatMap((bucket) =>
          readdirSync(join(syncedDir, bucket), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .flatMap((d) => {
              const root = join(syncedDir, bucket, d.name);
              const name = readJson<{ name?: string }>(join(root, ".claude-plugin", "plugin.json"))?.name ?? d.name;
              if (enabled[`${name}@synced`] === false) return [];
              return skillDirsIn(join(root, "skills")).map((path) => ({ path, origin: `${name}@synced`, loadedBy: ["claude-code" as HarnessId] }));
            }),
        )
    : [];

  return [...fromMarketplaces, ...fromSynced].map(({ path, origin, loadedBy }) => ({
    name: basename(path),
    kind: "plugin" as const,
    origin,
    path,
    description: readSkillInfo(path).description,
    movable: false,
    broken: false,
    harnesses: loadedBy,
    links: [],
  }));
}

const byKindAndName = (a: SourcedSkill, b: SourcedSkill) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);

/**
 * Every skill your harnesses load in all projects on this machine, with where
 * it came from. claude.ai and Claude Code plugin skills reach Claude Code and
 * Cursor; plugins are the ones ~/.claude/settings.json turns on (a repo can
 * differ for Claude Code: skillsLoadedIn).
 */
export function machineSkills(enabled: HarnessId[] = enabledHarnesses()): SourcedSkill[] {
  return [
    ...globalFolderSkills(enabled),
    ...claudeAiSkills(enabled),
    ...pluginSkills(enabled),
    ...cursorBuiltInSkills(enabled),
    ...systemSkills(enabled),
  ].sort(byKindAndName);
}

/**
 * The machine's skills as your agents see them in `root`: a repo's
 * .claude/settings(.local).json can turn a plugin on just there, or off just there.
 */
export function skillsLoadedIn(root: string, machine: SourcedSkill[], enabled: HarnessId[] = enabledHarnesses()): SourcedSkill[] {
  if (!enabled.includes("claude-code")) return machine;
  if (!repoSettingsFiles(root).some((f) => readJson<PluginSettings>(f)?.enabledPlugins)) return machine;
  return [...machine.filter((m) => m.kind !== "plugin"), ...pluginSkills(enabled, root)].sort(byKindAndName);
}

// ─── Library origins ────────────────────────────────────

function originsFile(): string {
  return join(skilllibHome(), "origins.json");
}

/** Where each library skill was imported from, e.g. "skills.sh: vercel-labs/agent-skills". */
export function libraryOrigins(): Record<string, string> {
  return readJson<Record<string, string>>(originsFile()) ?? {};
}

export function recordOrigin(name: string, origin: string) {
  const origins = libraryOrigins();
  if (origins[name] === origin) return;
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(originsFile(), JSON.stringify({ ...origins, [name]: origin }, null, 2) + "\n");
}

/** Origin label for a folder being imported into the library. */
export function originFor(dir: string): string {
  const match = machineSkills().find((s) => resolve(s.path) === resolve(dir));
  if (match) return match.kind === "global" ? "global folder" : `${match.kind}: ${match.origin}`;
  const project = dir.split(/[\\/]\.(?:claude|agents)[\\/]skills[\\/]/)[0];
  if (!project || project === dir) return dir;
  const locked = projectSkillsLock(project)[basename(dir)]?.source;
  return locked ? `skills.sh: ${locked}` : `project: ${basename(project)}`;
}
