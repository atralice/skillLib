/**
 * The TUI: Places (your skills, Global, Health, every repo) → a list → details, with each
 * skill's issues and fixes. It renders a World (world.ts); `reload` reads it again after a change.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { HARNESSES, type HarnessId } from "../harnesses.js";
import { ListPanel, Panel, wrap, type Cell, type Row } from "./components.js";
import { color } from "./theme.js";
import { userHome } from "../paths.js";
import { reviewPrompt, writeSkillPrompt } from "./prompts.js";
import * as W from "./world.js";

/** Home-relative path for labels. */
function tildify(p: string): string {
  return p.startsWith(userHome()) ? "~" + p.slice(userHome().length) : p;
}

type Place = "projects" | "library" | "global" | "health" | "settings";
const PLACES: [Place, string][] = [
  ["projects", "Projects"],
  ["library", "Your skills"],
  ["global", "Global"],
  ["health", "Health"],
  ["settings", "Settings"],
];
/** The tabs above a list; "issues" keeps only rows with an issue, the others filter by source. */
type Chip = W.Filter | "issues";
const CHIPS: [Chip, string][] = [
  ["all", "All"],
  ["issues", "Issues"],
  ["local", "Local"],
  ["global", "Global"],
  ["plugins", "Plugins"],
  ["vendor", "Vendor"],
];
const SEV: Record<W.Severity, { icon: string; color: string }> = {
  problem: { icon: "✕", color: color.red },
  warning: { icon: "⚠", color: color.yellow },
  hint: { icon: "·", color: color.blue },
};
/** Terminals this wide get the Places sidebar instead of the tab bar. */
const SIDEBAR_AT = 80;
const SIDEBAR_W = 28;

type Seg = [text: string, color?: string];
type Option = { label: string; fix?: W.Fix; action?: () => void; issue?: W.Issue; recommended?: boolean };
/** A detail line: text, one option on its own line (fixes), or a `row` of options side by side (actions). */
type Line = { segs: Seg[]; option?: number; row?: number[] };
type Detail = { title: string; body: Line[]; options: Option[] };
type Item = {
  key: string;
  header?: boolean;
  /** An action row ("+ Add a skill…"): pinned on top, hidden while filtering. */
  action?: boolean;
  /** Source group, for the tabs. */
  group?: W.Filter;
  cells: Cell[];
  issues: W.Issue[];
  uses: number;
  name: string;
  detail?: (width: number) => Detail;
  onEnter?: () => void;
  /** Groups it could be in (see W.groupCandidates), and what it is, for a group's actions. */
  cands?: W.GroupKey[];
  skill?: W.Usable;
  lib?: W.LibrarySkill;
  /** A group's row; `inFold`: a member shown under its open group. */
  fold?: { key: string; open: boolean };
  inFold?: string;
};
type Modal =
  /** `toast`: for a follow-up question, what the change before it said; shown again if you say no. */
  | { kind: "confirm"; fix: W.Fix; toast?: string }
  | { kind: "repos"; fix: W.Fix; picked: Set<string>; cursor: number; only?: string[]; query: string }
  /** `target`: the repo to add to, or null for your library. */
  | { kind: "add"; cursor: number; query: string; target: string | null }
  | { kind: "fixall"; items: { label: string; fix: W.Fix; on: boolean }[]; cursor: number }
  | { kind: "help" }
  | { kind: "menu"; title: string; options: Option[]; cursor: number }
  /** `placeholder`: shown while the field is empty, and what enter submits then. */
  | { kind: "input"; title: string; value: string; placeholder?: string; submit: (value: string) => void }
  /** Pick your agents; `then` runs after (the first run asks for your projects folder next). */
  | { kind: "agents"; selected: HarnessId[]; cursor: number; then?: () => void };

const bySeverity = (a: W.Issue, b: W.Issue) => W.SEVERITY_RANK[a.severity] - W.SEVERITY_RANK[b.severity];

function tag(u: W.Usable, w: W.World): Seg {
  const s = u.local;
  if (s?.source === "lib") {
    return [`lib v${s.version}`, color.accent];
  }
  if (s) return [s.source, color.blue];
  if (u.source === "global") return [u.machine?.kept ? "global ✓" : "global", color.yellow];
  if (u.source === "plugin") return [`⧉ ${u.where.split("@")[0]}`, color.magenta];
  if (u.source === "skilllib") return ["◆ skilllib", color.accent];
  return [u.source, color.muted];
}

/** Keys that can be part of a name: they filter instead of acting. */
function isNameChar(input: string, key: Key): boolean {
  return !key.ctrl && !key.meta && /^[a-zA-Z0-9._-]$/.test(input);
}

/** Truncates to leave a one-space gap before the next column. */
function clip(text: string, width: number): string {
  return text.length > width - 1 ? text.slice(0, width - 2) + "…" : text;
}

function usesText(n: number): string {
  return (n ? String(n) : "–").padStart(5) + " ";
}

/** Builds a detail pane: static lines plus selectable options. */
function builder(title: string) {
  const d: Detail = { title, body: [], options: [] };
  return {
    d,
    line: (...segs: Seg[]) => d.body.push({ segs }),
    issues(issues: W.Issue[]) {
      if (!issues.length) return d.body.push({ segs: [["✓ No issues", color.green]] });
      for (const issue of [...issues].sort(bySeverity)) {
        d.body.push({ segs: [[`${SEV[issue.severity].icon} `, SEV[issue.severity].color], [issue.title, color.text], [issue.decision ? "  · your call" : "", color.faint]] });
        issue.fixes.forEach((fix, i) => d.body.push({ segs: [], option: d.options.push({ label: fix.label, fix, issue, recommended: !issue.decision && i === 0 }) - 1 }));
      }
      return 0;
    },
    /** Everything else you can do, side by side, wrapping at `width`. Skips what an issue above already offers. */
    actions(options: Option[], width: number) {
      const offered = new Set(d.options.map((o) => o.label));
      let line: Line = { segs: [["Actions  ", color.accent]], row: [] };
      let used = 9;
      d.body.push({ segs: [] }, line);
      for (const o of options.filter((o) => !offered.has(o.label))) {
        if (line.row!.length && used + 3 + o.label.length > width - 6) {
          d.body.push((line = { segs: [["         "]], row: [] }));
          used = 9;
        }
        used += (line.row!.length ? 3 : 0) + o.label.length;
        line.row!.push(d.options.push(o) - 1);
      }
    },
  };
}

/** Column titles, aligned with a list's cells. */
function titles(cols: [title: string, width: number][]): Cell[] {
  return cols.map(([t, width], i) => (i === cols.length - 1 ? { text: t, grow: true, color: color.faint } : { text: t.slice(0, width).padEnd(width), width, color: color.faint }));
}

function TitleRow({ cells, width }: { cells: Cell[]; width: number }) {
  const fixed = cells.filter((c) => !c.grow).reduce((n, c) => n + (c.width ?? 0), 0);
  return (
    <Box height={1} overflow="hidden">
      <Text color={color.faint} wrap="truncate-end">
        {"  " + cells.map((c) => (c.grow ? c.text.padEnd(Math.max(0, width - 6 - fixed)) : c.text)).join("")}
      </Text>
    </Box>
  );
}

const fixOption = (fix: W.Fix): Option => ({ label: fix.label, fix });

const GIT_LABEL: Record<NonNullable<W.LocalSkill["git"]>, string> = { committed: "✓ committed", changed: "± uncommitted changes", new: "+ not committed", ignored: "∅ gitignored" };

// ─── Screens' data ──────────────────────────────────────

/** Which copy a skill's row shows when it loads from several places: the repo's, then yours, then vendors'. */
const COPY_RANK: Record<W.Source, number> = { lib: 0, repo: 0, untracked: 0, global: 1, skilllib: 1, plugin: 2, "claude.ai": 3, cursor: 3, system: 3 };

/** Copies grouped by name, the copy to show first. */
function byName(copies: W.Usable[]): W.Usable[][] {
  const groups = new Map<string, W.Usable[]>();
  for (const c of copies) groups.set(c.name, [...(groups.get(c.name) ?? []), c]);
  return [...groups.values()].map((g) => g.sort((a, b) => COPY_RANK[a.source] - COPY_RANK[b.source]));
}

/** Every copy's issues on one row, each once. */
function mergeIssues(lists: W.Issue[][]): W.Issue[] {
  const seen = new Set<string>();
  return lists.flat().filter((i) => !seen.has(i.id) && seen.add(i.id));
}

const BLOCKS = " ▁▂▃▄▅▆▇█";

/** Daily values as bars `height` rows tall; a gap between days when there's room. */
function barChart(values: number[], width: number, height = 3): string[] {
  const max = Math.max(1, ...values);
  const gap = width >= values.length * 2;
  return Array.from({ length: height }, (_, r) =>
    values
      .map((v) => {
        const level = v ? Math.max(1, Math.round((v / max) * height * 8)) : 0;
        return BLOCKS[Math.max(0, Math.min(8, level - (height - 1 - r) * 8))]! + (gap ? " " : "");
      })
      .join(""),
  );
}

