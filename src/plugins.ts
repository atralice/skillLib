import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { importSkill, type Backup } from "./library.js";
import { claudeDir, skilllibHome, userHome } from "./paths.js";
import { skillDirsIn } from "./skills.js";
import { enabledPlugins, pluginDirCandidates, type SourcedSkill } from "./sources.js";
import { latestVersion } from "./versions.js";

/** Which install of a Claude Code plugin to act on. */
export type PluginRef = {
  /** name@marketplace, as `claude plugin` takes it. */
  id: string;
  /** Install scope (user, project, local); null for plugins synced from claude.ai. */
  scope: string | null;
  /** For project and local scope: the project it's installed in (`claude plugin` must run there). */
  projectPath?: string;
  synced: boolean;
  /** Turned on in your settings with no install record: there's nothing for `claude plugin` to uninstall or update. */
  settingsOnly?: true;
};

/** A Claude Code plugin that ships skills. */
export type ClaudePlugin = PluginRef & {
  /** Skill folders it ships. */
  skills: string[];
  /** What else it brings, lost if it's deleted: "MCP servers", "hooks", "agents", "commands". */
  extras: string[];
};

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function nonEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).some((f) => !f.startsWith("."));
  } catch {
    return false;
  }
}

function extrasOf(root: string): string[] {
  const manifest = readJson<Record<string, unknown>>(join(root, ".claude-plugin", "plugin.json")) ?? {};
  return [
    ...(existsSync(join(root, ".mcp.json")) || manifest.mcpServers ? ["MCP servers"] : []),
    ...(existsSync(join(root, "hooks", "hooks.json")) || manifest.hooks ? ["hooks"] : []),
    ...(nonEmptyDir(join(root, "agents")) || manifest.agents ? ["agents"] : []),
    ...(nonEmptyDir(join(root, "commands")) || manifest.commands ? ["commands"] : []),
  ];
}

/** Claude Code plugins behind the plugin skills in `machine` (machineSkills, or skillsLoadedIn for the repo `root`). */
export function claudePlugins(machine: SourcedSkill[], root?: string): ClaudePlugin[] {
  const installed =
    readJson<{ plugins?: Record<string, { scope?: string; projectPath?: string }[]> }>(join(claudeDir(), "plugins", "installed_plugins.json"))?.plugins ?? {};
  const byOrigin = new Map<string, string[]>();
  for (const m of machine) if (m.kind === "plugin") byOrigin.set(m.origin, [...(byOrigin.get(m.origin) ?? []), m.path]);
  return [...byOrigin].map(([origin, skills]) => {
    const synced = origin.endsWith("@synced");
    const id = origin;
    const entries = installed[origin] ?? [];
    const entry = entries.find((e) => root && e.projectPath === root) ?? entries.find((e) => (e.scope ?? "user") === "user") ?? entries[0];
    return {
      id,
      scope: synced ? null : (entry?.scope ?? "user"),
      ...(entry?.projectPath ? { projectPath: entry.projectPath } : {}),
      synced,
      skills,
      extras: extrasOf(dirname(dirname(skills[0]!))),
    };
  });
}

/** An installed plugin, on or off, whether or not it ships skills. */
export type InstalledPlugin = PluginRef & {
  agent: "claude-code" | "cursor";
  /** On where it's installed; null when that can't be read (Cursor). */
  on: boolean | null;
  /** Its folder. */
  root: string;
  version?: string;
  /** A newer version the marketplace offers ("newer" when only its commit differs). */
  update?: string;
  description: string;
  skills: string[];
  extras: string[];
};

type InstallEntry = { scope?: string; projectPath?: string; installPath?: string; version?: string; gitCommitSha?: string };

