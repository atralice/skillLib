import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { enabledHarnesses, setKeepGlobal } from "./config.js";
import { globalInstallDirs } from "./harnesses.js";
import { addSkill, entryExists, importSkill, isLink, linkDir, type Change } from "./library.js";
import { realpathOrNull, userHome } from "./paths.js";
import { projectHere } from "./project.js";
import { isDir, isSkillDir, readSkillInfo, treeHash, copySkill } from "./skills.js";
import { recordOrigin } from "./sources.js";
import { latestVersion, versionDir, versionForHash } from "./versions.js";

/** skills.sh search hit. `source` is `owner/repo` when the skill lives on GitHub. */
export type SkillHit = { name: string; source: string; skillId: string; installs: number };

const SEARCH_API = process.env.SKILLLIB_SKILLS_API || "https://skills.sh";
const MAX_BYTES = 32 * 1024 * 1024;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

export async function searchSkills(query: string): Promise<SkillHit[]> {
  const url = `${SEARCH_API}/api/search?${new URLSearchParams({ q: query, limit: "20" })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`skills.sh search failed (${res.status})`);
  const data = (await res.json()) as { skills?: { name?: string; source?: string; skillId?: string; id?: string; installs?: number }[] };
  return (data.skills ?? []).map((s) => ({
    name: s.name || s.skillId || s.id || "",
    source: s.source || "",
    skillId: s.skillId || s.name || "",
    installs: s.installs ?? 0,
  }));
}

export type InstallSpec = { owner: string; repo: string; skill?: string } | { local: string };

const NAME = /^[A-Za-z0-9_.-]+$/;

/** `owner/repo`, `owner/repo@skill`, `owner/repo/skill`, a skills.sh or GitHub URL, or a local folder. */
export function parseInstallSpec(input: string): InstallSpec | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("~") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { local: trimmed.replace(/^~(?=$|[\\/])/, userHome()) };
  }
  let text = trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "skills.sh" && parts.length >= 2) text = parts.length >= 3 ? `${parts[0]}/${parts[1]}@${parts.slice(2).join("/")}` : `${parts[0]}/${parts[1]}`;
    else if (host === "github.com" && parts.length >= 2) {
      const repo = parts[1]!.replace(/\.git$/, "");
      if (parts[2] === "tree" && parts.length >= 5) return namePair(parts[0]!, repo, parts.slice(4).join("/"));
      return namePair(parts[0]!, repo);
    } else return null;
  } catch {
    // not a URL
  }
  const at = text.split("@");
  if (at.length === 2 && at[0]?.includes("/") && at[1] && at[0].split("/").length === 2) {
    const [owner, repo] = at[0].split("/") as [string, string];
    return namePair(owner, repo, at[1]);
  }
  const parts = text.split("/");
  if (parts.length === 2) return namePair(parts[0]!, parts[1]!);
  if (parts.length >= 3) return namePair(parts[0]!, parts[1]!, parts.slice(2).join("/"));
  return null;
}

function namePair(owner: string, repo: string, skill?: string): InstallSpec | null {
  if (!NAME.test(owner) || !NAME.test(repo) || owner === "." || repo === "." || owner === ".." || repo === "..") return null;
  return skill ? { owner, repo, skill } : { owner, repo };
}

function escapes(root: string, path: string): boolean {
  const base = realpathOrNull(root);
  const real = realpathOrNull(path);
  if (!base || !real) return true;
  return real !== base && !real.startsWith(base + sep);
}

/** Skill folders under `root`. A directory with SKILL.md is one skill; we don't look inside it. */
export function findSkillDirs(root: string, depth = 0): string[] {
  if (depth > 6 || !isDir(root)) return [];
  if (isSkillDir(root)) return escapes(root, root) ? [] : [root];
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((n) => !n.startsWith(".") && !SKIP.has(n)).flatMap((n) => {
    const path = join(root, n);
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (!st?.isDirectory()) return [];
    if (st.isSymbolicLink() && escapes(root, path)) return [];
    return findSkillDirs(path, depth + 1);
  });
}

function skillNamed(dirs: string[], skill: string | undefined): string[] {
  if (!skill) return dirs;
  const want = skill.split("/").filter(Boolean).pop()!;
  return dirs.filter((d) => basename(d) === want || readSkillInfo(d).name === want);
}

/** Downloads a public GitHub repo tarball and returns the extracted root. Caller deletes `tmp`. */
export async function downloadGitHub(owner: string, repo: string): Promise<{ tmp: string; root: string }> {
  const dest = mkdtempSync(join(tmpdir(), "skilllib-"));
  const archive = join(dest, "repo.tar.gz");
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`couldn't download ${owner}/${repo} (${err instanceof Error ? err.message : err})`);
  }
  if (!res.ok || !res.body) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(res.status === 404 ? `${owner}/${repo} not found on GitHub` : `couldn't download ${owner}/${repo} (${res.status})`);
  }
  const host = new URL(res.url).hostname;
  if (host !== "codeload.github.com" && host !== "github.com") {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`refusing to download ${owner}/${repo} from ${host}`);
  }
  let bytes = 0;
  try {
    await pipeline(
      Readable.from(
        (async function* () {
          const reader = res.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            bytes += value.byteLength;
            if (bytes > MAX_BYTES) throw new Error(`${owner}/${repo} is larger than ${MAX_BYTES / 1024 / 1024}MB`);
            yield value;
          }
        })(),
      ),
      createWriteStream(archive),
    );
    execFileSync("tar", ["-xzf", archive, "-C", dest], { stdio: "ignore" });
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    if (err instanceof Error && /larger than|couldn't download/.test(err.message)) throw err;
    throw new Error(`couldn't extract ${owner}/${repo}`);
  }
  rmSync(archive, { force: true });
  const top = readdirSync(dest);
  const root = top.length === 1 && statSync(join(dest, top[0]!)).isDirectory() ? join(dest, top[0]!) : dest;
  return { tmp: dest, root };
}

