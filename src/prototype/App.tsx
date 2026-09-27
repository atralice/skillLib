/**
 * Clickable prototype of the redesigned TUI, on sample data held in memory.
 * Nothing touches disk. Run: pnpm prototype
 */
import { pathToFileURL } from "node:url";
import { useRef, useState, type ReactNode } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import { HARNESSES } from "../harnesses.js";
import { ListPanel, Panel, wrap, type Cell, type Row } from "../tui/components.js";
import { color } from "../tui/theme.js";
import * as W from "./world.js";

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
/** The repo the prototype pretends you launched it from. */
const CWD = "web-app";
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
};
type Modal =
  | { kind: "confirm"; fix: W.Fix }
  | { kind: "repos"; fix: W.Fix; picked: Set<string>; cursor: number; only?: string[]; query: string }
  /** `target`: the repo to add to, or null for your library. */
  | { kind: "add"; cursor: number; query: string; target: string | null }
  | { kind: "fixall"; items: { label: string; fix: W.Fix; on: boolean }[]; cursor: number }
  | { kind: "help" };

const bySeverity = (a: W.Issue, b: W.Issue) => W.SEVERITY_RANK[a.severity] - W.SEVERITY_RANK[b.severity];

function tag(u: W.Usable, w: W.World): Seg {
  const s = u.local;
  if (s?.source === "lib") {
    return [`lib v${s.version}`, color.accent];
  }
  if (s) return [s.source, color.blue];
  if (u.source === "global") return [u.machine?.kept ? "global ✓" : "global", color.yellow];
  if (u.source === "plugin") return [`⧉ ${u.where.split("@")[0]}`, color.magenta];
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

// ─── Screens' data ──────────────────────────────────────

/** Which copy a skill's row shows when it loads from several places: the repo's, then yours, then vendors'. */
const COPY_RANK: Record<W.Source, number> = { lib: 0, repo: 0, untracked: 0, global: 1, plugin: 2, "claude.ai": 3, cursor: 3 };

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
      if (repo && !u.local) b.line(["Loads in every repo", color.text], [u.source === "global" ? "   issues and cleanup live in Global" : "   managed at its source", color.faint]);
      else b.issues(issues);
      b.actions(actions, width);
      b.line();
      for (const segs of usageLines(w, u.name, width, repo)) b.line(...segs);
      b.line();
      b.line(["Loaded from", color.accent]);
      for (const c of copies) {
        const s = c.local;
        const path = s ? `${s.dir}/${c.name}${s.linked ? " + link" : ""}` : c.source === "global" ? `${c.where}/${c.name}` : c.where;
        const extra = s ? (s.missing ? "missing" : s.git === "committed" ? "✓ committed" : s.git === "new" ? "+ not committed" : "∅ gitignored") : "";
        const [ct, cc] = c === u ? ["", undefined] : tag(c, w);
        b.line(["  ", undefined], [path + "  ", color.text], [ct ? ct + "  " : "", cc], [extra, color.faint]);
      }
      return b.d;
    },
  };
}

/** A repo's skills, seen from the repo: only its own issues; what loads everywhere is Global's business. */
function projectSkillItems(w: W.World, p: string, nameW: number, notify: (m: string) => void, openInGlobal: (name: string) => void): Item[] {
  return byName(W.usable(w, p)).map((copies) =>
    skillItem(w, copies, mergeIssues(copies.filter((c) => c.local).map((c) => W.issuesOf(w, p, c))), nameW, skillActions(w, p, copies[0]!, notify, openInGlobal), p),
  );
}

const stub = (label: string, notify: (m: string) => void, what = label): Option => ({ label, action: () => notify(`${what} (not in the prototype)`) });
const reviewPrompt = (notify: (m: string) => void) => stub("Review prompt", notify, "Copied a review prompt for an agent");