/** How much a skill gets used: in `repo` only, or everywhere (a 30-day chart, then one bar per repo). */
function usageLines(w: W.World, name: string, width: number, repo: string | null): Seg[][] {
  const days = W.dailyUses(w, name, repo ?? undefined);
  const total = days.reduce((a, b) => a + b, 0);
  let last = -1;
  days.forEach((v, i) => v && (last = i));
  const ago = last < 0 ? "" : last === 29 ? "today" : last === 28 ? "yesterday" : `${29 - last} days ago`;
  const head: Seg[] = [[repo ? "Usage here" : "Usage", color.accent], [total ? `   last used ${ago}` : "   not used in 30 days", color.muted]];
  if (!total) return [head];
  const chart = barChart(days, width - 8);
  const repos = Object.entries(w.usage)
    .filter(() => !repo)
    .map(([r, u]) => [r, u[name] ?? 0] as const)
    .filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1]);
  const barW = Math.max(6, Math.min(30, width - 30));
  return [
    head,
    ...chart.map((line): Seg[] => [["  " + line, color.accent]]),
    [["  30 days ago".padEnd(Math.max(14, chart[0]!.trimEnd().length - 3)) + "today", color.faint]],
    ...(repos.length ? [[] as Seg[]] : []),
    ...repos.map(([r, n]): Seg[] => [
      ["  " + clip(r, 16).padEnd(16), color.muted],
      ["█".repeat(Math.max(1, Math.round((n / repos[0]![1]) * barW))), color.accentDim],
      [` ${n}`, color.muted],
    ]),
  ];
}

/** One row per skill, whatever number of places it loads from. */
/** `repo`: the repo you're looking from, or null in Global, where everything is machine-wide. */
function skillItem(w: W.World, copies: W.Usable[], issues: W.Issue[], nameW: number, actions: Option[], repo: string | null): Item {
  const u = copies[0]!;
  const top = W.worst(issues);
  const [t, tc] = tag(u, w);
  return {
    key: u.name,
    name: u.name,
    group: W.filterOf(u.source),
    cands: W.groupCandidates(w, u),
    skill: u,
    issues,
    uses: u.uses,
    cells: [
      { text: top ? SEV[top.severity].icon : " ", width: 2, color: top ? SEV[top.severity].color : undefined },
      { text: clip(u.name, nameW), width: nameW },
      { text: clip(t, 14), width: 14, color: tc },
      { text: usesText(u.uses), width: 6, color: color.muted },
      { text: " " + (top?.short ?? ""), grow: true, color: top ? SEV[top.severity].color : color.faint },
    ],
    detail: (width) => {
      const b = builder(u.name);
      for (const l of wrap(w.descriptions[u.name] || "(no description)", width - 4, 3)) b.line([l, color.muted]);
      b.line();
      if (repo && !u.local) b.line(["Loads in every repo", color.text], [u.source === "global" || u.source === "skilllib" ? "   issues and cleanup live in Global" : "   managed at its source", color.faint]);
      else b.issues(issues);
      b.actions(actions, width);
      b.line();
      for (const segs of usageLines(w, u.name, width, repo)) b.line(...segs);
      b.line();
      b.line(["Loaded from", color.accent]);
      for (const c of copies) {
        const s = c.local;
        const path = s ? `${s.dir}/${c.name}` : c.source === "global" || c.source === "skilllib" ? `${c.where}/${c.name}` : c.where;
        const extra = s ? (s.missing ? "missing" : s.git ? GIT_LABEL[s.git] : "") : "";
        const [ct, cc] = c === u ? ["", undefined] : tag(c, w);
        b.line(["  ", undefined], [path + "  ", color.text], [ct ? ct + "  " : "", cc], [extra, color.faint]);
      }
      return b.d;
    },
  };
}

/** A repo's skills, seen from the repo: only its own issues; what loads everywhere is Global's business. */
function projectSkillItems(w: W.World, p: string, nameW: number, ui: Ui): Item[] {
  return byName(W.usable(w, p)).map((copies) =>
    skillItem(w, copies, mergeIssues(copies.filter((c) => c.local).map((c) => W.issuesOf(w, p, c))), nameW, skillActions(w, p, copies[0]!, ui), p),
  );
}

/** What the lists need from the screen: messages, jumping, the editor, copying, menus. */
type Ui = {
  notify(message: string): void;
  openInGlobal(name: string): void;
  edit(file: string): void;
  copy(text: string, what: string): void;
  menu(title: string, options: Option[]): void;
};

const reviewOption = (w: W.World, name: string, ui: Ui): Option => ({ label: "Review prompt", action: () => ui.copy(reviewPrompt(w, [name], `Review the skill ${name}.`), `a review prompt for ${name}`) });

/** Pick a library version to install in a repo (older ones too). */
function versionsOption(w: W.World, repo: string, name: string, installed: number | undefined, ui: Ui): Option {
  return {
    label: "Other versions…",
    action: () =>
      ui.menu(
        `${name}: versions`,
        w.ops
          .versions(name)
          .reverse()
          .map((v) => fixOption({ label: `v${v.version}  ${v.date}${v.version === installed ? "  (installed)" : ""}`, preview: `Install ${name} v${v.version} in ${repo}.`, run: (w) => w.ops.installVersion(repo, name, v.version) })),
      ),
  };
}

/** What you can do with a skill as a repo sees it; never empty. */
function skillActions(w: W.World, p: string, u: W.Usable, ui: Ui): Option[] {
  const s = u.local;
  const inLibrary = w.library.find((l) => l.name === u.name);
  const remove: W.Fix = { label: "Remove from repo", preview: s?.source === "lib" ? `Delete ${s.dir}/${u.name} in ${p}. Your library keeps it.` : `Move ${s?.dir}/${u.name} in ${p} to Settings › Backups.`, run: (w) => w.ops.remove(p, u.name) };
  if (s?.source === "lib")
    return [
      ...(inLibrary && s.version! < inLibrary.latest ? [fixOption({ label: `Update to v${inLibrary.latest}`, preview: `Replace ${s.dir}/${u.name} with library v${inLibrary.latest}.`, run: (w) => w.ops.update(p, u.name) })] : []),
      { label: "Edit in library", action: () => ui.edit(w.ops.libraryFile(u.name)) },
      versionsOption(w, p, u.name, s.version, ui),
      fixOption(remove),
      reviewOption(w, u.name, ui),
    ];
  if (s?.source === "repo")
    return [
      ...(inLibrary ? [] : [fixOption({ label: "Copy into library", preview: `Copy ${u.name} into your library, so other repos can add it. The repo's copy stays as it is.`, run: (w) => w.ops.copyToLibrary(p, u.name) })]),
      { label: "Edit SKILL.md", action: () => ui.edit(`${s.path}/SKILL.md`) },
      reviewOption(w, u.name, ui),
    ];
  if (s)
    return [
      inLibrary
        ? fixOption({ label: "Track it", preview: `Record ${u.name} in skilllib.json so library updates reach it.`, run: (w) => w.ops.track(p, u.name) })
        : fixOption({ label: "Import it into your library", preview: `Copy ${u.name} into your library and track it here.`, run: (w) => w.ops.importLocal(p, u.name) }),
      { label: "Edit SKILL.md", action: () => ui.edit(`${s.path}/SKILL.md`) },
      fixOption(remove),
      reviewOption(w, u.name, ui),
    ];
  // Loads everywhere: what's left to do from a repo is turning a plugin off here, or going to Global.
  return [{ label: "Open in Global", action: () => ui.openInGlobal(u.name) }, reviewOption(w, u.name, ui)];
}

/** A project at a glance: where it lives and its git state. Health is on the Issues tab. */
function overview(w: W.World, p: string): [label: string, value: Seg[]][] {
  const project = W.project(w, p);
  const info = w.ops.repoInfo(p);
  const manifest: Seg =
    project.manifest === "none"
      ? ["no skilllib.json", color.faint]
      : project.manifest === "no git"
        ? ["skilllib.json (not a git repo)", color.muted]
        : [`skilllib.json ${GIT_LABEL[project.manifest]}`, project.manifest === "committed" ? color.text : color.yellow];
  return [
    ["Folder", [[tildify(project.path), color.text]]],
    ["Remote", [[info.remote ?? "none", info.remote ? color.blue : color.faint]]],
    ["Branch", [[info.branch ?? "–", color.text], [info.dirty ? `  ${info.dirty} uncommitted` : "", color.yellow]]],
    ["Manifest", [manifest]],
  ];
}

/** Label/value pairs in `columns` columns. */
function InfoGrid({ rows, columns, width }: { rows: [string, Seg[]][]; columns: 1 | 2; width: number }) {
  const cell = Math.floor((width - 4) / columns);
  const lines: [string, Seg[]][][] = [];
  for (let i = 0; i < rows.length; i += columns) lines.push(rows.slice(i, i + columns));
  return (
    <>
      {lines.map((line, i) => (
        <SegLine
          key={i}
          segs={line.flatMap(([label, value], j): Seg[] => {
            const used = value.reduce((n, [t]) => n + t.length, 0) + 10;
            return [[label.padEnd(10), color.muted], ...value, [j < line.length - 1 ? " ".repeat(Math.max(1, cell - used)) : "", undefined]];
          })}
        />
      ))}
    </>
  );
}

function projectItems(w: W.World): Item[] {
  return w.projects.map((p) => {
    const issues = W.projectIssues(w, p.name).map((x) => x.issue);
    const t = W.tally(issues);
    return {
      key: p.name,
      name: p.name,
      issues,
      uses: 0,
      cells: [
        { text: p.name === w.cwd ? "◆ " : "  ", width: 2, color: color.accent },
        { text: p.name, width: 18 },
        { text: p.skills.length ? `${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}` : "–", width: 10, color: color.muted },
        { text: t.problem ? `✕ ${t.problem}` : "", width: 5, color: color.red },
        { text: t.warning ? `⚠ ${t.warning}` : "", width: 5, color: color.yellow },
        { text: t.hint ? `· ${t.hint}` : "", grow: true, color: color.blue },
      ] as Cell[],
    };
  });
}

