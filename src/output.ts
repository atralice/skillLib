import { sep } from "node:path";
import { homedir } from "node:os";

let jsonMode = false;

/**
 * JSON mode (--json): stdout carries exactly one JSON document, for agents and
 * scripts. Messages, warnings and hints move to stderr, without color.
 */
export function setJsonMode(on: boolean) {
  jsonMode = on;
}

/** Prints `data` as the command's JSON result, on one line: agents pay for every token. */
export function json(data: unknown) {
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

/** Home-relative path for display. */
export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
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