/** "1.10.0" > "1.9.2": compares the numbers in each part. */
function newer(a: string, b: string): boolean {
  // "v1.2.0" is 1.2.0.
  const parts = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/**
 * What the marketplace (as Claude Code last fetched it) offers that's newer than `entry`:
 * a declared version, the version in a plugin it holds itself, or a different pinned commit.
 * Undefined when it can't tell: no guessing.
 */
type Listed = { name?: string; version?: string; source?: string | { sha?: string } };

function updateOf(name: string, marketplace: string, entry: InstallEntry, catalogs: Map<string, Listed[]>): string | undefined {
  const dir = join(claudeDir(), "plugins", "marketplaces", marketplace);
  // Read once per marketplace: one catalog lists all of its plugins.
  if (!catalogs.has(marketplace)) catalogs.set(marketplace, readJson<{ plugins?: Listed[] }>(join(dir, ".claude-plugin", "marketplace.json"))?.plugins ?? []);
  const listed = catalogs.get(marketplace)!.find((p) => p.name === name);
  if (!listed) return undefined;
  const version = listed.version ?? (typeof listed.source === "string" ? readJson<{ version?: string }>(join(dir, listed.source, ".claude-plugin", "plugin.json"))?.version : undefined);
  if (version && entry.version) return newer(version, entry.version) ? version : undefined;
  const sha = typeof listed.source === "object" ? listed.source?.sha : undefined;
  return sha && entry.gitCommitSha && sha !== entry.gitCommitSha ? "newer" : undefined;
}

/** Where an installed plugin's files are, found as Claude Code's skills are (sources.ts): the first with skills, else the first there. */
function pluginRoot(id: string, entry: InstallEntry): string {
  const candidates = pluginDirCandidates(id, entry.installPath ? [entry.installPath] : []);
  return candidates.find((c) => existsSync(join(c, "skills"))) ?? candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

function describe(root: string) {
  const manifest = readJson<{ description?: string; version?: string }>(join(root, ".claude-plugin", "plugin.json")) ?? {};
  return { description: manifest.description ?? "", version: manifest.version, skills: skillDirsIn(join(root, "skills")), extras: extrasOf(root) };
}

/**
 * Every Claude Code plugin on this machine, on or off: one per install (a plugin can be
 * installed for you and again in a project), plus the ones synced from claude.ai. An install's
 * on/off is enabledPlugins as Claude Code resolves it where it's installed.
 */
export function installedPlugins(): InstalledPlugin[] {
  const plugins = join(claudeDir(), "plugins");
  const installed = readJson<{ plugins?: Record<string, InstallEntry[]> }>(join(plugins, "installed_plugins.json"))?.plugins ?? {};
  const catalogs = new Map<string, Listed[]>();
  const fromMarketplaces = Object.entries(installed).flatMap(([id, entries]) =>
    entries.map((entry): InstalledPlugin => {
      const [name = id, marketplace = ""] = id.split("@");
      const scope = entry.scope ?? "user";
      const projectPath = scope === "user" ? undefined : entry.projectPath;
      const root = pluginRoot(id, entry);
      const about = describe(root);
      const update = updateOf(name, marketplace, entry, catalogs);
      return {
        id,
        scope,
        ...(projectPath ? { projectPath } : {}),
        synced: false,
        agent: "claude-code",
        on: enabledPlugins(projectPath)[id] === true,
        root,
        ...about,
        version: entry.version ?? about.version,
        ...(update ? { update } : {}),
      };
    }),
  );
  // Turned on in your settings with no install record: Claude Code loads it from its marketplace's copy.
  // (One set to false there is a leftover, not a plugin.)
  const user = enabledPlugins();
  const fromSettings = Object.keys(user)
    .filter((id) => user[id] === true && id.includes("@") && !id.endsWith("@synced") && !installed[id])
    .flatMap((id): InstalledPlugin[] => {
      // Only where Claude Code loads it from: a copy with skills.
      const root = pluginDirCandidates(id, []).find((c) => existsSync(join(c, "skills")));
      return root ? [{ id, scope: "user", synced: false, agent: "claude-code", on: true, settingsOnly: true, root, ...describe(root) }] : [];
    });
  // Synced from claude.ai: on unless "<name>@synced" is false in your settings.
  const syncedDir = join(plugins, "synced");
  const dirs = (p: string) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => join(p, d.name)) : []);
  const fromSynced = dirs(syncedDir)
    .flatMap(dirs)
    .map((root): InstalledPlugin => {
      const id = `${readJson<{ name?: string }>(join(root, ".claude-plugin", "plugin.json"))?.name ?? basename(root)}@synced`;
      return { id, scope: null, synced: true, agent: "claude-code", on: user[id] !== false, root, ...describe(root) };
    });
  return [...fromMarketplaces, ...fromSettings, ...fromSynced];
}