/** What you can do with a skill as a repo sees it; never empty. */
function skillActions(w: W.World, p: string, u: W.Usable, notify: (m: string) => void, openInGlobal: (name: string) => void): Option[] {
  const s = u.local;
  const inLibrary = w.library.find((l) => l.name === u.name);
  const remove: W.Fix = { label: "Remove from repo", preview: `Delete ${s?.dir}/${u.name} in ${p}. Your library keeps it.`, run: (w) => W.removeFromProject(w, p, u.name) };
  if (s?.source === "lib")
    return [
      ...(inLibrary && s.version! < inLibrary.latest ? [fixOption({ label: `Update to v${inLibrary.latest}`, preview: `Replace ${s.dir}/${u.name} with library v${inLibrary.latest}.`, run: (w) => ((W.localSkill(w, p, u.name).version = inLibrary.latest), `${u.name} updated to v${inLibrary.latest}`) })] : []),
      stub("Edit in library", notify),
      fixOption(remove),
      reviewPrompt(notify),
    ];
  if (s?.source === "repo")
    return [
      ...(inLibrary ? [] : [fixOption({ label: "Copy into library", preview: `Copy ${u.name} into your library as v1, so other repos can add it. The repo's copy stays as it is.`, run: (w) => (W.importToLibrary(w, u.name), `${u.name} copied into your library`) })]),
      reviewPrompt(notify),
    ];
  if (s)
    return [
      inLibrary
        ? fixOption({ label: "Track it", preview: `Record ${u.name} v${inLibrary.latest} in skilllib.json.`, run: (w) => (Object.assign(W.localSkill(w, p, u.name), { source: "lib", version: inLibrary.latest }), `${u.name} is tracked`) })
        : fixOption({ label: "Import it into your library", preview: `Copy ${u.name} into your library as v1 and track it here.`, run: (w) => (W.importToLibrary(w, u.name), Object.assign(W.localSkill(w, p, u.name), { source: "lib", version: 1 }), `${u.name} imported and tracked`) }),
      fixOption(remove),
      reviewPrompt(notify),
    ];
  // Loads everywhere: what's left to do from a repo is turning a plugin off here, or going to Global.
  const global: Option = { label: "Open in Global", action: () => openInGlobal(u.name) };
  if (u.source === "plugin") return [fixOption(W.pluginOffHere(u.where, p)), global, reviewPrompt(notify)];
  return [global, reviewPrompt(notify)];
}

/** A project at a glance: where it lives and its git state. Health is on the Issues tab. */
function overview(w: W.World, p: string): [label: string, value: Seg[]][] {
  const project = W.project(w, p);
  const manifest: Seg =
    project.manifest === "committed" ? ["skilllib.json ✓ committed", color.text] : project.manifest === "changed" ? ["skilllib.json ± uncommitted changes", color.yellow] : ["no skilllib.json", color.faint];
  return [
    ["Folder", [[project.path, color.text]]],
    ["GitHub", [[project.remote ?? "no remote", project.remote ? color.blue : color.faint]]],
    ["Branch", [[project.branch, color.text], [project.dirty ? `  ${project.dirty} uncommitted` : "", color.yellow]]],
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
        { text: p.name === CWD ? "◆ " : "  ", width: 2, color: color.accent },
        { text: p.name, width: 18 },
        { text: p.skills.length ? `${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}` : "–", width: 10, color: color.muted },
        { text: t.problem ? `✕ ${t.problem}` : "", width: 5, color: color.red },
        { text: t.warning ? `⚠ ${t.warning}` : "", width: 5, color: color.yellow },
        { text: t.hint ? `· ${t.hint}` : "", grow: true, color: color.blue },
      ] as Cell[],
    };
  });
}

function globalItems(w: W.World, nameW: number, notify: (m: string) => void): Item[] {
  const copies = w.machine.map((m): W.Usable => ({ name: m.name, source: m.source, where: m.where, agents: W.machineAgents(m, w.agents), uses: W.totalUses(w, m.name), machine: m }));
  return byName(copies).map((g) => skillItem(w, g, mergeIssues(g.map((c) => W.machineIssues(w, c.machine!))), nameW, globalActions(g[0]!, notify), null));
}

/** Global's actions: all on the machine-wide copy (see W.machineActions), plus vendor settings you change at the source. */
function globalActions(u: W.Usable, notify: (m: string) => void): Option[] {
  const m = u.machine!;
  return [
    ...W.machineActions(m).map(fixOption),
    ...(m.source === "claude.ai" ? [stub("Turn off in claude.ai", notify)] : []),
    ...(m.source === "cursor" ? [stub("Manage in Cursor", notify)] : []),
    reviewPrompt(notify),
  ];
}

