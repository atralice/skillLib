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

/** Claude Code plugins behind the plugin skills machineSkills found. */
export function claudePlugins(machine: SourcedSkill[]): ClaudePlugin[] {
  const installed = readJson<{ plugins?: Record<string, { scope?: string }[]> }>(join(claudeDir(), "plugins", "installed_plugins.json"))?.plugins ?? {};
  const byOrigin = new Map<string, string[]>();
  for (const m of machine) if (m.kind === "plugin") byOrigin.set(m.origin, [...(byOrigin.get(m.origin) ?? []), m.path]);
  return [...byOrigin].map(([origin, skills]) => {
    const synced = origin.endsWith(" (claude.ai)");
    const id = synced ? `${origin.replace(" (claude.ai)", "")}@synced` : origin;
    return { id, scope: synced ? null : (installed[origin]?.[0]?.scope ?? "user"), synced, skills, extras: extrasOf(dirname(dirname(skills[0]!))) };
  });
}

/** Runs the Claude Code CLI; its own commands keep its settings and caches right. */
function claude(args: string[]): { ok: true } | { ok: false; reason: string } {
  try {
    execFileSync("claude", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, encoding: "utf-8" });
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; stdout?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, reason: `run \`claude ${args.join(" ")}\` yourself (the claude command isn't on your PATH)` };
    return { ok: false, reason: (e.stderr || e.stdout || e.message || "failed").trim().split("\n").slice(-1)[0]! };
  }
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
  const imported = plugin.skills.filter((dir) => latestVersion(basename(dir)) === null).map((dir) => importSkill(dir).name);
  const scope = plugin.scope ? ["--scope", plugin.scope] : [];
  const r = how === "delete" && !plugin.synced ? claude(["plugin", "uninstall", plugin.id, ...scope]) : claude(["plugin", "disable", plugin.id, ...scope]);
  const saved = imported.length ? `; ${imported.join(", ")} copied into Your skills` : "";
  if (!r.ok) return { ok: false, message: `${plugin.id}: ${r.reason}${saved}` };
  if (how === "delete" && !plugin.synced) {
    const list = readJson<Removed[]>(removedFile()) ?? [];
    mkdirSync(skilllibHome(), { recursive: true });
    writeFileSync(removedFile(), JSON.stringify([...list, { id: plugin.id, scope: plugin.scope ?? "user", at: new Date().toISOString() }], null, 2) + "\n");
  }
  return { ok: true, message: `${plugin.id} ${how === "delete" && !plugin.synced ? "removed" : "turned off"}${saved}` };
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