/** Cursor's marketplace plugins: what they bring, never whether they're on (Cursor keeps that in its database). */
export function cursorPlugins(): InstalledPlugin[] {
  const cache = join(userHome(), ".cursor", "plugins", "cache");
  const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((d) => !d.startsWith(".") && statSync(join(p, d)).isDirectory()) : []);
  return dirs(cache).flatMap((marketplace) =>
    dirs(join(cache, marketplace)).flatMap((plugin) => {
      const versions = dirs(join(cache, marketplace, plugin)).map((v) => join(cache, marketplace, plugin, v));
      const root = versions.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (!root) return [];
      const about = describe(root);
      return [{ id: `${plugin}@${marketplace}`, scope: null, synced: false, agent: "cursor" as const, on: null, root, ...about, version: about.version ?? basename(root) }];
    }),
  );
}

/** claudeBinary's answer per PATH and home: finding it spawns `claude --version`, which is slow. */
const binaries = new Map<string, string | null>();

/** Looks for the CLI again next time (on reload): it may have been installed or fixed since. */
export function forgetClaudeBinary() {
  binaries.clear();
}

/**
 * The Claude Code CLI to run: `claude` on PATH if it works, else the native
 * installer's ~/.local/bin/claude (or the older ~/.claude/local/claude).
 * Terminals like cmux put a `claude` wrapper first on PATH that can fail to
 * find the real one. Null if none runs.
 */
export function claudeBinary(): string | null {
  const key = `${process.env.PATH}|${userHome()}`;
  if (!binaries.has(key)) {
    const candidates = ["claude", join(userHome(), ".local", "bin", "claude"), join(userHome(), ".claude", "local", "claude")];
    const found = candidates.find((bin) => {
      try {
        return execFileSync(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, encoding: "utf-8" }).includes("Claude Code");
      } catch {
        return false;
      }
    });
    binaries.set(key, found ?? null);
  }
  return binaries.get(key)!;
}

/**
 * Runs the Claude Code CLI; its own commands keep its settings and caches right. The app waits
 * for it, so switching and uninstalling get 20 seconds; installs and updates download, and get 2 minutes.
 */
function claude(args: string[], cwd?: string, bin = claudeBinary()): { ok: true } | { ok: false; reason: string } {
  if (!bin) return { ok: false, reason: `Claude Code's CLI didn't run (tried \`claude\` on your PATH and ~/.local/bin/claude); run \`claude ${args.join(" ")}\` yourself` };
  // A project install whose folder is gone: say so, rather than a spawn error that reads like a missing CLI.
  if (cwd && !existsSync(cwd)) return { ok: false, reason: `${cwd} no longer exists; run \`claude ${args.join(" ")}\` in the project's new folder, or remove the install with /plugin` };
  const slow = args[1] === "install" || args[1] === "update";
  try {
    execFileSync(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: slow ? 120_000 : 20_000, encoding: "utf-8" });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, reason: `${(e.stderr || e.stdout || e.message || "failed").trim().split("\n").slice(-1)[0]!} (ran ${bin})` };
  }
}