function libraryItems(w: W.World, nameW: number, notify: (m: string) => void): Item[] {
  return w.library.map((l): Item => {
    const repos = w.projects.filter((p) => p.skills.some((s) => s.name === l.name));
    const uses = W.totalUses(w, l.name);
    const addFix: W.Fix = { label: "Add to repos…", preview: `Install ${l.name} v${l.latest} into the repos you pick.`, run: () => "", candidates: (w) => w.projects.filter((p) => !p.skills.some((s) => s.name === l.name)).map((p) => p.name), pickRepos: (w, rs) => (rs.forEach((r) => W.addToProject(w, r, l.name)), `Added ${l.name} to ${rs.join(", ")}`) };
    const delFix: W.Fix = { label: "Delete from your library", preview: `Move ${l.name} and its versions to the backup folder.`, run: (w) => ((w.library = w.library.filter((x) => x.name !== l.name)), `Deleted ${l.name} from your library`) };
    const issues: W.Issue[] = repos.length ? [] : [{ id: `nowhere:${l.name}`, severity: "hint", title: "Used in no repo", short: "Used in no repo", decision: true, fixes: [addFix, delFix] }];
    const behind = repos.filter((p) => p.skills.some((s) => s.name === l.name && s.source === "lib" && s.version! < l.latest)).length;
    return {
      key: l.name,
      name: l.name,
      issues,
      uses,
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
          ...(repos.length
            ? [
                fixOption({
                  label: "Remove from repos…",
                  preview: `Pick repos to remove ${l.name} from. Your library keeps it.`,
                  run: () => "",
                  candidates: () => repos.map((p) => p.name),
                  pickRepos: (w, rs) => (rs.forEach((r) => W.removeFromProject(w, r, l.name)), `Removed ${l.name} from ${rs.join(", ")}`),
                }),
              ]
            : [fixOption(delFix)]),
          stub("Edit SKILL.md", notify),
        ], width);
        b.line();
        for (const segs of usageLines(w, l.name, width, null)) b.line(...segs);
        return b.d;
      },
    };
  });
}

/** Health: every skill with something to fix, in every repo and in Global, with the same details and fixes. */
function healthItems(w: W.World, nameW: number, notify: (m: string) => void, openInGlobal: (name: string) => void): Item[] {
  const flagged = (where: string, items: Item[]) =>
    items
      .filter((i) => i.issues.length)
      .map((i): Item => ({ ...i, key: `${where}:${i.key}`, cells: [i.cells[0]!, i.cells[1]!, { text: clip(where, 16), width: 16, color: color.muted }, i.cells[4]!] }));
  return [...w.projects.flatMap((p) => flagged(p.name, projectSkillItems(w, p.name, nameW, notify, openInGlobal))), ...flagged("Global", globalItems(w, nameW, notify))];
}

/** The picker's cursor, kept off group titles. */
function addCursor(rows: W.AddRow[], cursor: number): number {
  const i = Math.min(cursor, rows.length - 1);
  return rows[i] && !rows[i]!.header ? i : Math.max(0, rows.findIndex((r) => !r.header));
}

// ─── App ────────────────────────────────────────────────

