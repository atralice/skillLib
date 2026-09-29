import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { importSkill, type Backup } from "./library.js";
import { claudeDir, skilllibHome, userHome } from "./paths.js";
import { skillDirsIn } from "./skills.js";
import type { SourcedSkill } from "./sources.js";
import { latestVersion } from "./versions.js";

/** A Claude Code plugin that ships skills. */
export type ClaudePlugin = {
  /** name@marketplace, as `claude plugin` takes it. */
  id: string;
  /** Install scope (user, project, local); null for plugins synced from claude.ai. */
  scope: string | null;
  /** For project and local scope: the project it's installed in (`claude plugin` must run there). */
  projectPath?: string;
  synced: boolean;
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

/**
 * The Claude Code CLI to run: `claude` on PATH if it works, else the native
 * installer's ~/.local/bin/claude (or the older ~/.claude/local/claude).
 * Terminals like cmux put a `claude` wrapper first on PATH that can fail to
 * find the real one. Null if none runs.
 */
export function claudeBinary(): string | null {
  const candidates = ["claude", join(userHome(), ".local", "bin", "claude"), join(userHome(), ".claude", "local", "claude")];
  return (
    candidates.find((bin) => {
      try {
        return execFileSync(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, encoding: "utf-8" }).includes("Claude Code");
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** Runs the Claude Code CLI; its own commands keep its settings and caches right. */
function claude(args: string[], cwd?: string): { ok: true } | { ok: false; reason: string } {
  const bin = claudeBinary();
  if (!bin) return { ok: false, reason: `Claude Code's CLI didn't run (tried \`claude\` on your PATH and ~/.local/bin/claude); run \`claude ${args.join(" ")}\` yourself` };
  try {
    execFileSync(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, encoding: "utf-8" });
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
 * Plugins synced from claude.ai aren't installed, so `claude plugin` can't
 * touch them; Claude Code's documented switch is "<name>@synced": false in
 * enabledPlugins (~/.claude/settings.json).
 */
function turnOffSynced(id: string): { ok: true } | { ok: false; reason: string } {
  return setPluginIn(join(claudeDir(), "settings.json"), id, false);
}

/**
 * Turns a plugin off in one repo only; it stays on everywhere else. `claude
 * plugin disable --scope local`, run in the repo, writes "<id>": false to its
 * .claude/settings.local.json, which overrides the user and project settings
 * (checked with Claude Code 2.1.283). Synced plugins get the same line written directly.
 */
export function turnOffIn(plugin: ClaudePlugin, root: string): { ok: boolean; message: string } {
  const r = plugin.synced
    ? setPluginIn(join(root, ".claude", "settings.local.json"), plugin.id, false)
    : claude(["plugin", "disable", plugin.id, "--scope", "local"], root);
  return r.ok ? { ok: true, message: `${plugin.id} turned off in ${basename(root)}; other repos keep it` } : { ok: false, message: `${plugin.id}: ${r.reason}` };
}

function removedFile(): string {
  return join(skilllibHome(), "plugin-backup.json");
}

type Removed = { id: string; scope: string; at: string };

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
    ? turnOffSynced(plugin.id)
    : claude(["plugin", how === "delete" ? "uninstall" : "disable", plugin.id, ...scope], plugin.projectPath);
  const saved = imported.length ? `; ${imported.join(", ")} copied into Your skills` : "";
  if (!r.ok) return { ok: false, message: `${plugin.id}: ${r.reason}${saved}` };
  if (how === "delete" && !plugin.synced) recordRemovedPlugin(plugin.id, plugin.scope ?? "user");
  return { ok: true, message: `${plugin.id} ${how === "delete" && !plugin.synced ? "removed" : "turned off"}${saved}` };
}

/** Remembers a plugin skilllib uninstalled, so it can be reinstalled from the backups. */
export function recordRemovedPlugin(id: string, scope: string) {
  const list = readJson<Removed[]>(removedFile()) ?? [];
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(removedFile(), JSON.stringify([...list, { id, scope, at: new Date().toISOString() }], null, 2) + "\n");
}

/** Plugins skilllib removed, as Health backups. */
export function pluginBackups(): Backup[] {
  return (readJson<Removed[]>(removedFile()) ?? []).map((r) => ({
    name: r.id,
    kind: "plugin",
    path: r.scope,
    movedAt: r.at.slice(0, 16).replace("T", " "),
    from: r.id,
  }));
}

/** Reinstalls a plugin skilllib removed. */
export function restorePlugin(backup: Backup): { ok: true; to: string } | { ok: false; reason: string } {
  const r = claude(["plugin", "install", backup.from, "--scope", backup.path]);
  if (!r.ok) return r;
  writeFileSync(removedFile(), JSON.stringify((readJson<Removed[]>(removedFile()) ?? []).filter((x) => x.id !== backup.from), null, 2) + "\n");
  return { ok: true, to: `Claude Code plugins (${backup.path})` };
}

/**
 * Skills in Cursor plugins (~/.cursor/plugins/cache/<marketplace>/<plugin>/<version>/skills).
 * Cursor doesn't record which plugins are on in a file skilllib can read, so these are reported, never changed.
 */
export function cursorPluginSkills(): { name: string; plugin: string; path: string }[] {
  const cache = join(userHome(), ".cursor", "plugins", "cache");
  const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((d) => !d.startsWith(".") && statSync(join(p, d)).isDirectory()) : []);
  return dirs(cache).flatMap((marketplace) =>
    dirs(join(cache, marketplace)).flatMap((plugin) => {
      const versions = dirs(join(cache, marketplace, plugin)).map((v) => join(cache, marketplace, plugin, v));
      const newest = versions.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      return newest ? skillDirsIn(join(newest, "skills")).map((path) => ({ name: basename(path), plugin, path })) : [];
    }),
  );
}