/** Sets "<id>": on in a settings file's enabledPlugins, keeping everything else in it. */
function setPluginIn(file: string, id: string, on: boolean): { ok: true } | { ok: false; reason: string } {
  const settings = existsSync(file) ? readJson<Record<string, unknown>>(file) : {};
  if (!settings) return { ok: false, reason: `can't read ${file}` };
  const enabled = (settings.enabledPlugins as Record<string, boolean> | undefined) ?? {};
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...settings, enabledPlugins: { ...enabled, [id]: on } }, null, 2) + "\n");
  return { ok: true };
}

/**
 * .claude/settings.local.json holds your own overrides, never the team's. Claude Code makes git
 * ignore it when it creates the file; when skilllib writes it, skilllib does: a line in the repo's
 * .git/info/exclude, which is local too (never committed). Says how it stands, for the message.
 */
export function ignoreLocalSettings(root: string): string {
  const file = ".claude/settings.local.json";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    git("rev-parse", "--git-dir");
  } catch {
    return ""; // not a git repo
  }
  try {
    git("ls-files", "--error-unmatch", "--", file);
    return "; git tracks that file, so this shows in git status";
  } catch {
    // not tracked
  }
  try {
    git("check-ignore", "-q", "--", file);
    return ", which git ignores";
  } catch {
    // not ignored yet
  }
  try {
    const exclude = resolve(root, git("rev-parse", "--git-path", "info/exclude"));
    const before = existsSync(exclude) ? readFileSync(exclude, "utf-8") : "";
    mkdirSync(dirname(exclude), { recursive: true });
    writeFileSync(exclude, `${before}${before && !before.endsWith("\n") ? "\n" : ""}/${git("rev-parse", "--show-prefix")}${file}\n`);
    return ", which git now ignores via .git/info/exclude";
  } catch {
    return "; git doesn't ignore that file yet: it's local only, don't commit it";
  }
}

/**
 * Turns a plugin off in one repo only; it stays on everywhere else. `claude
 * plugin disable --scope local`, run in the repo, writes "<id>": false to its
 * .claude/settings.local.json, which overrides the user and project settings
 * (checked with Claude Code 2.1.283). Synced plugins (which `claude plugin` can't
 * touch), or any plugin when the CLI doesn't run, get the same line written directly.
 */
export function turnOffIn(plugin: ClaudePlugin, root: string): { ok: boolean; message: string } {
  const done = `${plugin.id} turned off in ${basename(root)}; other repos keep it`;
  const bin = plugin.synced ? null : claudeBinary();
  if (!bin) {
    const r = setPluginIn(join(root, ".claude", "settings.local.json"), plugin.id, false);
    return r.ok ? { ok: true, message: `${done} (in .claude/settings.local.json${ignoreLocalSettings(root)})` } : { ok: false, message: `${plugin.id}: ${r.reason}` };
  }
  const r = claude(["plugin", "disable", plugin.id, "--scope", "local"], root, bin);
  return r.ok ? { ok: true, message: done } : { ok: false, message: `${plugin.id}: ${r.reason}` };
}

/** The settings file a scope's enabledPlugins lives in (what `claude plugin enable|disable --scope` writes). */
function settingsFileOf(p: PluginRef): string | null {
  if (p.synced || !p.scope || p.scope === "user") return join(claudeDir(), "settings.json");
  if (!p.projectPath) return null;
  return join(p.projectPath, ".claude", p.scope === "local" ? "settings.local.json" : "settings.json");
}

/** Where a plugin is installed, for messages: "for you", "in web-app (project)". */
function whereOf(p: PluginRef): string {
  return p.projectPath ? ` in ${basename(p.projectPath)} (${p.scope})` : "";
}

/**
 * Turns a plugin on or off where it's installed: `claude plugin enable|disable --scope`, run in
 * its project for project and local installs. Synced plugins have no install, so their line in
 * ~/.claude/settings.json is written directly; so is any install's when the CLI doesn't run.
 */