function globalItems(w: W.World, nameW: number, ui: Ui): Item[] {
  const copies = w.machine.map((m): W.Usable => ({ name: m.name, source: m.source, where: m.where, agents: m.agents, uses: W.totalUses(w, m.name), machine: m }));
  return byName(copies).map((g) => skillItem(w, g, mergeIssues(g.map((c) => W.machineIssues(w, c.machine!))), nameW, globalActions(w, g[0]!, ui), null));
}

/** Global's actions: all on the machine-wide copy (see W.machineActions), plus vendor settings you change at the source. */
function globalActions(w: W.World, u: W.Usable, ui: Ui): Option[] {
  const m = u.machine!;
  const atSource = m.source === "plugin" ? "Turn it off with /plugin in Claude Code" : m.source === "claude.ai" ? "Turn it off in claude.ai › Settings" : m.source === "system" ? `An admin manages ${m.where}` : "Cursor manages it";
  return [
    ...W.machineActions(m).map(fixOption),
    ...(m.source === "plugin" ? [fixOption(W.replacePluginFix(w, m.where))] : []),
    ...(m.source === "global" || m.source === "skilllib" ? [] : [{ label: atSource, action: () => ui.notify(`${atSource}; skilllib picks up the change next time`) }]),
    ...(m.source === "global" && !m.broken ? [{ label: "Edit SKILL.md", action: () => ui.edit(`${m.path}/SKILL.md`) }] : []),
    reviewOption(w, m.name, ui),
  ];
}

function libraryItems(w: W.World, nameW: number, ui: Ui): Item[] {
  return w.library.map((l): Item => {
    const repos = w.projects.filter((p) => p.skills.some((s) => s.name === l.name));
    // A repo's own copy (committed by the team) is never removed from here.
    const removable = repos.filter((p) => p.skills.some((s) => s.name === l.name && s.source !== "repo"));
    const uses = W.totalUses(w, l.name);
    const addFix: W.Fix = { label: "Add to repos…", preview: `Install ${l.name} v${l.latest} into the repos you pick.`, run: () => "", candidates: (w) => w.projects.filter((p) => !p.skills.some((s) => s.name === l.name)).map((p) => p.name), pickRepos: (w, rs) => w.ops.addTo(rs, [l.name]) };
    const delFix = W.deleteLibraryFix(w, [l.name]);
    const issues: W.Issue[] = repos.length ? [] : [{ id: `nowhere:${l.name}`, severity: "hint", title: "Used in no repo", short: "Used in no repo", decision: true, fixes: [addFix, delFix] }];
    const behind = repos.filter((p) => p.skills.some((s) => s.name === l.name && s.source === "lib" && s.version! < l.latest)).length;
    return {
      key: l.name,
      name: l.name,
      issues,
      uses,
      cands: W.groupCandidates(w, l),
      lib: l,
      cells: [
        { text: issues[0] ? SEV.hint.icon : " ", width: 2, color: color.blue },
        { text: clip(l.name, nameW), width: nameW },
        { text: `v${l.latest}`, width: 5, color: color.accent },
        { text: `${repos.length} repo${repos.length === 1 ? "" : "s"}${behind ? ` (${behind} behind)` : ""}`, width: 18, color: behind ? color.yellow : color.muted },
        { text: usesText(uses), width: 6, color: color.muted },
        { text: " " + (issues[0]?.short ?? w.descriptions[l.name] ?? ""), grow: true, color: issues[0] ? color.blue : color.faint },
      ],
      detail: (width) => {
        const b = builder(l.name);
        for (const line of wrap(w.descriptions[l.name] ?? "", width - 4, 3)) b.line([line, color.muted]);
        b.line();
        b.line(["Versions  ", color.muted], [Array.from({ length: l.latest }, (_, i) => `v${i + 1}`).join(" · ") + "  (newest)", color.text]);
        b.line(["In repos  ", color.muted], [repos.map((p) => { const s = p.skills.find((x) => x.name === l.name)!; return `${p.name} ${s.source === "lib" ? `v${s.version}` : s.source}`; }).join(" · ") || "none", color.text]);
        b.line();
        b.issues(issues);
        b.actions([
          fixOption(addFix),
          ...(removable.length
            ? [
                fixOption({
                  label: "Remove from repos…",
                  preview: `Pick repos to remove ${l.name} from. Your library keeps it.`,
                  run: () => "",
                  candidates: () => removable.map((p) => p.name),
                  pickRepos: (w, rs) => W.joined(rs.map((r) => w.ops.remove(r, l.name))),
                }),
              ]
            : []),
          fixOption(delFix),
          { label: "Edit SKILL.md", action: () => ui.edit(w.ops.libraryFile(l.name)) },
          reviewOption(w, l.name, ui),
        ], width);
        b.line();
        for (const segs of usageLines(w, l.name, width, null)) b.line(...segs);
        return b.d;
      },
    };
  });
}

/** Health: every skill with something to fix, in every repo and in Global, with the same details and fixes. */
function healthItems(w: W.World, nameW: number, ui: Ui): Item[] {
  const flagged = (where: string, items: Item[]) =>
    items
      .filter((i) => i.issues.length)
      .map((i): Item => ({ ...i, key: `${where}:${i.key}`, cells: [i.cells[0]!, i.cells[1]!, { text: clip(where, 16), width: 16, color: color.muted }, i.cells[4]!] }));
  return [...w.projects.flatMap((p) => flagged(p.name, projectSkillItems(w, p.name, nameW, ui))), ...flagged("Global", globalItems(w, nameW, ui)), ...agentSkillItems(w, nameW)];
}

/** The skilllib skill, when your agents don't have it (or have an old one): a row in Health like a skill's, unless Global already has its row. */
function agentSkillItems(w: W.World, nameW: number): Item[] {
  const issue = W.agentSkillIssue(w);
  if (!issue || w.machine.some((m) => m.source === "skilllib")) return [];
  const sev = SEV[issue.severity];
  return [
    {
      key: "agent-skill",
      name: "skilllib",
      issues: [issue],
      uses: 0,
      cells: [
        { text: sev.icon, width: 2, color: sev.color },
        { text: clip("skilllib", nameW), width: nameW },
        { text: clip("Your agents", 16), width: 16, color: color.muted },
        { text: " " + issue.short, grow: true, color: sev.color },
      ],
      detail: (width) => {
        const b = builder("skilllib");
        for (const l of wrap("The skilllib skill lets you ask your agents which skills they can use here, where each comes from, and which of your skills a repo should add.", width - 4, 3)) b.line([l, color.muted]);
        b.line();
        b.issues([issue]);
        return b.d;
      },
    },
  ];
}

/** The picker's cursor, kept off group titles. */
function addCursor(rows: W.AddRow[], cursor: number): number {
  const i = Math.min(cursor, rows.length - 1);
  return rows[i] && !rows[i]!.header ? i : Math.max(0, rows.findIndex((r) => !r.header));
}

// ─── App ────────────────────────────────────────────────

/** The message of a result; its follow-up (if any) is asked separately. */
const said = W.said;