export type InstalledSkill = {
  name: string;
  source: string;
  status: "added" | "updated" | "unchanged" | "exists" | "skipped";
  reason?: string;
  project?: Change;
  /** Global folders the skill was written to. */
  global?: string[];
};

/**
 * Copies the library skill into the fewest global folders the enabled harnesses
 * read, and marks it kept. A copy already there with content the library has no
 * version of is left alone unless `force`.
 */
export function installGlobal(name: string, { force = false } = {}): { ok: true; dirs: string[] } | { ok: false; reason: string } {
  const latest = latestVersion(name);
  if (!latest) return { ok: false, reason: "not in the library" };
  const parents = globalInstallDirs(enabledHarnesses());
  if (!parents.length) return { ok: false, reason: "no agents chosen yet (skilllib harnesses)" };
  const [primary, ...links] = parents;
  const dest = join(primary!, name);
  if (entryExists(dest) && !isLink(dest) && !isDir(dest)) return { ok: false, reason: `${dest} is a file` };
  const there = treeHash(dest);
  if (there && there !== latest.hash && versionForHash(name, there) === null && !force) {
    return { ok: false, reason: `${name} is already global, with edits that aren't in your library (pass --force to replace them)` };
  }
  if (there !== latest.hash) {
    if (isLink(dest)) rmSync(dest, { force: true });
    mkdirSync(primary!, { recursive: true });
    copySkill(versionDir(name, latest.version), dest);
  }
  const wrote = [dest];
  for (const dir of links) {
    const link = join(dir, name);
    if (isLink(link) && realpathOrNull(link) === null) rmSync(link, { force: true });
    else if (entryExists(link)) {
      if (realpathOrNull(link) === realpathOrNull(dest)) wrote.push(link);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    linkDir(realpathOrNull(dest) ?? dest, join(realpathOrNull(dir) ?? dir, name));
    wrote.push(link);
  }
  setKeepGlobal([name], true);
  return { ok: true, dirs: wrote };
}

/** Imports skill folders into the library, then into this project or the global folders. */
export function installFound(
  dirs: string[],
  source: string,
  { force = false, global = false, allowTracked = false }: { force?: boolean; global?: boolean; allowTracked?: boolean } = {},
): InstalledSkill[] {
  const root = global ? null : projectHere();
  const label = source.startsWith("/") || source.startsWith(".") ? source : `skills.sh: ${source}`;
  return dirs.map((dir) => {
    const imported = importSkill(dir, { force });
    if (imported.status !== "exists") recordOrigin(imported.name, label);
    const row: InstalledSkill = { name: imported.name, source, status: imported.status };
    if (imported.status === "exists") {
      row.reason = "the library already has a different version (pass --force)";
      return row;
    }
    if (global) {
      const placed = installGlobal(imported.name, { force });
      if (!placed.ok) {
        row.status = "skipped";
        row.reason = placed.reason;
      } else row.global = placed.dirs;
      return row;
    }
    if (!root) return row;
    row.project = addSkill(root, imported.name, { force, allowTracked });
    if (row.project.action === "skipped") {
      row.status = "skipped";
      row.reason = row.project.reason;
    }
    return row;
  });
}

/** Local folder, or a downloaded GitHub repo. `many` is a repo with several skills and no name picked. */
export async function resolveInstallDir(spec: InstallSpec): Promise<{ tmp?: string; dirs: string[]; source: string; many: boolean }> {
  if ("local" in spec) {
    const path = resolve(spec.local);
    if (!existsSync(path)) throw new Error(`${path} doesn't exist`);
    const dirs = isSkillDir(path) ? [path] : findSkillDirs(path);
    return { dirs, source: path, many: dirs.length > 1 };
  }
  const got = await downloadGitHub(spec.owner, spec.repo);
  const source = spec.skill ? `${spec.owner}/${spec.repo}@${spec.skill}` : `${spec.owner}/${spec.repo}`;
  const dirs = skillNamed(findSkillDirs(got.root), spec.skill);
  return { tmp: got.tmp, dirs, source, many: !spec.skill && dirs.length > 1 };
}