export function setPluginOn(p: PluginRef, on: boolean): { ok: boolean; message: string } {
  const done = { ok: true, message: `${p.id} is ${on ? "on" : "off"}${whereOf(p)}${p.synced ? "" : "; Claude Code picks it up in its next session"}` };
  if (p.scope && p.scope !== "user" && !p.projectPath) return { ok: false, message: `${p.id}: skilllib doesn't know which project it's installed in; run \`claude plugin ${on ? "enable" : "disable"} ${p.id} --scope ${p.scope}\` there` };
  // Synced plugins aren't installed, and neither is one only turned on in your settings: `claude plugin` can't switch them.
  const bin = p.synced || p.settingsOnly ? null : claudeBinary();
  if (bin) {
    const r = claude(["plugin", on ? "enable" : "disable", p.id, ...(p.scope ? ["--scope", p.scope] : [])], p.projectPath, bin);
    return r.ok ? done : { ok: false, message: `${p.id}: ${r.reason}` };
  }
  const r = setPluginIn(settingsFileOf(p)!, p.id, on);
  if (!r.ok) return { ok: false, message: `${p.id}: ${r.reason}` };
  // A local install's switch is in .claude/settings.local.json: keep it out of git, as Claude Code does.
  return p.scope === "local" && p.projectPath ? { ...done, message: done.message + ignoreLocalSettings(p.projectPath) } : done;
}

/**
 * Uninstalls a plugin where it's installed, keeping its data (a reinstall brings it back as it
 * was), and records it so Settings › Backups can reinstall it.
 */
export function uninstallPlugin(p: PluginRef): { ok: boolean; message: string } {
  if (p.synced) return { ok: false, message: `${p.id} is synced from your claude.ai account: remove it there, or turn it off here` };
  if (p.settingsOnly) return { ok: false, message: `${p.id} isn't installed, only turned on in your settings: turn it off instead` };
  if (p.scope && p.scope !== "user" && !p.projectPath) return { ok: false, message: `${p.id}: skilllib doesn't know which project it's installed in; run \`claude plugin uninstall ${p.id} --scope ${p.scope}\` there` };
  const r = claude(["plugin", "uninstall", p.id, "--keep-data", "--scope", p.scope ?? "user"], p.projectPath);
  if (!r.ok) return { ok: false, message: `${p.id}: ${r.reason}` };
  recordRemovedPlugin(p.id, p.scope ?? "user", p.projectPath);
  return { ok: true, message: `${p.id} is uninstalled${whereOf(p)} (Settings › Backups reinstalls it)` };
}

/**
 * Updates a plugin from its marketplace. Never confirms for you: when the marketplace declares a
 * command to run, `claude` stops and asks, and you run the update yourself.
 */
export function updatePlugin(p: PluginRef): { ok: boolean; message: string } {
  if (p.synced) return { ok: false, message: `${p.id} is synced from your claude.ai account: it updates from there` };
  if (p.settingsOnly) return { ok: false, message: `${p.id} isn't installed, only turned on in your settings: install it with /plugin to update it` };
  const r = claude(["plugin", "update", p.id, ...(p.scope ? ["--scope", p.scope] : [])], p.projectPath);
  return r.ok
    ? { ok: true, message: `${p.id} is updated${whereOf(p)}; Claude Code uses the new version after a restart` }
    : { ok: false, message: `${p.id}: ${r.reason}; to update it yourself, run \`claude plugin update ${p.id}\`${p.projectPath ? ` in ${p.projectPath}` : ""}` };
}

function removedFile(): string {
  return join(skilllibHome(), "plugin-backup.json");
}

type Removed = { id: string; scope: string; projectPath?: string; at: string };

/**
 * Keeps your skills and removes the plugin that duplicates them. Every skill
 * it ships is copied into Your skills first, so nothing it brought is lost.
 * "delete" uninstalls it (restorable from Health); "off" only disables it.
 */
