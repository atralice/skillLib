import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { libraryDir, skilllibHome } from "./paths.js";
import { copySkill, treeHash } from "./skills.js";

/**
 * Library skills are versioned like packages. Every time a library skill's
 * content changes, it gets the next version number and an immutable copy in
 * ~/.skilllib/store/<name>/<version>/. Projects record the version they
 * installed, so `sync` can restore exactly that and `update` can move ahead.
 */
export type Version = { version: number; hash: string; date: string };

function storeDir(name: string): string {
  return join(skilllibHome(), "store", name);
}

function indexFile(name: string): string {
  return join(storeDir(name), "versions.json");
}

export function versionHistory(name: string): Version[] {
  try {
    return JSON.parse(readFileSync(indexFile(name), "utf-8")) as Version[];
  } catch {
    return [];
  }
}

export function versionDir(name: string, version: number): string {
  return join(storeDir(name), String(version));
}

// Library hashes don't change while a command runs unless skilllib changes the
// library itself, which calls forgetLatest(); the TUI clears it on every reload.
const latestCache = new Map<string, Version | null>();

export function forgetLatest(name?: string) {
  if (name) latestCache.delete(name);
  else latestCache.clear();
}

/**
 * The newest version of a library skill, recording a new one if the library
 * copy changed since the last version. Null if the skill isn't in the library.
 */
export function latestVersion(name: string): Version | null {
  if (latestCache.has(name)) return latestCache.get(name) ?? null;
  const source = join(libraryDir(), name);
  const hash = treeHash(source);
  let result: Version | null = null;
  if (hash) {
    const history = versionHistory(name);
    const last = history[history.length - 1];
    if (last?.hash === hash && existsSync(versionDir(name, last.version))) {
      result = last;
    } else {
      const next: Version = { version: (last?.version ?? 0) + 1, hash, date: new Date().toISOString() };
      mkdirSync(storeDir(name), { recursive: true });
      copySkill(source, versionDir(name, next.version));
      writeFileSync(indexFile(name), JSON.stringify([...history, next], null, 2) + "\n");
      result = next;
    }
  }
  latestCache.set(name, result);
  return result;
}

/** The version whose content has this hash, if any (newest first). */
export function versionForHash(name: string, hash: string): Version | null {
  return [...versionHistory(name)].reverse().find((v) => v.hash === hash) ?? null;
}

export function getVersion(name: string, version: number): Version | null {
  return versionHistory(name).find((v) => v.version === version) ?? null;
}