export function App() {
  const { exit } = useApp();
  const { columns: termCols, rows: termRows } = useWindowSize();
  const sidebar = termCols >= SIDEBAR_AT;
  /** Width left for the content, beside the sidebar when it shows. */
  const columns = sidebar ? termCols - SIDEBAR_W : termCols;
  const [world, setWorld] = useState(W.sampleWorld);
  const [history, setHistory] = useState<W.World[]>([]);
  const [place, setPlace] = useState<Place>("projects");
  const [open, setOpen] = useState<string | null>(CWD);
  const [chip, setChip] = useState<Chip>("all");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<Record<string, number>>({});
  // Panes go Places → list → details: enter or → goes one deeper, esc or ← one back.
  const [focus, setFocus] = useState<"sidebar" | "list" | "detail">(sidebar ? "sidebar" : "list");
  const [sideQuery, setSideQuery] = useState("");
  /** The sidebar cursor is on Help, which opens on enter rather than as you pass it. */
  const [onHelp, setOnHelp] = useState(false);
  const [detailCursor, setDetailCursor] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState<string>("Sample data: nothing on disk changes");
  const order = useRef<{ key: string; keys: string[] }>({ key: "", keys: [] });

  /** Tall enough to show details under the list; shorter terminals open them on enter. */
  const split = termRows >= 30;
  const nameW = Math.min(22, Math.max(17, Math.floor(columns * 0.22)));
  const dashboard = place === "projects" && open !== null;
  const chips: [Chip, string][] =
    dashboard ? CHIPS : place === "global" ? CHIPS.filter(([c]) => c !== "local") : place === "settings" ? [] : place === "health" ? CHIPS.slice(0, 1) : CHIPS.slice(0, 2);

  // ── Current list ──
  const health = healthItems(world, nameW, setToast, openInGlobal);
  const healthWorst = W.worst(health.flatMap((i) => i.issues));
  const all: Item[] =
    place === "projects"
      ? open
        ? projectSkillItems(world, open, nameW, setToast, openInGlobal)
        : projectItems(world)
      : place === "global"
        ? globalItems(world, nameW, setToast)
        : place === "library"
          ? libraryItems(world, nameW, setToast)
          : place === "health"
            ? health
            : settingsItems();
  const inChip = (i: Item, c: Chip) => c === "all" || (c === "issues" ? i.issues.length > 0 : i.group === c);
  let items = all.filter((i) => i.header || ((!query || W.matches(i.name, query)) && inChip(i, chip)));
  // Sort by health when the view opens; don't re-sort after a fix, so rows stay under the cursor.
  const viewKey = [place, open, chip, query].join("|");
  const sortable = place !== "settings" && !(place === "projects" && !open);
  if (sortable) {
    if (order.current.key !== viewKey) {
      const rank = (i: Item) => (i.issues.length ? W.SEVERITY_RANK[[...i.issues].sort(bySeverity)[0]!.severity] : 3);
      order.current = { key: viewKey, keys: [...items].sort((a, b) => rank(a) - rank(b) || b.uses - a.uses || a.name.localeCompare(b.name)).map((i) => i.key) };
    }
    const pos = new Map(order.current.keys.map((k, i) => [k, i]));
    items = [...items].sort((a, b) => (pos.get(a.key) ?? 1e9) - (pos.get(b.key) ?? 1e9));
  } else if (place === "projects") {
    const rank = (i: Item) => (i.key === CWD ? -1 : i.issues.some((x) => x.severity === "problem") ? 0 : i.issues.length ? 1 : 2);
    const skills = (i: Item) => W.project(world, i.name).skills.length;
    items = [...items].sort((a, b) => rank(a) - rank(b) || skills(b) - skills(a) || a.name.localeCompare(b.name));
  }
  if (!query) items = [...actionRows(), ...items];

  const cursorKey = `${place}|${open}`;
  const firstSelectable = Math.max(0, items.findIndex((i) => !i.header && !i.action));
  let cursor = Math.min(cursors[cursorKey] ?? firstSelectable, items.length - 1);
  if (items[cursor]?.header) cursor = firstSelectable;
  const current = items[cursor];
  const detail = current?.detail?.(columns);

  // ── Actions ──
  function apply(run: (w: W.World) => string) {
    // Snapshot before `run` mutates the world; a lazy updater would capture the changed state.
    const before = structuredClone(world);
    setHistory((h) => [...h, before]);
    const message = run(world);
    setWorld({ ...world });
    setToast(`✓ ${message}  ·  ctrl+z undo`);
  }
  function choose(o: Option) {
    if (o.action) return o.action();
    if (!o.fix) return setToast("Not in the prototype");
    if (o.fix.pickRepos) {
      const name = current?.name ?? "";
      const only = o.fix.candidates?.(world);
      const picked = new Set(
        world.projects.filter((p) => (world.usage[p.name]?.[name] ?? 0) > 0 && !p.skills.some((s) => s.name === name) && (!only || only.includes(p.name))).map((p) => p.name),
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
    if (dashboard)
      return [
        row("#add", "+ Add a skill…", ["Search your library and the skills in your other repos, or create a new one."], () => setModal({ kind: "add", cursor: 0, query: "", target: open })),
        ...fix,
      ];
    if (place === "global" || place === "health") return fix;
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
          apply((w) => ((w.agents = wasOn ? w.agents.filter((a) => a !== h.id) : HARNESSES.map((x) => x.id).filter((id) => id === h.id || w.agents.includes(id))), `${h.name} ${wasOn ? "off" : "on"}`));
        }),
      ),
      header("#roots", "Project folders"),
      row("root", "~/Projects", `${world.projects.length} repos found`, () => setToast("Not in the prototype")),
      ...(world.pluginsOff.length
        ? [
            header("#plugins", "Plugins turned off"),
            ...world.pluginsOff.map((off, i) =>
              row(`plugin:${off.id}`, `↺ ${off.id}`, `${off.skills.length} skill${off.skills.length === 1 ? "" : "s"} · enter turns it back on`, () =>
                apply((w) => {
                  const [back] = w.pluginsOff.splice(i, 1);
                  w.machine.push(...back!.skills);
                  return `${back!.id} is on again`;
                }),
              ),
            ),
          ]
        : []),
      header("#backups", "Backups"),
      ...(world.backups.length
        ? world.backups.map((b, i) =>
            row(`backup:${i}`, `↺ ${b.name}`, `${b.from} · ${b.at}`, () =>
              apply((w) => {
                const [taken] = w.backups.splice(i, 1);
                w.machine.push(taken!.skill);
                return `Restored ${taken!.name} to ${taken!.from}`;
              }),
            ),
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
    if (key.ctrl && input === "z") {
      const prev = history.at(-1);
      if (!prev) return setToast("Nothing to undo");
      setHistory(history.slice(0, -1));
      setWorld(prev);
      return setToast("↺ Undone");
    }
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
    if (key.escape) return setModal(null);
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
        if (!m.picked.size) return setToast("Tick at least one repo with space, or esc to cancel");
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
        apply((w) => {
          let ok = 0;
          for (const it of chosen) {
            try {
              it.fix.run(w);
              ok++;
            } catch {
              // An earlier fix in the batch already resolved it.
            }
          }
          return `Applied ${ok} fix${ok === 1 ? "" : "es"}`;
        });
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
        const where = m.target ? `${m.target}/.claude/skills` : "your library";
        return setToast(`Copied a prompt for Claude Code to write ${m.query || "the skill"} in ${where}; skilllib picks it up next time (not in the prototype)`);
      }
      if (key.return && rows[cursor]?.run) {
        const row = rows[cursor]!;
        if (row.create && !/^[a-z0-9]/.test(m.query)) return setToast("Type the new skill's name first");
        setModal(null);
        return apply(row.run!);
      }
      if (isNameChar(input, key)) return setModal({ ...m, query: m.query + input.toLowerCase(), cursor: 0 });
    }
  }

  // ── Layout ──
  const bottomH = 1;
  const confirmH = modal?.kind === "confirm" ? 5 : 0;
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
      { text: String(health.length), width: 4, color: healthWorst ? SEV[healthWorst.severity].color : color.green },
    ]),
    sideHeader("#projects", "Projects"),
    ...world.projects.filter((p) => !sideQuery || W.matches(p.name, sideQuery)).map((p) => sideRow(`repo:${p.name}`, `${p.name === CWD ? "◆" : " "} ${p.name}`, place === "projects" && open === p.name, toRepo(p.name), [badge(p.name)])),
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
            <Text color={place === p ? "#0B1020" : healthWorst ? SEV[healthWorst.severity].color : color.green}>{p === "health" && health.length ? ` ${health.length}` : ""}</Text>
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
  else if (modal?.kind === "repos") {
    const repos = (modal.only ?? world.projects.map((p) => p.name)).filter((r) => !modal.query || W.matches(r, modal.query));
    const name = current?.name ?? "";
    body = (
      <ListPanel
        title={`${modal.fix.label.replace("…", "")}: ${name}`}
        focused
        width={columns}
        height={bodyH}
        selected={modal.cursor}
        empty="No repos"
        header={<Text color={modal.query ? color.accent : color.muted}>{modal.query ? `⌕ ${modal.query}▏` : "ticked: repos where it was used · type to filter"}</Text>}
        headerHeight={1}
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
              {wrap(modal.fix.preview, columns - 6, 2).map((l, i) => (
                <Text key={i} color={color.text}>
                  {l}
                </Text>
              ))}
              <Text color={color.faint}>{"You can undo it with ctrl+z."}</Text>
            </Panel>
          ) : null}
        </Box>
      </Box>
      <Box height={1} width={termCols} justifyContent="space-between">
        <Text color={toast.startsWith("✓") || toast.startsWith("↺") ? color.green : color.muted} wrap="truncate-end">
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
    ["ctrl+z", "undo the last change"],
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = render(<App />, { alternateScreen: true, exitOnCtrlC: true });
  await instance.waitUntilExit();
}