export function App({ initial, reload, loadUsage }: { initial: W.World; reload: () => W.World; loadUsage?: (w: W.World) => Promise<Pick<W.World, "usage" | "days">> }) {
  const { exit, suspendTerminal } = useApp();
  const { columns: termCols, rows: termRows } = useWindowSize();
  const sidebar = termCols >= SIDEBAR_AT;
  /** Width left for the content, beside the sidebar when it shows. */
  const columns = sidebar ? termCols - SIDEBAR_W : termCols;
  const [base, setBase] = useState(initial);
  // Usage arrives after the first paint: reading transcripts is slow.
  const [used, setUsed] = useState<Pick<W.World, "usage" | "days">>();
  const world: W.World = used ? { ...base, ...used } : base;
  useEffect(() => {
    let live = true;
    void loadUsage?.(base).then((u) => live && setUsed(u));
    return () => {
      live = false;
    };
  }, [base.projects.map((p) => p.path).join("\n")]);
  const [place, setPlace] = useState<Place>("projects");
  const [openName, setOpen] = useState<string | null>(initial.cwd ?? initial.projects[0]?.name ?? null);
  // A repo can go away on reload (hidden, or no longer in your folders): fall back to the repo list.
  const open = openName && world.projects.some((p) => p.name === openName) ? openName : null;
  const [chip, setChip] = useState<Chip>("all");
  /** Groups you opened. */
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<Record<string, number>>({});
  // Panes go Places → list → details: enter or → goes one deeper, esc or ← one back.
  const [focus, setFocus] = useState<"sidebar" | "list" | "detail">(sidebar ? "sidebar" : "list");
  const [sideQuery, setSideQuery] = useState("");
  /** The sidebar cursor is on Help, which opens on enter rather than as you pass it. */
  const [onHelp, setOnHelp] = useState(false);
  const [detailCursor, setDetailCursor] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState<string>("");
  const order = useRef<{ key: string; keys: string[] }>({ key: "", keys: [] });

  /** Tall enough to show details under the list; shorter terminals open them on enter. */
  const split = termRows >= 30;
  const nameW = Math.min(22, Math.max(17, Math.floor(columns * 0.22)));
  const dashboard = place === "projects" && open !== null;
  const chips: [Chip, string][] =
    dashboard ? CHIPS : place === "global" ? CHIPS.filter(([c]) => c !== "local") : place === "settings" ? [] : place === "health" ? CHIPS.slice(0, 1) : CHIPS.slice(0, 2);

  // ── Current list ──
  const ui: Ui = {
    notify: setToast,
    openInGlobal,
    edit,
    copy: (text, what) => setToast(said(world.ops.copy(text, what))),
    menu: (title, options) => setModal({ kind: "menu", title, options, cursor: 0 }),
  };
  // Health's count (skills with something to fix, per repo and in Global), without building its rows.
  const flagged = [
    ...world.projects.flatMap((p) => W.projectIssues(world, p.name).map((x) => ({ key: `${p.name}:${x.skill.name}`, issue: x.issue }))),
    ...world.machine.flatMap((m) => W.machineIssues(world, m).map((issue) => ({ key: `Global:${m.name}`, issue }))),
    // The skilllib skill's issue is on its Global row when it has one (see agentSkillItems).
    ...[W.agentSkillIssue(world)].flatMap((issue) => (issue ? [{ key: "Global:skilllib", issue }] : [])),
  ];
  const healthCount = new Set(flagged.map((f) => f.key)).size;
  const healthWorst = W.worst(flagged.map((f) => f.issue));
  const all: Item[] =
    place === "projects"
      ? open
        ? projectSkillItems(world, open, nameW, ui)
        : projectItems(world)
      : place === "global"
        ? globalItems(world, nameW, ui)
        : place === "library"
          ? libraryItems(world, nameW, ui)
          : place === "health"
            ? healthItems(world, nameW, ui)
            : settingsItems();
  const inChip = (i: Item, c: Chip) => c === "all" || (c === "issues" ? i.issues.length > 0 : i.group === c);
  let items = all.filter((i) => i.header || ((!query || W.matches(i.name, query)) && inChip(i, chip)));
  // Sort by health when the view opens; don't re-sort after a fix, so rows stay under the cursor.
  // Usage arriving adds "unused" hints: sort once more then.
  const viewKey = [place, open, chip, query, used ? "usage" : ""].join("|");
  const sortable = place !== "settings" && !(place === "projects" && !open);
  if (sortable) {
    if (order.current.key !== viewKey) {
      const rank = (i: Item) => (i.issues.length ? W.SEVERITY_RANK[[...i.issues].sort(bySeverity)[0]!.severity] : 3);
      order.current = { key: viewKey, keys: [...items].sort((a, b) => rank(a) - rank(b) || b.uses - a.uses || a.name.localeCompare(b.name)).map((i) => i.key) };
    }
    const pos = new Map(order.current.keys.map((k, i) => [k, i]));
    items = [...items].sort((a, b) => (pos.get(a.key) ?? 1e9) - (pos.get(b.key) ?? 1e9));
  } else if (place === "projects") {
    const rank = (i: Item) => (i.key === world.cwd ? -1 : i.issues.some((x) => x.severity === "problem") ? 0 : i.issues.length ? 1 : 2);
    const skills = (i: Item) => W.project(world, i.name).skills.length;
    items = [...items].sort((a, b) => rank(a) - rank(b) || skills(b) - skills(a) || a.name.localeCompare(b.name));
  }
  // Related skills fold into one row; filtering shows them all.
  if (!query && (dashboard || place === "global" || place === "library")) items = folded(items);
  if (!query) items = [...actionRows(), ...items];

  const cursorKey = `${place}|${open}`;
  const firstSelectable = Math.max(0, items.findIndex((i) => !i.header && !i.action));
  let cursor = Math.min(cursors[cursorKey] ?? firstSelectable, items.length - 1);
  if (items[cursor]?.header) cursor = firstSelectable;
  const current = items[cursor];
  const detail = current?.detail?.(columns);

  // ── Actions ──
  /** Runs a change, reads the world again, and asks about any follow-up (e.g. git-tracked folders). */
  function apply(run: (w: W.World) => W.Result, w: W.World = world) {
    let result: W.Result;
    try {
      result = run(w);
    } catch (e) {
      result = W.failed(`Couldn't do it: ${(e as Error).message}`);
    }
    setBase(reload());
    const toast = `${W.isFailure(result) ? "✗" : "✓"} ${said(result)}`;
    setToast(toast);
    const then = W.followUp(result);
    if (then) setModal({ kind: "confirm", fix: then, toast });
  }
  function choose(o: Option) {
    if (o.action) return o.action();
    if (!o.fix) return setToast("Not in the prototype");
    if (o.fix.pickRepos) {
      const name = current?.name ?? "";
      const only = o.fix.candidates?.(world);
      const picked = new Set(
        (o.fix.preticked?.(world) ?? world.projects.filter((p) => (world.usage[p.name]?.[name] ?? 0) > 0 && !p.skills.some((s) => s.name === name)).map((p) => p.name)).filter(
          (p) => !only || only.includes(p),
        ),
      );
      return setModal({ kind: "repos", fix: o.fix, picked, cursor: 0, only, query: "" });
    }
    setModal({ kind: "confirm", fix: o.fix });
  }
  function fixSelected() {
    const issue = current && W.worst(current.issues);
    if (!issue) return setToast("Nothing to fix · enter shows what you can do");
    if (issue.decision) {
      setFocus("detail");
      setDetailCursor(Math.max(0, detail?.options.findIndex((o) => o.issue === issue) ?? 0));
      return setToast("Your call: pick one");
    }
    choose({ label: issue.fixes[0]!.label, fix: issue.fixes[0]! });
  }
  function fixAllList(from: Item[]) {
    const seen = new Set<string>();
    return from.flatMap((i) =>
      i.issues
        .filter((x) => !x.decision && !seen.has(`${i.key}|${x.id}`) && seen.add(`${i.key}|${x.id}`))
        .map((x) => ({ label: `${i.name}: ${x.title} → ${x.fixes[0]!.label}`, fix: x.fixes[0]!, on: true })),
    );
  }
  function toggleFold(key: string) {
    const next = new Set(folds);
    if (!next.delete(key)) next.add(key);
    setFolds(next);
  }

  /** Related skills (see W.assignGroups) as one row each, their members under it when open. */
  function folded(list: Item[]): Item[] {
    const groups = W.assignGroups(list.map((i) => i.cands ?? []));
    const out: Item[] = [];
    const seen = new Set<string>();
    list.forEach((it, i) => {
      const g = groups[i];
      if (!g) return void out.push(it);
      if (seen.has(g.key)) return;
      seen.add(g.key);
      const members = list.filter((_, j) => groups[j]?.key === g.key);
      const isOpen = folds.has(g.key);
      out.push(groupItem(g, members, isOpen));
      if (isOpen) out.push(...members.map((m): Item => ({ ...m, inFold: g.key, cells: m.cells.map((c, k) => (k === 1 ? { ...c, text: clip("  " + m.name, c.width ?? nameW) } : c)) })));
    });
    return out;
  }

  function groupItem(g: W.GroupKey, members: Item[], isOpen: boolean): Item {
    const label = W.groupLabel(g, members.map((m) => m.name));
    const issues = members.flatMap((m) => m.issues);
    const top = W.worst(issues);
    const flagged = members.filter((m) => m.issues.length).length;
    return {
      key: `fold:${g.key}`,
      name: label,
      group: members[0]!.group,
      fold: { key: g.key, open: isOpen },
      issues,
      uses: members.reduce((n, m) => n + m.uses, 0),
      cells: [
        { text: top ? SEV[top.severity].icon : " ", width: 2, color: top ? SEV[top.severity].color : undefined },
        { text: `${isOpen ? "▾" : "▸"} ${label} (${members.length})`, grow: true, color: color.accent },
        { text: flagged ? `${flagged} to fix` : "", width: 10, color: top ? SEV[top.severity].color : color.faint },
      ],
      detail: (width) => {
        const b = builder(label);
        for (const l of wrap(members.map((m) => m.name).join(", "), width - 4, 4)) b.line([l, color.muted]);
        b.line();
        if (flagged) b.line([`${flagged} of them ${flagged === 1 ? "has" : "have"} issues`, top ? SEV[top.severity].color : color.text], ["   open the group to fix them one by one", color.faint]);
        b.actions(groupActions(label, members), width);
        return b.d;
      },
    };
  }

  /** Decisions for a whole group at once: what the cleanup wizard used to do. */
  function groupActions(label: string, members: Item[]): Option[] {
    const names = members.map((m) => m.name);
    const machines = members.flatMap((m) => (m.skill?.machine ? [m.skill.machine] : []));
    const mine = machines.filter((m) => m.source === "global" && !m.broken);
    const locals = dashboard ? members.flatMap((m) => (m.skill?.local && m.skill.local.source !== "repo" ? [m.skill.local] : [])) : [];
    const libs = members.flatMap((m) => (m.lib ? [m.lib] : []));
    const usedIn = (w: W.World) => w.projects.filter((p) => names.some((n) => (w.usage[p.name]?.[n] ?? 0) > 0)).map((p) => p.name);
    const n = (k: number) => `${k} skill${k === 1 ? "" : "s"}`;
    return [
      ...(mine.length
        ? [
            fixOption({
              label: `Move all ${mine.length} to repos…`,
              preview: `Pick repos. These ${n(mine.length)} go into your library and those repos, and stop loading globally (originals backed up).`,
              run: () => "",
              preticked: usedIn,
              pickRepos: (w, repos) => w.ops.moveGlobal(mine, repos, label),
            }),
            ...(mine.some((m) => !m.kept)
              ? [fixOption({ label: `Keep all ${mine.length} global on purpose`, preview: `skilllib stops warning about these ${n(mine.length)}.`, run: (w) => (mine.forEach((m) => w.ops.keepGlobal(m.name, true)), `${n(mine.length)} marked as global on purpose`) })]
              : []),
            fixOption({ label: `Delete all ${mine.length}`, preview: `Move these ${n(mine.length)} to Settings › Backups.`, run: (w) => (mine.forEach((m) => w.ops.deleteGlobal(m)), `Deleted ${n(mine.length)} (in Settings › Backups)`) }),
          ]
        : []),
      ...(libs.length
        ? [
            fixOption({
              label: `Add all ${libs.length} to repos…`,
              preview: `Install these ${n(libs.length)} into the repos you pick.`,
              run: () => "",
              preticked: () => [],
              pickRepos: (w, repos) => w.ops.addTo(repos, libs.map((l) => l.name)),
            }),
          ]
        : []),
      ...(libs.length ? [fixOption(W.deleteLibraryFix(world, libs.map((l) => l.name)))] : []),
      ...(locals.length
        ? [fixOption({ label: `Remove all ${locals.length} from this repo`, preview: `Remove these ${n(locals.length)} from ${open}; your library keeps the tracked ones.`, run: (w) => (locals.forEach((s) => w.ops.remove(open!, s.name)), `Removed ${n(locals.length)} from ${open}`) })]
        : []),
      ...[...new Set(machines.filter((m) => m.source === "plugin").map((m) => m.where))].map((id) => fixOption(W.replacePluginFix(world, id))),
      ...(machines.some((m) => m.source === "plugin") ? [{ label: "Turn the plugin off with /plugin in Claude Code", action: () => setToast("Turn it off with /plugin in Claude Code; skilllib picks it up next time") }] : []),
      { label: "Review prompt", action: () => ui.copy(reviewPrompt(world, names, `Review these related skills (${label}).`), `a review prompt for ${label}`) },
    ];
  }

  /** Rows that start something, pinned above the list. */
  function actionRows(): Item[] {
    const row = (key: string, text: string, lines: string[], onEnter: () => void): Item => ({
      key,
      name: "",
      action: true,
      issues: [],
      uses: 0,
      cells: [{ text, grow: true, color: color.accent }],
      onEnter,
      detail: (width) => {
        const b = builder(text.replace(/^[^ ]+ /, ""));
        for (const l of lines.flatMap((l) => (l ? wrap(l, width - 4, 4) : [""]))) b.line([l, color.muted]);
        b.line();
        b.line(["enter to start", color.faint]);
        return b.d;
      },
    });
    const autoFixes = fixAllList(all);
    const fix = autoFixes.length
      ? [row("#fixall", `✦ Fix ${autoFixes.length} issue${autoFixes.length === 1 ? "" : "s"} automatically…`, ["You'll see the list first and can untick any of them.", "", "Decisions (marked \"your call\") are never applied automatically: open the skill to choose."], () => setModal({ kind: "fixall", items: autoFixes, cursor: 0 }))]
      : [];
    if (dashboard) {
      const repo = open!;
      const skills = W.project(world, repo).skills.map((s) => s.name);
      return [
        row("#add", "+ Add a skill…", ["Search your library, or create a new skill."], () => setModal({ kind: "add", cursor: 0, query: "", target: repo })),
        ...fix,
        row("#repo", `⋯ ${repo}…`, ["Open its folder, hide it from the list, or copy a review prompt for its skills."], () =>
          ui.menu(repo, [
            { label: "Open its folder", action: () => setToast(said(world.ops.openFolder(W.project(world, repo).path))) },
            { label: "Hide it from the list", action: () => (apply((w) => w.ops.hide(repo)), setOpen(null), setFocus(sidebar ? "sidebar" : "list")) },
            ...(skills.length ? [{ label: `Review prompt for its ${skills.length} skills`, action: () => ui.copy(reviewPrompt(world, skills, `Review the skills in ${repo}.`), `a review prompt for ${repo}`) }] : []),
          ]),
        ),
      ];
    }
    if (place === "global") {
      const globals = [...new Set(world.machine.filter((m) => m.source === "global" && !m.broken).map((m) => m.name))];
      return [
        ...fix,
        ...(globals.length
          ? [row("#review", `⧉ Review prompt for your ${globals.length} global skills…`, ["An agent recommends, for each: keep global, move to repos, or delete."], () => ui.copy(reviewPrompt(world, globals, "Review my global skills: they load in every repo."), "a review prompt for your global skills"))]
          : []),
      ];
    }
    if (place === "health") return fix;
    if (place === "library")
      return [row("#add", "+ New skill…", ["Create a skill in your library, or have an agent write it. Skills in your repos can be copied in from their own actions."], () => setModal({ kind: "add", cursor: 0, query: "", target: null }))];
    return [];
  }

  function move(delta: number) {
    let i = cursor;
    do i = Math.max(0, Math.min(items.length - 1, i + delta));
    while (items[i]?.header && i > 0 && i < items.length - 1);
    if (items[i]?.header) return;
    setCursors({ ...cursors, [cursorKey]: i });
    setDetailCursor(0);
  }
  function goPlace(p: Place) {
    setPlace(p);
    setFocus("list");
    setQuery("");
    setChip("all");
  }
  /** Jumps to Global, filtered to one skill. */
  /** Opens a file in $EDITOR, handing it the terminal, then reads everything again (and runs `then`, if given). */
  function edit(file: string, then?: (w: W.World) => W.Result) {
    // (The prototype's skills have no files: what comes after editing still happens.)
    if (!existsSync(file)) return then ? apply(then) : (setBase(reload()), setToast(`${tildify(file)} doesn't exist`));
    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
    void suspendTerminal(() => {
      // $EDITOR may carry args ("code -w"), so it goes through the shell — but the path is
      // passed as $1, never interpolated: skill folder names come from third-party repos.
      // Windows paths can't contain `"`, so quoting is safe there (and cmd resolves .cmd shims).
      if (process.platform === "win32") spawnSync(`${editor} "${file}"`, { shell: true, stdio: "inherit" });
      else spawnSync("/bin/sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
    }).then(() => {
      // Read again first: the edit makes a new library version, and `then` must see it.
      const fresh = reload();
      if (then) return apply(then, fresh);
      setBase(fresh);
      setToast(`Saved ${tildify(file)}`);
    });
  }
  /** Asks where your projects live, and starts scanning there. */
  function askForFolder(title: string) {
    // Empty, with ~/Projects as the placeholder: a prefilled value would have typing append to it.
    setModal({ kind: "input", title, value: "", placeholder: "~/Projects", submit: (v) => apply((w) => w.ops.addRoot(v)) });
  }
  // First run: pick your agents, then say where your projects live.
  useEffect(() => {
    const folder = () => !initial.roots.length && askForFolder("Where are your projects? skilllib finds the git repos in there");
    if (!initial.agentsChosen) setModal({ kind: "agents", selected: initial.agents, cursor: 0, then: folder });
    else folder();
  }, []);
  function openInGlobal(name: string) {
    goPlace("global");
    setQuery(name);
  }

  function settingsItems(): Item[] {
    const header = (key: string, text: string): Item => ({ key, name: "", header: true, issues: [], uses: 0, cells: [{ text }] });
    const row = (key: string, text: string, sub: string, onEnter?: () => void, c?: string): Item => ({
      key,
      name: text,
      issues: [],
      uses: 0,
      cells: [{ text: text, width: 34, color: c }, { text: sub, grow: true, color: color.faint }],
      onEnter,
    });
    return [
      header("#agents", "Agents"),
      ...HARNESSES.map((h) =>
        row(`agent:${h.id}`, `${world.agents.includes(h.id) ? "[x]" : "[ ]"} ${h.icon} ${h.name}`, h.projectDirs.join(", "), () => {
          const wasOn = world.agents.includes(h.id);
          apply((w) => (w.ops.setAgents(wasOn ? w.agents.filter((a) => a !== h.id) : HARNESSES.map((x) => x.id).filter((id) => id === h.id || w.agents.includes(id))), `${h.name} ${wasOn ? "off" : "on"}`));
        }),
      ),
      // The skill that lets your agents use skilllib: installing adds a global skill, so it asks first.
      row(
        "agent-skill",
        `${world.agentSkill === "installed" ? "[x]" : "[ ]"} ◆ skilllib skill`,
        world.agentSkill === "installed" ? "your agents can use skilllib" : world.agentSkill === "outdated" ? "out of date · enter updates it" : "lets your agents use skilllib · enter installs it",
        () => (world.agentSkill === "installed" ? setToast("Installed · `skilllib agent-skill remove` takes it out") : choose(fixOption(W.agentSkillFix(world)))),
      ),
      header("#roots", "Project folders"),
      ...world.roots.map((r) =>
        row(`root:${r}`, tildify(r), "scanned for git repos", () =>
          ui.menu(tildify(r), [
            { label: "Look for repos again", action: () => apply((w) => w.ops.rescan()) },
            fixOption({ label: "Stop scanning this folder", preview: `Repos already found in ${tildify(r)} stay listed until you hide them.`, run: (w) => w.ops.removeRoot(r) }),
          ]),
        ),
      ),
      row("root:add", "+ Add a folder…", "", () => askForFolder("Folder that contains your projects")),
      ...(world.hidden.length ? [header("#hidden", "Hidden repos"), ...world.hidden.map((h) => row(`hidden:${h}`, tildify(h), "enter shows it again", () => apply((w) => w.ops.unhide(h))))] : []),
      header("#backups", "Backups"),
      ...(world.backups.length
        ? world.backups.map((b, i) =>
            row(`backup:${i}`, `↺ ${b.name}`, `${b.from} · ${b.at}`, () => apply((w) => w.ops.restoreBackup(i))),
          )
        : [row("none", "No backups yet", "anything skilllib removes lands here")]),
    ];
  }

  // ── Keys ──
  // Names only use a-z 0-9 - _ . so those keys always filter; commands live on space, enter, arrows, symbols and ctrl.
  useInput((input: string, key: Key) => {
    if (key.ctrl && input === "c") return exit();
    setToast("");
    if (modal) return modalKeys(input, key);
    if (key.ctrl && input === "r") return setBase(reload()), setToast("Read everything again");
    // Typing filters the pane you're in: repos in Places, the list otherwise.
    if (focus === "sidebar" && (isNameChar(input, key) || key.backspace || key.delete)) {
      const q = isNameChar(input, key) ? sideQuery + input.toLowerCase() : sideQuery.slice(0, -1);
      setSideQuery(q);
      // Jump to the first repo that matches, as moving onto it would.
      const first = q && world.projects.find((p) => W.matches(p.name, q));
      if (first) toRepo(first.name)();
      return;
    }
    if (isNameChar(input, key)) return setFocus("list"), setQuery(query + input.toLowerCase());
    if (key.backspace || key.delete) return setQuery(query.slice(0, -1));
    if (input === "?") return setModal({ kind: "help" });
    if (focus === "detail") {
      // Options by line: a fix per line, or a row of actions. ↑↓ move by line, ←→ along a row;
      // ← on a line's first option goes back a pane, like ← everywhere else.
      const lines = (detail?.body ?? []).flatMap((l) => (l.row ? [l.row] : l.option !== undefined ? [[l.option]] : []));
      const at = lines.findIndex((r) => r.includes(detailCursor));
      const col = at < 0 ? 0 : lines[at]!.indexOf(detailCursor);
      const goLine = (i: number) => lines[i] && setDetailCursor(lines[i]![Math.min(col, lines[i]!.length - 1)]!);
      if (key.escape) return setFocus("list");
      if (key.upArrow) return goLine(Math.max(0, at - 1));
      if (key.downArrow) return goLine(at + 1);
      if (key.leftArrow) return col > 0 ? setDetailCursor(lines[at]![col - 1]!) : setFocus("list");
      if (key.rightArrow) return lines[at]?.[col + 1] !== undefined ? setDetailCursor(lines[at]![col + 1]!) : undefined;
      if ((key.return || input === " ") && detail?.options[detailCursor]) return choose(detail.options[detailCursor]!);
      return;
    }
    if (focus === "sidebar") {
      if (key.upArrow || key.downArrow) {
        const d = key.upArrow ? -1 : 1;
        let i = sideAt + d;
        while (sideRows[i]?.header) i += d;
        const next = sideRows[i];
        if (!next) return;
        if (next.key === "help") return setOnHelp(true);
        return next.go(), setOnHelp(false), setFocus("sidebar");
      }
      if (key.return && onHelp) return setModal({ kind: "help" });
      if (key.rightArrow || key.return) return setOnHelp(false), setFocus("list");
      if (key.escape) return setSideQuery("");
      return;
    }
    // Groups open with → (or enter, or space) and close with ← (or space); enter on an open one shows its actions.
    const fold = current?.fold;
    if (fold && !fold.open && (key.rightArrow || key.return || input === " ")) return toggleFold(fold.key);
    if (fold?.open && (key.leftArrow || input === " ")) return toggleFold(fold.key);
    if (current?.inFold && key.leftArrow) {
      toggleFold(current.inFold);
      return setCursors({ ...cursors, [cursorKey]: items.findIndex((i) => i.fold?.key === current.inFold) });
    }
    if (sidebar && key.leftArrow) return setFocus("sidebar");
    if (sidebar && key.rightArrow && detail) return setFocus("detail"), setDetailCursor(0);
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (!sidebar && (key.leftArrow || key.rightArrow)) {
      const i = PLACES.findIndex(([p]) => p === place) + (key.leftArrow ? -1 : 1);
      if (PLACES[i]) goPlace(PLACES[i]![0]);
      return;
    }
    if (key.escape) {
      if (query) return setQuery("");
      if (sidebar) return setFocus("sidebar");
      if (chip !== "all") return setChip("all");
      if (dashboard) return setOpen(null);
      return;
    }
    if (key.tab && chips.length) {
      const i = chips.findIndex(([c]) => c === chip);
      return setChip(chips[(i + (key.shift ? chips.length - 1 : 1)) % chips.length]![0]);
    }
    if (!current) return;
    if (key.return && current.onEnter) return current.onEnter();
    if (place === "settings") return input === " " && current.onEnter ? current.onEnter() : undefined;
    if (place === "projects" && !open) return key.return ? (setOpen(current.name), setQuery(""), setChip("all")) : undefined;
    if (key.return && detail) return setFocus("detail"), setDetailCursor(0);
    if (input === " ") return fixSelected();
  });

  function modalKeys(input: string, key: Key) {
    const m = modal!;
    if (m.kind === "help") return setModal(null);
    if (m.kind === "agents") {
      if (key.escape && !m.then) return setModal(null);
      if (key.upArrow) return setModal({ ...m, cursor: Math.max(0, m.cursor - 1) });
      if (key.downArrow) return setModal({ ...m, cursor: Math.min(HARNESSES.length - 1, m.cursor + 1) });
      if (input === " ") {
        const id = HARNESSES[m.cursor]!.id;
        return setModal({ ...m, selected: m.selected.includes(id) ? m.selected.filter((x) => x !== id) : [...m.selected, id] });
      }
      if (key.return) {
        setModal(null);
        apply((w) => w.ops.setAgents(m.selected));
        m.then?.();
      }
      return;
    }
    if (m.kind === "input") {
      if (key.escape) return setModal(null);
      if (key.return) {
        const value = m.value.trim() || m.placeholder;
        setModal(null);
        return value ? m.submit(value) : undefined;
      }
      if (key.backspace || key.delete) return setModal({ ...m, value: m.value.slice(0, -1) });
      if (key.ctrl && input === "u") return setModal({ ...m, value: "" });
      if (input && !key.ctrl && !key.meta) return setModal({ ...m, value: m.value + input });
      return;
    }
    if (m.kind === "menu") {
      if (key.escape) return setModal(null);
      if (key.upArrow) return setModal({ ...m, cursor: Math.max(0, m.cursor - 1) });
      if (key.downArrow) return setModal({ ...m, cursor: Math.min(m.options.length - 1, m.cursor + 1) });
      if (key.return && m.options[m.cursor]) return setModal(null), choose(m.options[m.cursor]!);
      return;
    }
    // Saying no to a follow-up keeps what the change said (e.g. which agents can't see a skill).
    if (key.escape) return setModal(null), m.kind === "confirm" && m.toast && setToast(m.toast);
    if (m.kind === "confirm") {
      if (key.return || input === "y") {
        setModal(null);
        setFocus("list");
        apply(m.fix.run);
      }
      return;
    }
    if (m.kind === "repos") {
      const repos = (m.only ?? world.projects.map((p) => p.name)).filter((r) => !m.query || W.matches(r, m.query));
      if (isNameChar(input, key)) return setModal({ ...m, query: m.query + input.toLowerCase(), cursor: 0 });
      if (key.backspace || key.delete) return setModal({ ...m, query: m.query.slice(0, -1), cursor: 0 });
      if (key.upArrow) return setModal({ ...m, cursor: Math.max(0, m.cursor - 1) });
      if (key.downArrow) return setModal({ ...m, cursor: Math.min(repos.length - 1, m.cursor + 1) });
      if (input === " ") {
        const picked = new Set(m.picked);
        const r = repos[m.cursor];
        if (!r) return;
        if (!picked.delete(r)) picked.add(r);
        return setModal({ ...m, picked });
      }
      if (key.return) {
        if (!m.picked.size && !m.fix.allowNone) return setToast("Tick at least one repo with space, or esc to cancel");
        setModal(null);
        setFocus("list");
        apply((w) => m.fix.pickRepos!(w, [...m.picked]));
      }
      return;
    }
    if (m.kind === "fixall") {
      if (key.upArrow) return setModal({ ...m, cursor: Math.max(0, m.cursor - 1) });
      if (key.downArrow) return setModal({ ...m, cursor: Math.min(m.items.length - 1, m.cursor + 1) });
      if (input === " ") return setModal({ ...m, items: m.items.map((it, i) => (i === m.cursor ? { ...it, on: !it.on } : it)) });
      if (key.return) {
        setModal(null);
        const chosen = m.items.filter((it) => it.on);
        apply((w) => W.runAll(w, chosen.map((it) => it.fix)));
      }
      return;
    }
    if (m.kind === "add") {
      const rows = W.addRows(world, m.target, m.query);
      const cursor = addCursor(rows, m.cursor);
      const step = (d: number) => {
        let i = cursor + d;
        while (rows[i]?.header) i += d;
        return rows[i] ? setModal({ ...m, cursor: i }) : undefined;
      };
      if (key.upArrow) return step(-1);
      if (key.downArrow) return step(1);
      if (key.backspace || key.delete) return setModal({ ...m, query: m.query.slice(0, -1), cursor: 0 });
      if (key.return && rows[cursor]?.agent) {
        setModal(null);
        return ui.copy(writeSkillPrompt(world, m.query, m.target), "a prompt for an agent to write the skill");
      }
      if (key.return && rows[cursor]?.run) {
        const row = rows[cursor]!;
        if (row.create && !/^[a-z0-9]/.test(m.query)) return setToast("Type the new skill's name first");
        setModal(null);
        if (!row.create) return apply(row.run!);
        // A new skill opens in your editor, and goes into the repo once you've written it. Nothing
        // reads the library in between, so the template never becomes a version of its own.
        row.run!(world);
        return edit(world.ops.libraryFile(m.query), row.afterEdit);
      }
      if (isNameChar(input, key)) return setModal({ ...m, query: m.query + input.toLowerCase(), cursor: 0 });
    }
  }

  // ── Layout ──
  const bottomH = 1;
  // Tall enough to say everything a change does (e.g. every repo a deletion reaches).
  const confirmLines = modal?.kind === "confirm" ? wrap(modal.fix.preview, columns - 6, 6) : [];
  const confirmH = modal?.kind === "confirm" ? confirmLines.length + 2 : 0;
  const bodyH = Math.max(8, termRows - (sidebar ? 0 : 1) - bottomH - confirmH);
  // Same count as Global's Issues tab: skills with something to fix.
  const globalFlagged = world.machine.map((m) => [m.name, W.machineIssues(world, m)] as const).filter(([, issues]) => issues.length);
  const globalIssues = new Set(globalFlagged.map(([name]) => name)).size;
  const globalProblem = globalFlagged.some(([, issues]) => issues.some((x) => x.severity === "problem"));

  /** The sidebar: places, then every repo. Moving onto a row opens it. */
  // Like Global's count: skills with something to fix, marked by the worst of them.
  const badge = (p: string): Cell => {
    const found = W.projectIssues(world, p);
    const top = W.worst(found.map((x) => x.issue));
    return { text: top ? SEV[top.severity].icon : "", width: 3, color: top ? SEV[top.severity].color : undefined };
  };
  const sideRow = (key: string, label: string, here: boolean, go: () => void, count: Cell[] = []) => ({
    key,
    header: false,
    here: here && !onHelp,
    go,
    cells: [{ text: label, grow: true, bold: !key.startsWith("repo:") }, ...count] as Cell[],
  });
  const sideHeader = (key: string, text: string) => ({ key, header: true, here: false, go: () => {}, cells: [{ text }] as Cell[] });
  const toRepo = (name: string | null) => () => (setPlace("projects"), setOpen(name), setQuery(""), setChip("all"));
  const sideRows = [
    sideRow("library", "▤ Your skills", place === "library", () => goPlace("library"), [{ text: String(world.library.length), width: 4, color: color.muted }]),
    // The number turns red or yellow when any of them has an issue.
    sideRow("global", "◈ Global", place === "global", () => goPlace("global"), [
      { text: String(new Set(world.machine.map((m) => m.name)).size), width: 4, color: globalProblem ? color.red : globalIssues ? color.yellow : color.muted },
    ]),
    sideRow("health", "✓ Health", place === "health", () => goPlace("health"), [
      { text: String(healthCount), width: 4, color: healthWorst ? SEV[healthWorst.severity].color : color.green },
    ]),
    sideHeader("#projects", "Projects"),
    ...world.projects.filter((p) => !sideQuery || W.matches(p.name, sideQuery)).map((p) => sideRow(`repo:${p.name}`, `${p.name === world.cwd ? "◆" : " "} ${p.name}`, place === "projects" && open === p.name, toRepo(p.name), [badge(p.name)])),
    sideHeader("#end", ""),
    sideRow("settings", "⚙ Settings", place === "settings", () => goPlace("settings")),
    { ...sideRow("help", "? Help", false, () => {}), here: onHelp },
  ];
  const sideAt = sideRows.findIndex((r) => r.here);

  const topBar = (
    <Box height={1} width={columns} justifyContent="space-between">
      <Box>
        <Text color={color.accent} bold>
          {" ◆ skilllib  "}
        </Text>
        {PLACES.map(([p, label]) => (
          <Text key={p} backgroundColor={place === p ? color.accent : undefined} color={place === p ? "#0B1020" : color.muted} bold={place === p}>
            {` ${label}`}
            <Text color={place === p ? "#0B1020" : healthWorst ? SEV[healthWorst.severity].color : color.green}>{p === "health" && healthCount ? ` ${healthCount}` : ""}</Text>
            {" "}
          </Text>
        ))}
      </Box>
    </Box>
  );

  const chipRow = (
    <Box height={1} overflow="hidden">
      <Text wrap="truncate-end">
        {chips.map(([c, label], i) => {
          const n = all.filter((x) => !x.header && !x.action && inChip(x, c)).length;
          return (
            <Text key={c}>
              {i ? " " : ""}
              <Text
                backgroundColor={chip === c ? color.accent : undefined}
                color={chip === c ? "#0B1020" : c === "issues" && n ? color.yellow : color.muted}
                bold={chip === c}
              >{` ${label} ${n} `}</Text>
            </Text>
          );
        })}
        <Text color={color.accent}>{query ? `    ⌕ ${query}▏` : ""}</Text>
      </Text>
    </Box>
  );

  const columnTitles: Cell[] | null =
    dashboard || place === "global"
      ? titles([["", 2], ["Skill", nameW], ["Source", 14], [" Uses", 6], [" Issue", 0]])
      : place === "projects"
        ? titles([["", 2], ["Project", 18], ["Skills", 10], ["Issues", 0]])
        : place === "library"
          ? titles([["", 2], ["Skill", nameW], ["Ver", 5], ["Used in", 18], [" Uses", 6], [" Issue / description", 0]])
          : place === "health"
            ? titles([["", 2], ["Skill", nameW], ["Where", 16], [" Issue", 0]])
            : null;
  const showChips = chips.length > 0;
  const listHeader = (
    <Box flexDirection="column">
      {showChips ? chipRow : null}
      {columnTitles ? <TitleRow cells={columnTitles} width={columns} /> : null}
    </Box>
  );

  const overviewH = dashboard && !sidebar ? 4 : 0;
  const listH = split ? Math.floor((bodyH - overviewH) / 2) : bodyH - overviewH;
  const detailH = split ? bodyH - overviewH - listH : bodyH;
  const listRows: Row[] = items.map((i) => ({ key: i.key, cells: i.cells, header: i.header }));
  const listTitle = dashboard ? "Skills" : place === "projects" ? "Projects" : place === "library" ? "Your skills" : place === "global" ? "Loads everywhere" : place === "health" ? "To fix" : "Settings";
  const list = (
    <ListPanel
      title={listTitle}
      focused={focus === "list"}
      width={columns}
      height={listH}
      rows={listRows}
      selected={Math.max(0, cursor)}
      empty={query ? `Nothing matches "${query}" · esc clears` : chip === "issues" || place === "health" ? "✓ Nothing to fix" : "Nothing here"}
      header={listHeader}
      headerHeight={(showChips ? 1 : 0) + (columnTitles ? 1 : 0)}
    />
  );

  const side =
    sidebar && focus === "sidebar" && dashboard ? (
      <Panel title={open!} focused={false} width={columns} height={detailH}>
        <InfoGrid rows={overview(world, open!)} columns={2} width={columns} />
      </Panel>
    ) : place === "projects" && !open && current && !current.header ? (
      <Panel title={current.name} focused={false} width={columns} height={detailH}>
        <InfoGrid rows={overview(world, current.name)} columns={2} width={columns} />
      </Panel>
    ) : detail ? (
      <DetailPanel detail={detail} width={columns} height={detailH} focused={focus === "detail"} cursor={detailCursor} />
    ) : null;

  let body: ReactNode;
  if (modal?.kind === "help") body = <Help width={columns} height={bodyH} />;
  else if (modal?.kind === "menu")
    body = (
      <ListPanel
        title={modal.title}
        focused
        width={columns}
        height={bodyH}
        selected={modal.cursor}
        empty="Nothing to do here"
        rows={modal.options.map((o, i) => ({ key: String(i), cells: [{ text: o.label, grow: true }] }))}
      />
    );
  else if (modal?.kind === "input")
    body = (
      <Panel title={modal.title} focused width={columns} height={5}>
        {modal.value || !modal.placeholder ? (
          <Text color={color.text}>{modal.value + "▏"}</Text>
        ) : (
          <Text>
            {"▏"}
            <Text color={color.faint}>{modal.placeholder}</Text>
          </Text>
        )}
        <Text color={color.faint}>{modal.value || !modal.placeholder ? "enter to confirm · ctrl+u clears · esc cancels" : `type a path, or enter for ${modal.placeholder} · esc cancels`}</Text>
      </Panel>
    );
  else if (modal?.kind === "agents")
    body = (
      <ListPanel
        title="Which agents do you use?"
        focused
        width={columns}
        height={bodyH}
        selected={modal.cursor}
        empty=""
        header={<Text color={color.muted}>{"skilllib makes your skills visible to each one. Detected ones are ticked."}</Text>}
        headerHeight={1}
        rows={HARNESSES.map((h) => ({
          key: h.id,
          cells: [
            { text: modal.selected.includes(h.id) ? "[x] " : "[ ] ", width: 4, color: modal.selected.includes(h.id) ? color.green : color.faint },
            { text: `${h.icon} ${h.name}`, width: 18, color: h.color },
            { text: `reads ${h.projectDirs.join(", ")}`, grow: true, color: color.faint },
          ],
        }))}
      />
    );
  else if (modal?.kind === "repos") {
    const repos = (modal.only ?? world.projects.map((p) => p.name)).filter((r) => !modal.query || W.matches(r, modal.query));
    const name = current?.name ?? "";
    // What confirming does, above the repos to pick.
    const pickerLines = wrap(modal.fix.preview, columns - 6, 4);
    body = (
      <ListPanel
        title={`${modal.fix.label.replace("…", "")}: ${name}`}
        focused
        width={columns}
        height={bodyH}
        selected={modal.cursor}
        empty="No repos"
        header={
          <Box flexDirection="column">
            {pickerLines.map((l, i) => (
              <Text key={i} color={color.text}>
                {l}
              </Text>
            ))}
            <Text color={modal.query ? color.accent : color.muted}>{modal.query ? `⌕ ${modal.query}▏` : `ticked: repos where it was used${modal.fix.allowNone ? " (or none)" : ""} · type to filter`}</Text>
          </Box>
        }
        headerHeight={pickerLines.length + 1}
        rows={repos.map((r) => ({
          key: r,
          cells: [
            { text: modal.picked.has(r) ? "[x] " : "[ ] ", width: 4, color: modal.picked.has(r) ? color.green : color.faint },
            { text: r, width: 20 },
            { text: world.usage[r]?.[name] ? `used ${world.usage[r]![name]}× here` : "", grow: true, color: color.faint },
          ],
        }))}
      />
    );
  } else if (modal?.kind === "fixall") {
    body = (
      <ListPanel
        title={`Fix automatically (${modal.items.filter((i) => i.on).length} of ${modal.items.length})`}
        focused
        width={columns}
        height={bodyH}
        selected={modal.cursor}
        empty=""
        header={<Text color={color.muted}>{"Decisions are never listed here: they stay with you."}</Text>}
        headerHeight={1}
        rows={modal.items.map((it, i) => ({
          key: String(i),
          cells: [
            { text: it.on ? "[x] " : "[ ] ", width: 4, color: it.on ? color.green : color.faint },
            { text: it.label, grow: true },
          ],
        }))}
      />
    );
  } else if (modal?.kind === "add") {
    const rows = W.addRows(world, modal.target, modal.query);
    body = (
      <ListPanel
        title={modal.target ? `Add a skill to ${modal.target}` : "New skill"}
        focused
        width={columns}
        height={bodyH}
        selected={addCursor(rows, modal.cursor)}
        empty=""
        header={
          <Text color={modal.query ? color.accent : color.muted}>
            {modal.query ? `⌕ ${modal.query}▏` : modal.target ? "type to search your library, or to name a new skill" : "type the new skill's name"}
          </Text>
        }
        headerHeight={1}
        rows={rows.map((r) =>
          r.header
            ? { key: r.key, header: true, cells: [{ text: r.header }] }
            : r.create || r.agent
              ? { key: r.key, cells: [{ text: r.name, grow: true, color: color.accent }] }
              : {
                  key: r.key,
                  cells: [
                    { text: clip(r.name, 22), width: 22 },
                    { text: r.note, width: 6, color: color.accent },
                    { text: r.description, grow: true, color: color.faint },
                  ],
                },
        )}
      />
    );
  } else if (!split && focus === "detail" && side) body = side;
  else
    body = (
      <Box flexDirection="column">
        {overviewH ? (
          <Panel title={open!} focused={false} width={columns} height={overviewH}>
            <InfoGrid rows={overview(world, open!)} columns={2} width={columns} />
          </Panel>
        ) : null}
        {list}
        {split ? side : null}
      </Box>
    );

  // A few quiet hints for where you are; messages replace them until the next key.
  const hints =
    modal?.kind === "confirm"
      ? "enter apply · esc cancel"
      : modal?.kind === "repos" || modal?.kind === "fixall"
        ? "space tick · enter apply · esc cancel"
        : modal?.kind === "agents"
          ? "space tick · enter save"
          : modal?.kind === "menu"
            ? "↑↓ choose · enter do it · esc cancel"
            : modal?.kind === "add"
          ? "enter add · esc cancel"
          : modal
            ? "any key closes"
            : focus === "detail"
              ? "↑↓ ←→ choose · enter apply · esc back"
              : focus === "sidebar"
                ? "↑↓ choose · enter open · type to filter repos"
              : place === "projects" && !open
                ? `type to filter · enter open · ${sidebar ? "← sidebar" : "←→ places"} · ? keys`
                : place === "settings"
                  ? `enter toggle · ${sidebar ? "← sidebar" : "←→ places"} · ? keys`
                  : `type to filter · space ★ fix · enter actions · tab tabs${sidebar ? " · esc back" : `${dashboard ? " · esc all projects" : ""} · ? keys`}`;

  return (
    <Box flexDirection="column" width={termCols} height={termRows}>
      {sidebar ? null : topBar}
      <Box>
        {sidebar ? (
          <ListPanel
            title={sideQuery ? `◆ skilllib ⌕ ${sideQuery}▏` : "◆ skilllib"}
            focused={focus === "sidebar"}
            width={SIDEBAR_W}
            height={bodyH + confirmH}
            rows={sideRows}
            selected={sideAt}
            empty=""
          />
        ) : null}
        <Box flexDirection="column" width={columns}>
          {body}
          {modal?.kind === "confirm" ? (
            <Panel title={modal.fix.label} focused width={columns} height={confirmH}>
              {confirmLines.map((l, i) => (
                <Text key={i} color={color.text}>
                  {l}
                </Text>
              ))}
            </Panel>
          ) : null}
        </Box>
      </Box>
      <Box height={1} width={termCols} justifyContent="space-between">
        <Text color={toast.startsWith("✓") || toast.startsWith("↺") ? color.green : toast.startsWith("✗") ? color.red : color.muted} wrap="truncate-end">
          {" " + toast}
        </Text>
        {toast ? null : <Text color={color.faint}>{hints + " "}</Text>}
      </Box>
    </Box>
  );
}

function SegLine({ segs }: { segs: Seg[] }) {
  return (
    <Box height={1} overflow="hidden">
      <Text wrap="truncate-end">
        {segs.map(([t, c], i) => (
          <Text key={i} color={c}>
            {t}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function DetailPanel({ detail, width, height, focused, cursor }: { detail: Detail; width: number; height: number; focused: boolean; cursor: number }) {
  const visible = height - 2;
  const at = detail.body.findIndex((l) => l.option === cursor || l.row?.includes(cursor));
  const offset = focused && at >= visible ? at - visible + 2 : 0;
  return (
    <Panel title={detail.title} focused={focused} width={width} height={height}>
      {detail.body.slice(offset, offset + visible).map((l, i) => {
        if (l.row)
          return (
            <Box key={i} height={1} overflow="hidden">
              <Text wrap="truncate-end">
                {l.segs.map(([t, c], j) => (
                  <Text key={j} color={c}>{t}</Text>
                ))}
                {l.row.map((o, j) => (
                  <Text key={o}>
                    <Text color={color.faint}>{j ? " · " : ""}</Text>
                    <Text color={focused && o === cursor ? color.text : color.muted} bold={focused && o === cursor} backgroundColor={focused && o === cursor ? color.selection : undefined}>
                      {detail.options[o]!.label}
                    </Text>
                  </Text>
                ))}
              </Text>
            </Box>
          );
        if (l.option === undefined) return <SegLine key={i} segs={l.segs.length ? l.segs : [[" "]]} />;
        const o = detail.options[l.option]!;
        const on = focused && l.option === cursor;
        return (
          <Box key={i} height={1} overflow="hidden">
            <Text wrap="truncate-end">
              <Text color={on ? color.accent : color.faint}>{on ? "  ▸ " : "    "}</Text>
              <Text color={color.green}>{o.recommended ? "★ " : "  "}</Text>
              <Text color={on ? color.text : color.muted} bold={on} backgroundColor={on ? color.selection : undefined}>
                {o.label}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Panel>
  );
}

function Help({ width, height }: { width: number; height: number }) {
  const keys: [string, string][] = [
    ["a-z 0-9 -", "filter the pane you're in (initials work: cfw finds cloudflare-workers)"],
    ["↑ ↓", "move"],
    ["enter  →", "one pane deeper: Places → list → details (and applies the chosen fix)"],
    ["space", "apply the ★ recommended fix (or show the choices when it's your call)"],
    ["tab  ⇧tab", "next / previous tab: All · Issues · Local · Global · Plugins · Vendor"],
    ["", "under 80 columns there's no Places pane: ← → switch places instead"],
    ["esc  ←", "one pane back (esc clears a filter first)"],
    ["ctrl+r", "read everything again from disk"],
    ["ctrl+c", "quit"],
  ];
  return (
    <Panel title="Keys" hint="any key closes" focused width={width} height={height}>
      {keys.map(([k, d]) => (
        <Text key={k}>
          <Text color={color.accent}>{k.padEnd(12)}</Text>
          <Text color={color.text}>{d}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text color={color.muted}>{"✕ problem · ⚠ warning · · hint · ★ recommended fix · \"your call\" = a decision, never auto-fixed"}</Text>
      <Text color={color.muted}>{"Source: lib = from your library · repo = committed by the team · untracked = only on this machine"}</Text>
      <Text color={color.muted}>{"Usage counts Claude Code sessions only: other agents don't record skill use."}</Text>
    </Panel>
  );
}
