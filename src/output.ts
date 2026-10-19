import { resolve, sep } from "node:path";
import { realPath, userHome } from "./paths.js";
import type {
  AgentSkillJson,
  AllChangesJson,
  ChangesJson,
  ApplyJson,
  DoctorJson,
  ErrorJson,
  GlobalMoveJson,
  ImportJson,
  ListJson,
  OutdatedJson,
  ProjectsJson,
  ShowJson,
  StatusJson,
  UsageJson,
} from "./json.js";

let jsonMode = false;

/**
 * JSON mode (--json): stdout carries exactly one JSON document, for agents and
 * scripts. Messages, warnings and hints move to stderr, without color.
 */
export function setJsonMode(on: boolean) {
  jsonMode = on;
}

export const isJsonMode = () => jsonMode;

/** What each command prints with --json: the public types in json.ts. */
type JsonOutputs = {
  status: StatusJson;
  list: ListJson;
  show: ShowJson;
  projects: ProjectsJson;
  /** add, remove, and sync or update in one project */
  changes: ChangesJson;
  /** sync --all, update --all */
  "changes --all": AllChangesJson;
  outdated: OutdatedJson;
  import: ImportJson;
  doctor: DoctorJson;
  apply: ApplyJson;
  "global move": GlobalMoveJson;
  usage: UsageJson;
  "agent-skill": AgentSkillJson;
  /** Any command that fails: exit code 1, and the reason (also on stderr). */
  error: ErrorJson;
};

/**
 * Prints `data` as the command's JSON result, on one line: agents pay for every token.
 * `output` names its published type, so every --json result is checked against it.
 */
export function json<K extends keyof JsonOutputs>(output: K, data: JsonOutputs[K]) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

const color = (code: number) => (s: string) => (process.stdout.isTTY && !jsonMode ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = color(32);
export const yellow = color(33);
export const red = color(31);
export const dim = color(2);

const out = (msg: string) => (jsonMode ? console.error(msg) : console.log(msg));
export const info = (msg: string) => out(msg);
export const success = (msg: string) => out(`${green("✓")} ${msg}`);
export const warn = (msg: string) => out(`${yellow("!")} ${msg}`);
export const error = (msg: string) => console.error(`${red("✗")} ${msg}`);

/** Home-relative path for display, with "/" so it reads the same on every OS (`~/.claude/skills`, also on Windows). */
export function tildify(path: string): string {
  // $HOME normalized (a trailing or doubled slash), then without symlinks (the folder you're in comes back that way).
  for (const home of new Set([resolve(userHome()), realPath(userHome())]))
    if (path === home || path.startsWith(home + sep)) path = "~" + path.slice(home.length);
  // Always "/", so labels read the same on every OS.
  return path.replace(/\\/g, "/");
}

export function truncate(s: string, max: number): string {
  const line = s.replace(/\s+/g, " ");
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

const visible = (s: string) => s.replace(/\x1b\[\d+m/g, "");

export function table(rows: Record<string, string>[]) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => visible(r[k] ?? "").length)));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visible(s).length));
  info(dim(keys.map((k, i) => pad(k, widths[i]!)).join("  ")));
  for (const row of rows) info(keys.map((k, i) => pad(row[k] ?? "", widths[i]!)).join("  ").trimEnd());
}

/** A time as "2026-09-25 20:55", in local time (backups and installs are named in UTC). */
export function localStamp(ms: number): string {
  const at = new Date(ms);
  return new Date(ms - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace("T", " ");
}