export function removePlugin(plugin: ClaudePlugin, how: "delete" | "off"): { ok: boolean; message: string } {
  if (plugin.scope && plugin.scope !== "user" && !plugin.projectPath) {
    return { ok: false, message: `${plugin.id}: installed for one project; run \`claude plugin ${how === "delete" ? "uninstall" : "disable"} ${plugin.id} --scope ${plugin.scope}\` there` };
  }
  // Check the CLI works before changing anything.
  if (!plugin.synced && !claudeBinary()) {
    return { ok: false, message: `${plugin.id}: nothing changed; Claude Code's CLI didn't run (tried \`claude\` on your PATH and ~/.local/bin/claude)` };
  }
  const imported = plugin.skills.filter((dir) => latestVersion(basename(dir)) === null).map((dir) => importSkill(dir).name);
  const scope = plugin.scope ? ["--scope", plugin.scope] : [];
  const r = plugin.synced
    ? // Synced plugins aren't installed, so `claude plugin` can't touch them: their switch is enabledPlugins.
      setPluginIn(join(claudeDir(), "settings.json"), plugin.id, false)
    : claude(["plugin", how === "delete" ? "uninstall" : "disable", plugin.id, ...scope], plugin.projectPath);
  const saved = imported.length ? `; ${imported.join(", ")} copied into Your skills` : "";
  if (!r.ok) return { ok: false, message: `${plugin.id}: ${r.reason}${saved}` };
  if (how === "delete" && !plugin.synced) recordRemovedPlugin(plugin.id, plugin.scope ?? "user", plugin.projectPath);
  return { ok: true, message: `${plugin.id} ${how === "delete" && !plugin.synced ? "removed" : "turned off"}${saved}` };
}

/** Remembers a plugin skilllib uninstalled, so it can be reinstalled from the backups. */
export function recordRemovedPlugin(id: string, scope: string, projectPath?: string) {
  const list = readJson<Removed[]>(removedFile()) ?? [];
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(removedFile(), JSON.stringify([...list, { id, scope, ...(projectPath ? { projectPath } : {}), at: new Date().toISOString() }], null, 2) + "\n");
}

/** Plugins skilllib removed, as Health backups. */
export function pluginBackups(): Backup[] {
  return (readJson<Removed[]>(removedFile()) ?? []).map((r) => ({
    name: r.id,
    kind: "plugin",
    // Project and local installs go back into their project.
    path: r.projectPath ? `${r.scope}:${r.projectPath}` : r.scope,
    movedAt: r.at.slice(0, 16).replace("T", " "),
    from: r.id,
  }));
}

/** Reinstalls a plugin skilllib removed, in its project for project and local installs. */
export function restorePlugin(backup: Backup): { ok: true; to: string } | { ok: false; reason: string } {
  const [scope = "user", ...rest] = backup.path.split(":");
  const projectPath = rest.join(":") || undefined;
  const r = claude(["plugin", "install", backup.from, "--scope", scope], projectPath);
  if (!r.ok) return r;
  const left = (readJson<Removed[]>(removedFile()) ?? []).filter((x) => !(x.id === backup.from && (x.projectPath ?? undefined) === projectPath && x.scope === scope));
  writeFileSync(removedFile(), JSON.stringify(left, null, 2) + "\n");
  return { ok: true, to: `Claude Code plugins (${scope}${projectPath ? ` in ${basename(projectPath)}` : ""})` };
}

/**
 * Skills in Cursor plugins (~/.cursor/plugins/cache/<marketplace>/<plugin>/<version>/skills).
 * Cursor doesn't record which plugins are on in a file skilllib can read, so these are reported, never changed.
 */
export function cursorPluginSkills(plugins = cursorPlugins()): { name: string; plugin: string; path: string }[] {
  return plugins.flatMap((p) => p.skills.map((path) => ({ name: basename(path), plugin: p.id.split("@")[0]!, path })));
}
