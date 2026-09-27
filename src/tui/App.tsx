import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import { addRoot, allowTrackedLinks, discoverProjects, removeRoot, setHarnesses, setHidden, setKeepGlobal } from "../config.js";
import { ALL_PROJECT_DIRS, HARNESSES, installDirs, type HarnessId } from "../harnesses.js";
import { lstatSync } from "node:fs";
import {
  addSkill,
  createSkill,
  deleteLibrarySkill,
  importSkill,
  librarySkillDir,
  linkAll,
  linkEverywhere,
  relinkDependency,
  removeSkill,
  unlinkEverywhere,
  restoreBackup,
  syncProject,
  deleteGlobal,
  unloadGlobal,
  updateProject,
  visibilityOf,
  type Change,
  type Visibility,
} from "../library.js";
import { KeyBar, ListPanel, Panel, wrap, type Cell, type Hint, type Row } from "./components.js";
import {
  loadSnapshot,
  loadUsage,
  readPreview,
  USAGE_DAYS,
  versionHistory,
  type ProjectRow,
  type Snapshot,
  type Usage,
} from "./state.js";
import { color, kindColor, stateBadge } from "./theme.js";
import { CleanupWizard, type KeyHandler } from "./CleanupWizard.js";
import { HELP_TOPICS } from "../help.js";
import { gitInfo, relativeTo, type GitInfo, type GitState } from "../git.js";
import { buildReviewPrompt, copyText, type ReviewSkill } from "../review.js";

// ─── Types ────────────────────────────────────────────

type Place =
  | { kind: "library" }
  | { kind: "global" }
  | { kind: "health" }
  | { kind: "project"; root: string }
  | { kind: "settings" }
  | { kind: "help" };

type Result = { text: string; ok: boolean };
type Action = { label: string; hint?: string; run: () => void; keepOpen?: boolean };
type PreviewSpec = { title: string; dir?: string; meta: string[]; description?: string } | null;

type Item = {
  key: string;
  row: Row;
  search: string;
  tags: string[];
  primary?: { label: string; run: () => void };
  actions: Action[];
  preview: PreviewSpec;
  /** Items sharing a group (same plugin, same source repo, same name prefix) collapse together. */
  group?: { key: string; label: string; about?: string };
  /** Skill name and folder, for bulk actions on a group. */
  skill?: { name: string; path: string };
};
type Section = { title: string; items: Item[]; groupActions?: (members: Item[]) => Action[] };

/** Vendor skills group by plugin or account; skills.sh ones by source repo; the rest by name prefix. */
function sourceGroup(m: { kind: string; origin: string; name: string }): Item["group"] {
  if (m.kind === "plugin") {
    const synced = m.origin.includes("(claude.ai)");
    const name = m.origin.split("@")[0]!.replace(" (claude.ai)", "");
    return {
      key: `plugin:${m.origin}`,
      label: `${name} plugin`,
      about: synced
        ? `A Claude Code plugin your claude.ai account syncs to this machine. Only Claude Code loads it, in every repo. Manage it in claude.ai or with /plugin.`
        : `A Claude Code plugin you installed (${m.origin}), enabled in ~/.claude/settings.json. Only Claude Code loads it, in every repo. Turn it off with /plugin.`,
    };
  }
  if (m.kind === "claude.ai")
    return {
      key: "claude.ai",
      label: "claude.ai skills",
      about: "Skills from your claude.ai account (Settings → Capabilities), synced to ~/.claude/skills/synced. Only Claude Code loads them, in every repo. Manage them on claude.ai.",
    };
  if (m.kind === "built-in")
    return {
      key: `builtin:${m.origin}`,
      label: `${m.origin} built-in`,
      about: "Skills that ship with Cursor (~/.cursor/skills-cursor). Only Cursor loads them, in every repo. They update with Cursor and can't be removed.",
    };
  if (m.kind === "skills.sh" && m.origin.includes("/"))
    return {
      key: `repo:${m.origin}`,
      label: m.origin,
      about: `Installed with \`npx skills add ${m.origin}\` into ~/.agents/skills, so they load in every repo.`,
    };
  return prefixGroup(m.name);
}

/** Groups skills by their name's first segment: design-qa, design-qa-copy → "design-*". */
function prefixGroup(name: string): Item["group"] {
  const first = name.split("-")[0];
  return first ? { key: `prefix:${first}`, label: `${first}*` } : undefined;
}

/** Longest shared dash-separated prefix: code-qa-review, code-qa-plan → "code-qa-*". */
function commonPrefixLabel(names: string[], fallback: string): string {
  const parts = names.map((n) => n.split("-"));
  const shared: string[] = [];
  for (let i = 0; parts.every((p) => p.length > i + 1 && p[i] === parts[0]![i]); i++) shared.push(parts[0]![i]!);
  return shared.length ? `${shared.join("-")}-*` : fallback;
}

/**
 * Collapses items that share a group (2+ members) under one header row.
 * Headers toggle open and closed; bulk actions come from the section.
 */
function groupSection(
  section: Section,
  expanded: Set<string>,
  toggle: (key: string) => void,
  usesOf: (names: string[]) => string,
): Section {
  const counts = new Map<string, number>();
  for (const i of section.items) if (i.group) counts.set(i.group.key, (counts.get(i.group.key) ?? 0) + 1);
  const emitted = new Set<string>();
  const items: Item[] = [];
  for (const item of section.items) {
    const g = item.group;
    if (!g || (counts.get(g.key) ?? 0) < 2) {
      items.push(item);
      continue;
    }
    if (emitted.has(g.key)) continue;
    emitted.add(g.key);
    const members = section.items.filter((i) => i.group?.key === g.key);
    const key = `grp:${section.title}:${g.key}`;
    const label = g.key.startsWith("prefix:") ? commonPrefixLabel(members.map((m) => m.skill?.name ?? ""), g.label) : g.label;
    const open = expanded.has(key);
    const run = () => toggle(key);
    items.push({
      key,
      search: [label, ...members.map((m) => m.search)].join(" "),
      tags: [],
      row: {
        key,
        cells: [
          { text: open ? "▾ " : "▸ ", color: color.accent },
          { text: label, grow: true, bold: true },
          { text: plural(members.length, "skill").padStart(10), width: 10, color: color.muted },
          { text: usesOf(members.map((m) => m.skill?.name ?? "")).padStart(6), width: 6, color: color.muted },
        ],
      },
      primary: { label: open ? "collapse" : "expand", run },
      actions: [{ label: open ? "Collapse" : `Show the ${members.length} skills`, run }, ...(section.groupActions?.(members) ?? [])],
      preview: {
        title: label,
        meta: [plural(members.length, "skill"), open ? "space collapses" : "space expands · enter for actions on all of them"],
        description: g.about ? `${g.about}  Skills: ${members.map((m) => m.skill?.name ?? m.key).join(", ")}` : members.map((m) => m.skill?.name ?? m.key).join(", "),
      },
    });
    if (open) {
      for (const m of members) items.push({ ...m, row: { ...m.row, cells: [{ text: "  " }, ...m.row.cells] } });
    }
  }
  return { ...section, items };
}


type Overlay =
  | { type: "confirm"; message: string; onYes: () => Result }
  | { type: "prompt"; label: string; value: string; onSubmit: (value: string) => void }
  | { type: "menu"; title: string; build: () => Action[]; index: number }
  | { type: "help"; topic: number; scroll: number }
  | null;

/** A project's skills, split by where they live. */
type ProjectTab = "usable" | "add";
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "usable", label: "Usable here" },
  { id: "add", label: "Add skills" },
];

// ─── Helpers ──────────────────────────────────────────

const tildify = (p: string) => (p === homedir() || p.startsWith(homedir() + sep) ? "~" + p.slice(homedir().length) : p);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ok = (text: string): Result => ({ text, ok: true });
const warn = (text: string): Result => ({ text, ok: false });

function describe(change: Change, where?: string): Result {
  if (change.action === "skipped") return warn(`${change.name}: ${change.reason}`);
  const versions = change.from && change.from !== change.to ? ` v${change.from} → v${change.to}` : change.to ? ` v${change.to}` : "";
  const verb = { installed: "added to", updated: "updated in", removed: "removed from" }[change.action];
  return ok(where ? `${change.name}${change.action === "removed" ? "" : versions} ${verb} ${where}` : `${change.name} ${change.action}`);
}

function openFolder(dir: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
}

/**
 * Search match: prefix first, then substring, then word initials
 * ("cfw" → "cloudflare-workers"). Null when it doesn't match.
 */
function matchScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  const initials = t
    .split(/[-_\s./]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("");
  return q.length >= 2 && initials.startsWith(q) ? 2 : null;
}

function placeKey(place: Place): string {
  return place.kind === "project" ? `project:${place.root}` : place.kind;
}

function versionText(r: ProjectRow): string {
  if (r.state === "available") return r.latest ? `v${r.latest}` : "";
  if (!r.managed) return r.latest ? `lib v${r.latest}` : "";
  if (r.version && r.latest && r.latest > r.version) return `v${r.version} → v${r.latest}`;
  return r.version ? `v${r.version}` : "";
}

const harnessName = (id: HarnessId) => HARNESSES.find((h) => h.id === id)?.name ?? id;

/**
 * One icon per enabled harness, in its brand color when that harness loads the
 * skill and faint when it doesn't. "²" marks a skill reached through two
 * folders (Cursor reads several), which it may list twice.
 */
function harnessChips(visibility: Visibility, installed: boolean): Cell[] {
  return visibility.flatMap((v): Cell[] => {
    const h = HARNESSES.find((x) => x.id === v.id);
    const on = installed && v.paths > 0;
    return [
      { text: ` ${h?.icon ?? "?"}`, color: on ? h?.color : color.faint, dim: !on },
      { text: v.paths > 1 && installed ? "²" : " ", color: color.yellow },
    ];
  });
}

const GIT_LABEL: Record<GitState, { text: string; color: string }> = {
  committed: { text: "✓ committed", color: color.green },
  changed: { text: "± changed", color: color.yellow },
  new: { text: "+ not added", color: color.blue },
  ignored: { text: "∅ ignored", color: color.faint },
};

const GIT_ABOUT: Record<GitState, string> = {
  committed: "committed to git — teammates get it",
  changed: "committed, with uncommitted changes",
  new: "not committed yet (shows in git status)",
  ignored: "gitignored — only on this machine",
};

/** Fixed-width git column; blank for rows that aren't in the repo, absent when it's not a git repo. */
function gitCell(state: GitState | null, isRepo: boolean): Cell[] {
  if (!isRepo) return [];
  if (!state) return [{ text: "", width: 12 }];
  const l = GIT_LABEL[state];
  return [{ text: ` ${l.text}`, width: 12, color: l.color }];
}

/** Legend for the harness icons, e.g. "✻ Claude Code  ⬡ Cursor". */
function HarnessLegend({ ids }: { ids: HarnessId[] }) {
  return (
    <Text>
      {ids.map((id) => {
        const h = HARNESSES.find((x) => x.id === id)!;
        return (
          <Text key={id}>
            <Text color={h.color}>{`${h.icon} `}</Text>
            <Text color={color.muted}>{`${h.name}  `}</Text>
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * Wraps a help line, keeping its spacing. For "label    text" lines, wrapped
 * text lines up under the text column instead of the start of the line.
 */
function wrapAligned(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const gap = line.match(/^(\S.*?\s{2,})\S/);
  const indent = gap && gap[1]!.length < width / 2 ? gap[1]!.length : 0;
  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    const cut = rest.lastIndexOf(" ", width);
    const at = cut > indent ? cut : width;
    out.push(rest.slice(0, at));
    rest = " ".repeat(indent) + rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

function hasLinks(root: string, name: string): boolean {
  return ALL_PROJECT_DIRS.some((d) => {
    try {
      return lstatSync(join(root, d, name)).isSymbolicLink();
    } catch {
      return false;
    }
  });
}

// ─── App ──────────────────────────────────────────────

export function App() {
  const { exit, suspendTerminal } = useApp();
  const { columns, rows: termRows } = useWindowSize();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => loadSnapshot());
  const [usage, setUsage] = useState<Usage | null>(null);
  // First run: choose harnesses, then where projects live. Skips steps already done.
  const [setup, setSetup] = useState<{ step: "harnesses" | "folder"; selected: HarnessId[]; index: number; value: string } | null>(() =>
    !snapshot.harnessesChosen || snapshot.roots.length === 0
      ? { step: snapshot.harnessesChosen ? "folder" : "harnesses", selected: snapshot.harnesses, index: 0, value: "~/Projects" }
      : null,
  );
  const [focus, setFocus] = useState<"left" | "right">("left");
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (snapshot.cwdProject) initial.left = `project:${snapshot.cwdProject}`;
    return initial;
  });
  const [search, setSearch] = useState({ left: "", right: "" });
  const [projectTab, setProjectTab] = useState<ProjectTab>("usable");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [wizard, setWizard] = useState<{ initialSkill?: string } | null>(null);
  const wizardInput = useRef<KeyHandler | null>(null);
  // Git state per project, recomputed once per reload rather than on every key press.
  const gitCache = useRef(new Map<string, { snapshot: Snapshot; info: GitInfo | null }>());
  const gitFor = (root: string): GitInfo | null => {
    const hit = gitCache.current.get(root);
    if (hit && hit.snapshot === snapshot) return hit.info;
    const info = gitInfo(root);
    gitCache.current.set(root, { snapshot, info });
    return info;
  };
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);

  const reload = () => setSnapshot(loadSnapshot());
  const say = (text: string, good = true) => setToast({ text, ok: good });
  const act = (fn: () => Result) => {
    const result = fn();
    reload();
    setToast(result);
  };
  const confirm = (message: string, onYes: () => Result) => setOverlay({ type: "confirm", message, onYes });

  const rescan = (then?: () => void) => {
    setScanning(true);
    setTimeout(() => {
      discoverProjects();
      reload();
      setScanning(false);
      then?.();
    }, 30);
  };

  useEffect(() => {
    if (snapshot.roots.length > 0) rescan();
  }, []);

  useEffect(() => {
    let live = true;
    void loadUsage(snapshot.projects).then((u) => live && setUsage(u));
    return () => {
      live = false;
    };
  }, [snapshot.projects.join("\n")]);

  const edit = async (file: string) => {
    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
    await suspendTerminal(() => {
      // $EDITOR may carry args ("code -w"), so it goes through the shell — but the path is
      // passed as $1, never interpolated: skill folder names come from third-party repos.
      // Windows paths can't contain `"`, so quoting is safe there (and cmd resolves .cmd shims).
      if (process.platform === "win32") spawnSync(`${editor} "${file}"`, { shell: true, stdio: "inherit" });
      else spawnSync("/bin/sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
    });
    reload();
    say(`Saved ${tildify(file)}`);
  };

  const usesOf = (skill: string, root?: string) => (usage ? ((root ? usage.byProject.get(root)?.get(skill) : usage.total.get(skill)) ?? 0) : null);
  const usesText = (skill: string, root?: string) => {
    const n = usesOf(skill, root);
    return n === null ? "…" : n === 0 ? "–" : String(n);
  };
  const libraryNames = new Set(snapshot.library.map((l) => l.name));
  const enabledIds = snapshot.harnesses;

  // ─── Left pane: places and projects ───────────────

  const issueCount = snapshot.issues.length;
  const problems = snapshot.issues.filter((i) => i.severity === "problem").length;
  const placeRow = (key: string, icon: string, label: string, hint: string, hintColor = color.muted): Row => ({
    key,
    cells: [
      { text: `${icon} `, color: color.accent },
      { text: label, grow: true, bold: true },
      { text: hint, color: hintColor },
    ],
  });
  const leftEntries: { key: string; place: Place; row: Row; search: string }[] = [
    { key: "library", place: { kind: "library" }, row: placeRow("library", "▤", "Your skills", `${snapshot.library.length}`), search: "your skills library" },
    {
      key: "global",
      place: { kind: "global" },
      row: placeRow("global", "◈", "Global", `${snapshot.machine.filter((m) => !m.broken).length}`),
      search: "global",
    },
    {
      key: "health",
      place: { kind: "health" },
      row: placeRow("health", problems ? "●" : "✓", "Health", issueCount ? `${issueCount}` : "ok", problems ? color.red : color.green),
      search: "health",
    },
    ...snapshot.projects.map((root) => {
      const rows = snapshot.rows.get(root) ?? [];
      const installed = rows.filter((r) => r.installed).length;
      const behind = rows.some((r) => r.state.includes("update") || r.state === "folder missing");
      return {
        key: `project:${root}`,
        place: { kind: "project", root } as Place,
        search: basename(root),
        row: {
          key: `project:${root}`,
          cells: [
            { text: root === snapshot.cwdProject ? "◆ " : "  ", color: color.accent },
            { text: basename(root), grow: true },
            { text: installed ? String(installed).padStart(3) : "  –", color: installed ? color.muted : color.faint },
            { text: behind ? " ↑" : "  ", color: color.yellow },
          ] as Cell[],
        },
      };
    }),
    {
      key: "settings",
      place: { kind: "settings" },
      row: {
        key: "settings",
        cells: [
          { text: "⚙ ", color: color.accent },
          { text: "Settings", grow: true, bold: true },
          ...snapshot.harnesses.map((id) => {
            const h = HARNESSES.find((x) => x.id === id)!;
            return { text: ` ${h.icon}`, color: h.color };
          }),
        ],
      },
      search: "settings harnesses folders",
    },
    {
      key: "help",
      place: { kind: "help" },
      row: placeRow("help", "?", "Help", "where skills come from", color.faint),
      search: "help docs where skills come from",
    },
  ];
  const leftVisible = leftEntries.filter((e) => matchScore(e.search, search.left) !== null);
  const leftRows: Row[] = [];
  let lastGroup = "";
  for (const e of leftVisible) {
    const group = e.place.kind === "project" ? "Projects" : e.place.kind === "settings" || e.place.kind === "help" ? " " : "";
    if (group && group !== lastGroup) leftRows.push({ key: `h:${group}`, header: true, cells: [{ text: group.trim() }] });
    lastGroup = group;
    leftRows.push(e.row);
  }
  const leftKey = leftVisible.some((e) => e.key === selected.left) ? selected.left! : (leftVisible[0]?.key ?? "");
  const place: Place = leftVisible.find((e) => e.key === leftKey)?.place ?? { kind: "library" };
  const pKey = placeKey(place);

  // ─── Right pane: the place's skills ───────────────

  function projectSections(root: string): Record<ProjectTab, Section[]> {
    const where = basename(root);
    const git = gitFor(root);
    const gitOf = (path: string): GitState | null => (git ? git.of(relativeTo(root, path)) : null);
    const rows = snapshot.rows.get(root) ?? [];
    const projectActions: Action[] = [
      {
        label: `Update every skill in ${where}`,
        run: () => act(() => ok(updateProject(root).map((c) => describe(c).text).join(" · ") || `${where} is up to date`)),
      },
      {
        label: "Restore missing skills (sync)",
        run: () => act(() => ok(syncProject(root).map((c) => describe(c).text).join(" · ") || "Nothing missing")),
      },
      { label: `Open ${where} folder`, run: () => openFolder(root) },
      {
        label: `Hide ${where} from the list`,
        run: () =>
          confirm(`Hide ${where}? Bring it back with: skilllib unhide ${tildify(root)}`, () => {
            setHidden(root, true);
            return ok(`${where} hidden`);
          }),
      },
    ];
    /** addSkill, then ask once before linking into folders git tracks (e.g. a team's .agents/skills for Codex). */
    const install = (name: string, opts: { force?: boolean; version?: number } = {}) => {
      const change = addSkill(root, name, opts);
      reload();
      const result = describe(change, where);
      if (change.blocked?.length) {
        const who = visibilityOf(root, name)
          .filter((v) => v.paths === 0)
          .map((v) => harnessName(v.id));
        return confirm(
          `${result.text}. ${where} tracks ${change.blocked.join(", ")} in git — add a link there too so ${who.join(", ") || "other agents"} can use it? (remembered for ${where})`,
          () => {
            allowTrackedLinks(root);
            return describe(addSkill(root, name, { ...opts, allowTracked: true }), where);
          },
        );
      }
      setToast(result);
    };
    const versionsMenu = (name: string, current: number | null): Action => ({
      label: "Install a specific version…",
      run: () =>
        setOverlay({
          type: "menu",
          title: `${name} versions`,
          index: 0,
          build: () =>
            [...versionHistory(name)].reverse().map((v) => ({
              label: `v${v.version}${v.version === current ? "  (installed)" : ""}`,
              hint: v.date.slice(0, 16).replace("T", " "),
              run: () => install(name, { version: v.version, force: true }),
            })),
        }),
    });

    const item = (r: ProjectRow): Item => {
      const dir = r.path;
      const badge = stateBadge(r.state);
      const edited = r.state.startsWith("edited");
      const inRepo = r.location === ".agents/skills" && !r.managed;
      const missing = r.visibility.filter((v) => v.paths === 0);
      const seenBy = r.visibility.filter((v) => v.paths > 0);
      const notInLibrary = r.state === "local only" || r.state === "untracked, differs from library" || r.state === "repo skill" || r.state === "repo skill, differs from library";
      const behind = r.state.includes("update");
      const key = `${r.location}:${r.name}`;
      const globalCopy = snapshot.machine.find((m) => m.name === r.name && !m.broken && m.harnesses.length > 0);

      // .claude/skills skills become dependencies once they're in the library.
      const saveToLibrary = () =>
        act(() => {
          const imported = importSkill(dir, { force: true });
          const change = addSkill(root, r.name);
          return ok(`${r.name} ${imported.status === "added" ? "added to" : "saved to"} the library as v${change.to}; ${where} now tracks it`);
        });
      // .agents/skills skills are committed and owned by the repo: copy them, never take them over.
      const copyRepoSkillToLibrary = () =>
        act(() => {
          const imported = importSkill(dir, { force: true });
          return ok(
            imported.status === "unchanged"
              ? `${r.name} is already in the library`
              : `${r.name} ${imported.status === "added" ? "copied into" : "updated in"} the library; this repo keeps its copy`,
          );
        });
      // Links make one real copy load in every harness you use; tracked folders need your OK once.
      const makeVisible = (allowTracked = false) => {
        const res = r.managed ? relinkDependency(root, r.name, { allowTracked }) : linkEverywhere(root, r.name, r.location, { allowTracked });
        if (res.blocked.length && !allowTracked) {
          return confirm(`${where} tracks ${res.blocked.join(", ")} in git. Add links there anyway? (remembered for ${where})`, () => {
            allowTrackedLinks(root);
            const again = r.managed ? relinkDependency(root, r.name, { allowTracked: true }) : linkEverywhere(root, r.name, r.location, { allowTracked: true });
            return ok(`${r.name}: linked into ${again.created.join(", ") || "nothing new"}`);
          });
        }
        reload();
        say(res.created.length ? `${r.name}: linked into ${res.created.join(", ")}` : `${r.name} is already visible to all your harnesses`);
      };
      const removeLinks = () =>
        act(() => {
          const removed = unlinkEverywhere(root, r.name);
          return ok(removed.length ? `${r.name}: removed links in ${removed.join(", ")}` : `${r.name} has no links`);
        });
      const remove = () =>
        edited
          ? confirm(`${r.name} has local edits in ${where}. Remove it and lose them?`, () => describe(removeSkill(root, r.name, { force: true }), where))
          : act(() => describe(removeSkill(root, r.name), where));

      let primary: Item["primary"];
      const actions: Action[] = [];
      const visibilityActions: Action[] = [
        ...(r.installed && missing.length
          ? [{ label: `Make visible to ${missing.map((v) => harnessName(v.id)).join(", ")}`, hint: "adds links; one real copy", run: () => makeVisible() }]
          : []),
        ...(r.installed && !r.managed && r.visibility.some((v) => v.paths > 0) && hasLinks(root, r.name)
          ? [{ label: "Remove links", hint: "keeps the real folder", run: removeLinks }]
          : []),
      ];
      if (inRepo) {
        const libraryAction: Action =
          r.state === "repo skill"
            ? { label: "Copy to Your skills", hint: "so other repos can use it; this repo keeps its copy", run: copyRepoSkillToLibrary }
            : r.state === "repo skill, differs from library"
              ? { label: "Update Your skills from this repo's copy", hint: "becomes a new version", run: copyRepoSkillToLibrary }
              : { label: "Already in Your skills", hint: `v${r.latest}`, run: () => say(`${r.name} matches library v${r.latest}`) };
        primary =
          r.state === "repo skill, in library"
            ? missing.length
              ? { label: "make visible to all", run: () => makeVisible() }
              : undefined
            : { label: "copy to your skills", run: copyRepoSkillToLibrary };
        actions.push(libraryAction, ...visibilityActions);
      } else if (notInLibrary) {
        primary = { label: "copy to your skills", run: saveToLibrary };
        actions.push({ label: "Copy to Your skills", hint: "so other repos can use it; this repo then tracks it", run: saveToLibrary });
        if (r.state === "untracked, differs from library") {
          actions.push({
            label: "Replace with the library version",
            run: () =>
              confirm(`Replace ${r.name} with library v${r.latest}? This project's copy is lost.`, () => describe(addSkill(root, r.name, { force: true }), where)),
          });
        }
      } else if (!r.installed && globalCopy) {
        // Already loads everywhere: a project copy would load twice. Scoping it here is usually what you want.
        const scope = () =>
          confirm(
            `Use ${r.name} only where you add it? It's added to ${where} and stops loading globally (other projects lose it until you add it there). Restorable from Health.`,
            () => {
              const added = addSkill(root, r.name);
              if (added.action === "skipped") return warn(`${r.name}: ${added.reason}`);
              const res = unloadGlobal(globalCopy.path, globalCopy.links);
              return res.ok ? ok(`${r.name} now lives in ${where} (v${added.to}) and no longer loads everywhere`) : warn(`${r.name}: ${res.reason}`);
            },
          );
        const addAnyway = () =>
          confirm(`${r.name} already loads in every project. Add a project copy too? Agents will see it twice.`, () => {
            const added = addSkill(root, r.name);
            return describe(added, where);
          });
        primary = { label: "add (already global)", run: addAnyway };
        actions.push(
          ...(globalCopy.movable ? [{ label: `Use only in ${where}`, hint: "add here, stop loading everywhere", run: scope }] : []),
          { label: `Add to ${where} anyway`, hint: "it'll load twice", run: addAnyway },
        );
      } else if (!r.installed) {
        primary = { label: "add", run: () => install(r.name) };
        actions.push({ label: `Add to ${where}`, hint: r.latest ? `v${r.latest}` : "", run: primary.run }, versionsMenu(r.name, null));
      } else if (!r.managed) {
        primary = { label: "track", run: () => install(r.name) };
        actions.push({ label: "Track it as a dependency", hint: "same as the library copy", run: primary.run });
      } else {
        primary = { label: "remove", run: remove };
        if (behind) {
          actions.push({ label: `Update to v${r.latest}`, run: () => install(r.name, { force: edited }) });
        }
        if (r.state === "folder missing") {
          actions.push({
            label: "Restore it",
            run: () => install(r.name, { version: r.version ?? undefined, force: true }),
          });
        }
        if (edited) {
          actions.push({ label: "Save local edits to Your skills", hint: "becomes a new version", run: saveToLibrary });
          actions.push({
            label: `Revert to v${r.version}`,
            run: () =>
              confirm(`Discard local edits to ${r.name}?`, () => describe(addSkill(root, r.name, { version: r.version ?? undefined, force: true }), where)),
          });
        }
        actions.push(versionsMenu(r.name, r.version), { label: `Remove from ${where}`, run: remove });
      }
      if (!inRepo) actions.push(...visibilityActions);
      actions.push(
        { label: "Edit SKILL.md", run: () => void edit(join(dir, "SKILL.md")) },
        { label: "Open folder", run: () => openFolder(dir) },
        ...projectActions,
      );

      const origin = snapshot.library.find((l) => l.name === r.name)?.origin;
      const whereLabel = r.installed ? r.location.replace("/skills", "") : "";
      return {
        key,
        search: r.name,
        group: prefixGroup(r.name),
        skill: { name: r.name, path: dir },
        tags: [
          r.installed ? "in this project" : "installable",
          ...(r.installed && r.state !== "ok" && r.state !== "repo skill, in library" ? ["needs attention"] : []),
        ],
        row: {
          key,
          cells: [
            {
              text: !r.installed ? "○ " : missing.length === 0 ? "◉ " : "◌ ",
              color: !r.installed ? color.faint : missing.length === 0 ? color.green : color.blue,
            },
            { text: r.name, grow: true, color: r.installed ? undefined : color.muted },
            { text: whereLabel.padStart(8), width: 8, color: color.faint },
            ...gitCell(r.installed ? gitOf(r.path) : null, !!git),
            ...harnessChips(r.visibility.length ? r.visibility : enabledIds.map((id) => ({ id, paths: 0 })), r.installed),
            { text: versionText(r).padStart(8), width: 8, color: behind ? color.yellow : color.muted },
            {
              text:
                r.installed && dupes(r.name) > 1
                  ? `  ⧉ ${dupes(r.name)} copies`
                  : !r.installed && globalCopy
                    ? "  ↗ already global"
                    : `  ${badge.icon} ${badge.label}`,
              width: 19,
              color: r.installed && dupes(r.name) > 1 ? color.red : !r.installed && globalCopy ? color.yellow : badge.color,
            },
            { text: usesText(r.name, root).padStart(4), color: color.muted },
          ],
        },
        primary,
        actions,
        preview: {
          title: r.name,
          dir,
          meta: [
            r.installed
              ? `${seenBy.length ? `loaded by ${seenBy.map((v) => `${harnessName(v.id)}${v.paths > 1 ? ` (via ${v.paths} folders)` : ""}`).join(", ")}` : "not loaded by your harnesses"}${missing.length ? ` · not ${missing.map((v) => harnessName(v.id)).join(", ")}` : ""}`
              : "not installed",
            inRepo
              ? `committed in ${r.location}`
              : r.installed
                ? r.managed
                  ? `v${r.version} installed in .claude/skills`
                  : notInLibrary
                    ? "only in this project"
                    : "untracked copy"
                : "not installed",
            ...(r.installed && git ? [GIT_ABOUT[gitOf(r.path)!]] : []),
            r.inLibrary ? `in Your skills (v${r.latest}${origin ? `, from ${origin}` : ""})` : "not in Your skills",
            `${usesText(r.name, root)} Claude Code uses here (${USAGE_DAYS}d)`,
          ],
          ...(r.installed && dupes(r.name) > 1
            ? { description: `Loaded ${dupes(r.name)} times here: ${copiesOf(r.name).join(" · ")}. Agents may see it twice — keep one.` }
            : {}),
        },
      };
    };
    // The same skill name reaching agents from several places (e.g. a skill and a plugin both named ponytail).
    const usableGlobals = snapshot.machine.filter((m) => !m.broken && m.harnesses.length > 0);
    const copiesOf = (name: string): string[] => [
      ...rows.filter((r) => r.installed && r.name === name).map((r) => `this repo (${r.location})`),
      ...usableGlobals.filter((m) => m.name === name).map((m) => (m.kind === "plugin" ? `plugin ${m.origin}` : m.kind === "claude.ai" ? "claude.ai" : `global ${tildify(m.path)}`)),
    ];
    const dupes = (name: string) => copiesOf(name).length;
    // Global skills load here too; show them so the view matches what agents actually have.
    const globalItem = (m: (typeof snapshot.machine)[number]): Item => {
      const inLib = libraryNames.has(m.name);
      const kept = m.movable && snapshot.keptGlobal.has(m.name);
      const alsoLocal = rows.some((r) => r.installed && r.name === m.name);
      const moveHere = () =>
        confirm(
          `Use ${m.name} only where you add it? It's ${inLib ? "" : "imported into the library, "}added to ${where}, and stops loading globally — other projects lose it until you add it there. Restorable from Health.`,
          () => {
            if (!inLib) importSkill(m.path);
            const added = addSkill(root, m.name);
            if (added.action === "skipped") return warn(`${m.name}: ${added.reason}`);
            const r = unloadGlobal(m.path, m.links);
            return r.ok ? ok(`${m.name} now lives in ${where} (v${added.to}) and no longer loads everywhere`) : warn(`${m.name}: ${r.reason}`);
          },
        );
      const actions: Action[] = m.movable
        ? [
            { label: "Choose which repos keep it…", hint: "cleanup wizard", run: () => setWizard({ initialSkill: m.name }) },
            keepAction(m),
            { label: `Use only in ${where}`, hint: "add here, stop loading everywhere", run: moveHere },
            { label: "Delete", hint: "not kept in Your skills · restorable from Health", run: () => confirmDeleteGlobal([m]) },
            ...(inLib
              ? []
              : [
                  {
                    label: "Import into the library",
                    hint: "keeps it global too",
                    run: () => act(() => ok(`${m.name} ${importSkill(m.path).status === "added" ? "imported into the library" : "already in the library"}`)),
                  },
                ]),
            { label: "Open folder", run: () => openFolder(m.path) },
          ]
        : [{ label: `Comes from ${m.origin} — manage it there`, run: () => say(`${m.name} is managed by ${m.origin}`, false) }];
      actions.push({ label: "Copy review prompt", hint: "an agent decides keep / move / delete", run: () => copyReviewPrompt([reviewOfGlobal(m)], "This is one global skill.") });
      return {
        key: `global:${m.path}`,
        search: m.name,
        group: sourceGroup(m),
        skill: { name: m.name, path: m.path },
        tags: ["global", ...(alsoLocal ? ["needs attention"] : [])],
        row: {
          key: `global:${m.path}`,
          cells: [
            { text: "◈ ", color: color.accentDim },
            { text: m.name, grow: true },
            { text: (m.kind === "global" || m.kind === "skills.sh" ? "global" : m.kind).padStart(8), width: 8, color: color.faint },
            ...gitCell(null, !!git),
            ...harnessChips(enabledIds.map((id) => ({ id, paths: m.harnesses.includes(id) ? 1 : 0 })), true),
            { text: "", width: 8 },
            {
              text: `  ${dupes(m.name) > 1 ? `⧉ ${dupes(m.name)} copies` : kept ? "✓ global" : m.movable ? "⚠ loaded globally" : "vendor"}`,
              width: 19,
              color: dupes(m.name) > 1 ? color.red : kept ? color.green : m.movable ? color.yellow : color.faint,
            },
            { text: usesText(m.name, root).padStart(4), color: color.muted },
          ],
        },
        primary: m.movable ? { label: "choose repos…", run: () => setWizard({ initialSkill: m.name }) } : undefined,
        actions,
        preview: {
          title: m.name,
          dir: m.path,
          meta: [
            `loaded in every project by ${m.harnesses.map(harnessName).join(", ")}`,
            `${m.kind}: ${m.origin}`,
            kept ? "yours: kept global on purpose" : m.movable ? "yours: the cleanup wizard can scope it to projects" : "managed by the vendor",
          ],
          description: dupes(m.name) > 1 ? `Loaded ${dupes(m.name)} times here: ${copiesOf(m.name).join(" · ")}. Agents may see it twice — keep one.` : sourceGroup(m)?.about,
        },
      };
    };
    const local = rows.filter((r) => r.installed);
    const installable = rows.filter((r) => !r.installed);
    const globals = snapshot.machine.filter((m) => !m.broken && m.harnesses.length > 0);
    // One action to make every local skill (the repo's own included) usable by all your agents.
    const partial = local.filter((r) => r.state !== "folder missing" && r.visibility.some((v) => v.paths === 0));
    const missingAgents = [...new Set(partial.flatMap((r) => r.visibility.filter((v) => v.paths === 0).map((v) => v.id)))];
    const runLinkAll = (allowTracked = false) => {
      const res = linkAll(root, { allowTracked });
      if (res.blocked.length && !allowTracked) {
        return confirm(
          `${where} tracks ${res.blocked.join(", ")} in git. Add links there too? (remembered for ${where})${res.linked.length ? ` Already linked ${plural(res.linked.length, "skill")}.` : ""}`,
          () => {
            allowTrackedLinks(root);
            const again = linkAll(root, { allowTracked: true });
            return ok(`Linked ${plural(res.linked.length + again.linked.length, "skill")}; every skill here is usable by all your agents`);
          },
        );
      }
      reload();
      say(res.linked.length ? `Linked ${plural(res.linked.length, "skill")} for ${missingAgents.map(harnessName).join(", ")}` : "Every skill here is already usable by all your agents");
    };
    const linkAllItem: Item[] = partial.length
      ? [
          {
            key: "__link-all",
            search: "make all usable link",
            tags: ["in this project", "needs attention"],
            row: {
              key: "__link-all",
              cells: [
                { text: "⇄ ", color: color.accent },
                {
                  text: `Make all ${partial.length} skills here usable by ${missingAgents.map(harnessName).join(", ")}`,
                  grow: true,
                  color: color.accent,
                },
              ],
            },
            primary: { label: "link them all", run: () => runLinkAll() },
            actions: [{ label: "Link every skill for every agent you use", hint: "adds links only; copies and moves nothing", run: () => runLinkAll() }],
            preview: {
              title: "Make every skill usable by all your agents",
              meta: [`${plural(partial.length, "skill")} missing for ${missingAgents.map(harnessName).join(", ")}`],
              description: `Adds relative symlinks so each agent's folder reaches the one real copy (e.g. .claude/skills/<name> → .agents/skills/<name>). The repo's files aren't changed; folders git tracks need your OK first. Cursor reads several folders, so it may see a linked skill through two paths (shown as ²).`,
            },
          },
        ]
      : [];
    const fromLibrary = local.filter((r) => r.managed || r.state === "untracked copy of library skill");
    const repoOwn = local.filter((r) => !fromLibrary.includes(r));
    const yours = globals.filter((m) => m.movable);
    const keptYours = yours.filter((m) => snapshot.keptGlobal.has(m.name));
    const unreviewed = yours.filter((m) => !snapshot.keptGlobal.has(m.name));
    const vendor = globals.filter((m) => !m.movable);
    const cleanupItem: Item[] = unreviewed.length
      ? [
          {
            key: "__cleanup",
            search: "clean up global",
            tags: [],
            row: {
              key: "__cleanup",
              cells: [
                { text: "⚠ ", color: color.yellow },
                { text: `${plural(unreviewed.length, "skill")} of yours load in every repo — choose where each should live…`, grow: true, color: color.yellow },
              ],
            },
            primary: { label: "clean up", run: () => setWizard({}) },
            actions: [{ label: "Open the cleanup wizard", run: () => setWizard({}) }],
            preview: {
              title: "Clean up global skills",
              meta: ["every agent reads global skills in every repo"],
              description: "Pick which projects keep each of your global skills. The wizard installs them there and stops loading them everywhere else (originals kept in backup).",
            },
          },
        ]
      : [];
    return {
      usable: [
        { title: "", items: linkAllItem },
        {
          title: `From your skills (${fromLibrary.length})`,
          items: fromLibrary.map(item),
          groupActions: (members) => [
            {
              label: `Remove all ${members.length} from ${where}`,
              hint: "edited ones are kept",
              run: () =>
                confirm(`Remove ${plural(members.length, "skill")} from ${where}? Your library keeps them.`, () => {
                  const done = members.map((m) => removeSkill(root, m.skill!.name)).filter((c) => c.action === "removed").length;
                  return ok(`Removed ${plural(done, "skill")} from ${where}`);
                }),
            },
          ],
        },
        {
          title: `The repo's own (${repoOwn.length})`,
          items: repoOwn.map(item),
          groupActions: (members) => [
            {
              label: `Copy all ${members.length} into your library`,
              hint: "the repo keeps its copies",
              run: () =>
                act(() => {
                  const added = members.map((m) => importSkill(m.skill!.path, { force: true })).filter((r) => r.status !== "unchanged").length;
                  return ok(`${plural(added, "skill")} copied into your library`);
                }),
            },
          ],
        },
        {
          title: `⚠ Global · yours, not reviewed, loaded in every repo (${unreviewed.length})`,
          items: [...cleanupItem, ...unreviewed.map(globalItem)],
          groupActions: (members) => [...keepGroupActions(members), ...yourGlobalActions(members)],
        },
        {
          title: `✓ Global · yours, on purpose (${keptYours.length})`,
          items: keptYours.map(globalItem),
          groupActions: (members) => [...keepGroupActions(members), ...yourGlobalActions(members)],
        },
        {
          title: `Global · from vendors: plugins, claude.ai, built-in (${vendor.length})`,
          items: vendor.map(globalItem),
          groupActions: (members) => [{
              label: `Copy review prompt for all ${members.length}`,
              hint: "for an agent to decide keep / move / delete",
              run: () => copyReviewPrompt(snapshot.machine.filter((m) => members.some((x) => x.skill?.path === m.path)).map(reviewOfGlobal), `These are global skills (group ${members[0]?.group?.label ?? ""}).`),
            }],
        },
      ],
      add: [
        {
          title: "",
          items: installable.map(item),
          groupActions: (members) => [
            {
              label: `Add all ${members.length} to ${where}`,
              hint: members.some((m) => snapshot.machine.some((g) => g.name === m.skill?.name && !g.broken)) ? "some already load globally" : "",
              run: () =>
                act(() => {
                  const added = members.map((m) => addSkill(root, m.skill!.name)).filter((c) => c.action !== "skipped").length;
                  return ok(`Added ${plural(added, "skill")} to ${where}`);
                }),
            },
          ],
        },
      ],
    };
  }

  function librarySections(): Section[] {
    const newSkill: Item = {
      key: "__new",
      search: "new skill create",
      tags: [],
      row: { key: "__new", cells: [{ text: "+ ", color: color.accent }, { text: "New skill…", grow: true, color: color.accent }] },
      primary: { label: "create", run: () => promptNewSkill() },
      actions: [{ label: "Create a new skill", run: () => promptNewSkill() }],
      preview: { title: "New skill", meta: ["creates ~/.skilllib/library/<name>/SKILL.md and opens it in your editor"] },
    };
    const items = snapshot.library.map((l): Item => {
      const toggleProjects: Action = {
        label: "Add to / remove from projects…",
        run: () =>
          setOverlay({
            type: "menu",
            title: `${l.name} · space toggles a project`,
            index: 0,
            build: () => {
              const fresh = loadSnapshot();
              const now = fresh.library.find((x) => x.name === l.name)?.projects ?? [];
              return fresh.projects.map((root) => {
                const on = now.includes(root);
                return {
                  label: `${on ? "◉" : "○"} ${basename(root)}`,
                  hint: tildify(root),
                  keepOpen: true,
                  run: () => act(() => describe(on ? removeSkill(root, l.name) : addSkill(root, l.name), basename(root))),
                };
              });
            },
          }),
      };
      return {
        key: l.name,
        search: `${l.name} ${l.description}`,
        group: prefixGroup(l.name),
        skill: { name: l.name, path: librarySkillDir(l.name) },
        tags: [l.projects.length ? "in use" : "unused"],
        row: {
          key: l.name,
          cells: [
            { text: l.name, grow: true },
            { text: l.version ? `v${l.version}`.padStart(6) : "      ", color: color.muted },
            {
              text: (l.projects.length ? plural(l.projects.length, "project") : "unused").padStart(13),
              color: l.projects.length ? color.green : color.faint,
            },
            { text: usesText(l.name).padStart(5), color: color.muted },
          ],
        },
        primary: { label: "choose projects", run: toggleProjects.run },
        actions: [
          toggleProjects,
          { label: "Edit SKILL.md", hint: "saving creates a new version", run: () => void edit(join(librarySkillDir(l.name), "SKILL.md")) },
          { label: "Open folder", run: () => openFolder(librarySkillDir(l.name)) },
          {
            label: "Copy review prompt",
            hint: "an agent decides keep or delete",
            run: () => copyReviewPrompt([reviewOfLibrary(l)], "This skill is in my skilllib library (Your skills)."),
          },
          {
            label: "Version history…",
            run: () =>
              setOverlay({
                type: "menu",
                title: `${l.name} versions`,
                index: 0,
                build: () =>
                  [...versionHistory(l.name)].reverse().map((v) => ({ label: `v${v.version}`, hint: v.date.slice(0, 16).replace("T", " "), run: () => {} })),
              }),
          },
          {
            label: "Delete from library",
            hint: "moves to trash",
            run: () =>
              confirm(`Delete ${l.name} from the library? Restore it from Health.`, () => {
                const r = deleteLibrarySkill(l.name);
                return r.ok ? ok(`${l.name} moved to the trash`) : warn(`Can't delete ${l.name}: ${r.reason}`);
              }),
          },
        ],
        preview: {
          title: l.name,
          dir: librarySkillDir(l.name),
          meta: [
            `v${l.version ?? "?"}`,
            l.origin ? `from ${l.origin}` : "library",
            l.projects.length ? `in ${l.projects.map((p) => basename(p)).join(", ")}` : "in no projects",
            `${usesText(l.name)} Claude Code uses (${USAGE_DAYS}d)`,
          ],
        },
      };
    });
    return [
      {
        title: "",
        items: [newSkill, ...items],
        groupActions: (members) => [
          {
            label: `Copy review prompt for all ${members.length}`,
            hint: "an agent decides keep or delete",
            run: () =>
              copyReviewPrompt(
                snapshot.library.filter((l) => members.some((m) => m.skill?.name === l.name)).map(reviewOfLibrary),
                "These skills are in my skilllib library (Your skills).",
              ),
          },
        ],
      },
    ];
  }

  function globalSections(): Section[] {
    const yours = snapshot.machine.filter((m) => m.movable);
    const unreviewed = yours.filter((m) => !m.broken && !snapshot.keptGlobal.has(m.name));
    const keptCount = yours.filter((m) => !m.broken && snapshot.keptGlobal.has(m.name)).length;
    const importAll: Action = {
      label: "Copy all of yours to Your skills",
      run: () => {
        const pending = yours.filter((m) => !m.broken && !libraryNames.has(m.name));
        act(() => {
          for (const m of pending) importSkill(m.path);
          return ok(pending.length ? `Imported ${plural(pending.length, "skill")}` : "All of yours are already in the library");
        });
      },
    };
    const unloadAll: Action = {
      label: "Stop loading all of yours globally",
      hint: "add them per project instead",
      run: () => {
        const ready = yours.filter((m) => !m.broken && libraryNames.has(m.name));
        if (ready.length === 0) return say("Import them into the library first", false);
        confirm(`Stop loading ${plural(ready.length, "skill")} in every project? Restorable from Health.`, () =>
          ok(`${plural(ready.filter((m) => unloadGlobal(m.path, m.links).ok).length, "skill")} no longer load globally`),
        );
      },
    };
    const folder = (m: { path: string }) => dirname(m.path);
    const yourFolders = [...new Set(snapshot.machine.filter((m) => m.movable).map(folder))].sort();
    const groups: [string, (m: (typeof snapshot.machine)[number]) => boolean][] = [
      ...yourFolders.map((f): [string, (m: (typeof snapshot.machine)[number]) => boolean] => [`Yours · ${tildify(f)}`, (m) => m.movable && folder(m) === f]),
      ["claude.ai · synced to your account", (m) => m.kind === "claude.ai"],
      ["Claude Code plugins", (m) => m.kind === "plugin"],
      ["Cursor built-in", (m) => m.kind === "built-in"],
    ];
    const launcher: Item = {
      key: "__cleanup",
      search: "clean up",
      tags: [],
      row: {
        key: "__cleanup",
        cells: [
          { text: "⚠ ", color: color.yellow },
          { text: `Clean up: choose which repos keep each of your ${unreviewed.length} unreviewed global skills…`, grow: true, color: color.yellow },
        ],
      },
      primary: { label: "clean up", run: () => setWizard({}) },
      actions: [{ label: "Open the cleanup wizard", run: () => setWizard({}) }],
      preview: {
        title: "Clean up global skills",
        meta: ["every agent reads global skills in every repo", ...(keptCount ? [`skips the ${keptCount} you keep global on purpose (k shows them)`] : [])],
        description: "Install each skill only where it's needed, keep it global on purpose, or delete it. Originals are kept in backup.",
      },
    };
    const grouped = groups.map(([title, test]) => ({
      title,
      groupActions: (members: Item[]) => [
        {
              label: `Copy review prompt for all ${members.length}`,
              hint: "for an agent to decide keep / move / delete",
              run: () => copyReviewPrompt(snapshot.machine.filter((m) => members.some((x) => x.skill?.path === m.path)).map(reviewOfGlobal), `These are global skills (group ${members[0]?.group?.label ?? ""}).`),
            },
        ...(title.startsWith("Yours")
          ? [
              ...keepGroupActions(members),
              {
                label: `Delete all ${members.length}`,
                hint: "not kept in Your skills · restorable from Health",
                run: () => confirmDeleteGlobal(snapshot.machine.filter((m) => members.some((x) => x.skill?.path === m.path))),
              },
            ]
          : []),
      ],
      items: snapshot.machine
        .filter((m) => test(m))
        .map((m): Item => {
          const inLib = libraryNames.has(m.name);
          const importIt = () =>
            act(() => {
              const r = importSkill(m.path, { force: true });
              return ok(
                `${m.name} ${r.status === "unchanged" ? "is already in the library" : r.status === "added" ? "imported into the library" : "updated in the library"}`,
              );
            });
          const unload = () =>
            confirm(
              m.broken
                ? `Remove the broken link ${m.name}? Restorable from Health.`
                : `Stop loading ${m.name} in every project?${inLib ? "" : " It's imported into the library first."} Restorable from Health.`,
              () => {
                if (!m.broken && !inLib) importSkill(m.path);
                const r = unloadGlobal(m.path, m.links);
                return r.ok ? ok(`${m.name} no longer loads globally`) : warn(`${m.name}: ${r.reason}`);
              },
            );
          const actions: Action[] = [];
          let primary: Item["primary"];
          if (m.broken) {
            primary = { label: "remove link", run: unload };
            actions.push({ label: "Remove the broken link", run: unload });
          } else {
            if (!inLib) actions.push({ label: "Copy to Your skills", hint: "keeps loading globally", run: importIt });
            if (m.movable) actions.push(keepAction(m), { label: "Stop loading it globally", hint: "use it per project instead", run: unload });
            primary = m.movable ? { label: "choose repos…", run: () => setWizard({ initialSkill: m.name }) } : !inLib ? { label: "copy to your skills", run: importIt } : undefined;
            if (m.movable) {
              actions.unshift({ label: "Choose which repos keep it…", hint: "cleanup wizard", run: () => setWizard({ initialSkill: m.name }) });
              actions.push({ label: "Delete", hint: "not kept in Your skills · restorable from Health", run: () => confirmDeleteGlobal([m]) });
            }
            actions.push({ label: "Open folder", run: () => openFolder(m.path) });
            actions.push({ label: "Copy review prompt", hint: "an agent decides keep / move / delete", run: () => copyReviewPrompt([reviewOfGlobal(m)], "This is one global skill.") });
          }
          if (m.movable) actions.push(importAll, unloadAll);
          return {
            key: `${m.kind}:${m.path}`,
            search: `${m.name} ${m.origin}`,
            group: sourceGroup(m),
            skill: { name: m.name, path: m.path },
            tags: [m.movable ? "yours" : "vendor"],
            row: {
              key: `${m.kind}:${m.path}`,
              cells: [
                { text: m.name.padEnd(30).slice(0, 30), color: m.broken ? color.red : undefined },
                { text: m.broken ? "broken link" : m.origin, grow: true, color: m.broken ? color.red : kindColor[m.kind] },
                ...harnessChips(enabledIds.map((id) => ({ id, paths: m.harnesses.includes(id) ? 1 : 0 })), !m.broken),
                { text: m.movable && snapshot.keptGlobal.has(m.name) ? " ✓ kept" : "       ", color: color.green },
                { text: inLib ? " ✓ library" : "          ", color: color.green },
                { text: usesText(m.name).padStart(5), color: color.muted },
              ],
            },
            primary,
            actions,
            preview: {
              title: m.name,
              dir: m.broken ? undefined : m.path,
              meta: [
                m.harnesses.length ? `loaded everywhere by ${m.harnesses.map(harnessName).join(", ")}` : "not loaded by your harnesses",
                `${m.kind}: ${m.origin}`,
                m.movable ? (snapshot.keptGlobal.has(m.name) ? "yours · kept global on purpose" : "yours to manage") : "managed by the vendor",
                tildify(m.path) + (m.links.length ? ` (+ ${m.links.length} link${m.links.length > 1 ? "s" : ""})` : ""),
              ],
              description: m.broken ? "Broken link: it points at a folder that no longer exists, so it loads nothing." : undefined,
            },
          };
        }),
    }));
    const reviewAll: Item = {
      key: "__review-all",
      search: "review agent prompt",
      tags: [],
      row: {
        key: "__review-all",
        cells: [
          { text: "✦ ", color: color.accent },
          { text: `Ask an agent to review all ${snapshot.machine.filter((m) => !m.broken).length} global skills (copies a prompt)`, grow: true, color: color.accent },
        ],
      },
      primary: {
        label: "copy prompt",
        run: () => copyReviewPrompt(snapshot.machine.filter((m) => !m.broken).map(reviewOfGlobal), "These are ALL the skills that load globally on my machine."),
      },
      actions: [
        {
          label: "Copy review prompt — all global skills",
          run: () => copyReviewPrompt(snapshot.machine.filter((m) => !m.broken).map(reviewOfGlobal), "These are ALL the skills that load globally on my machine."),
        },
        {
          label: "Copy review prompt — only mine (not vendor)",
          run: () => copyReviewPrompt(yours.filter((m) => !m.broken).map(reviewOfGlobal), "These are my own global skills (vendor skills excluded)."),
        },
      ],
      preview: {
        title: "Ask an agent to review your skills",
        meta: ["copies a prompt to your clipboard", "also saved to ~/.skilllib/review-prompt.md"],
        description:
          "The prompt includes each skill's description, a SKILL.md excerpt, how it was installed (vendor, skills.sh, plugin…), which agents load it, usage per project, duplicates and your project list. Paste it into Claude Code, Cursor or Codex; it replies with keep / move / delete per skill.",
      },
    };
    return [{ title: "", items: [...(unreviewed.length ? [launcher] : []), reviewAll] }, ...grouped];
  }

  /** Marks your global skills as global on purpose, or unmarks them. Only the decision is saved; no files change. */
  function markKept(names: string[], keep: boolean) {
    act(() => {
      setKeepGlobal(names, keep);
      const label = names.length === 1 ? names[0]! : plural(names.length, "skill");
      return ok(keep ? `${label} kept global on purpose — cleanup skips ${names.length === 1 ? "it" : "them"}` : `${label} back in cleanup`);
    });
  }

  function keepAction(m: { name: string }): Action {
    return snapshot.keptGlobal.has(m.name)
      ? { label: "Unmark: not global on purpose", hint: "cleanup asks about it again", run: () => markKept([m.name], false) }
      : { label: "✓ Keep global on purpose", hint: "stops the ⚠ and skips it in cleanup", run: () => markKept([m.name], true) };
  }

  /** Keep / unmark actions for a group of your global skills. */
  function keepGroupActions(members: Item[]): Action[] {
    const names = [...new Set(members.flatMap((m) => (m.skill ? [m.skill.name] : [])))];
    const unkept = names.filter((n) => !snapshot.keptGlobal.has(n));
    const kept = names.filter((n) => snapshot.keptGlobal.has(n));
    return [
      ...(unkept.length ? [{ label: `✓ Keep all ${unkept.length} global on purpose`, hint: "cleanup skips them", run: () => markKept(unkept, true) }] : []),
      ...(kept.length ? [{ label: `Unmark all ${kept.length}`, hint: "cleanup asks about them again", run: () => markKept(kept, false) }] : []),
    ];
  }

  /** Group actions for your global skills in a repo. */
  function yourGlobalActions(members: Item[]): Action[] {
    return [
      {
        label: `Copy review prompt for all ${members.length}`,
        hint: "for an agent to decide keep / move / delete",
        run: () => copyReviewPrompt(snapshot.machine.filter((m) => members.some((x) => x.skill?.path === m.path)).map(reviewOfGlobal), `These are global skills (group ${members[0]?.group?.label ?? ""}).`),
      },
      {
        label: `Copy all ${members.length} to Your skills`,
        hint: "they keep loading globally",
        run: () =>
          act(() => {
            const added = members.map((m) => importSkill(m.skill!.path)).filter((r) => r.status === "added").length;
            return ok(`${plural(added, "skill")} imported into your library`);
          }),
      },
      {
        label: `Delete all ${members.length}`,
        hint: "not kept in Your skills · restorable from Health",
        run: () => confirmDeleteGlobal(snapshot.machine.filter((m) => members.some((x) => x.skill?.path === m.path))),
      },
    ];
  }

  /** Delete one or more of your global skills (moved to backup, restorable from Health). */
  function confirmDeleteGlobal(skills: { name: string; path: string; links: string[] }[]) {
    if (skills.length === 0) return;
    const label = skills.length === 1 ? skills[0]!.name : plural(skills.length, "global skill");
    confirm(`Delete ${label}? It stops loading everywhere and is NOT kept in Your skills. A backup stays restorable from Health.`, () => {
      const done = skills.filter((m) => deleteGlobal(m.path, m.links).ok).length;
      return ok(`Deleted ${plural(done, "global skill")} (restorable from Health)`);
    });
  }

  // ─── Agent review prompts ───────────────────────────

  function usageFor(name: string) {
    const total = usage ? (usage.total.get(name) ?? 0) : null;
    const byProject: [string, number][] = usage
      ? snapshot.projects.flatMap((p): [string, number][] => {
          const n = usage.byProject.get(p)?.get(name) ?? 0;
          return n ? [[basename(p), n]] : [];
        })
      : [];
    return { total, byProject };
  }

  function projectsWith(name: string): string[] {
    return snapshot.projects.filter((p) => (snapshot.rows.get(p) ?? []).some((r) => r.installed && r.name === name)).map((p) => basename(p));
  }

  function reviewOfGlobal(m: (typeof snapshot.machine)[number]): ReviewSkill {
    const u = usageFor(m.name);
    const lib = snapshot.library.find((l) => l.name === m.name);
    const how: Record<string, string> = {
      global: `copied into ${tildify(dirname(m.path))} by hand or by a tool (no record of where from)`,
      "skills.sh": m.origin.includes("/") ? `\`npx skills add ${m.origin}\` (skills.sh)` : "the `npx skills` CLI (not in its lock file)",
      plugin: m.origin.includes("(claude.ai)") ? `a Claude Code plugin synced from my claude.ai account (${m.origin})` : `the Claude Code plugin ${m.origin} (/plugin install)`,
      "claude.ai": "synced from my claude.ai account (Settings → Capabilities)",
      "built-in": "ships with Cursor",
    };
    const vendor: Record<string, string> = {
      plugin: `turn it off with /plugin in Claude Code (disable ${m.origin.replace(" (claude.ai)", "")}), or in claude.ai if it's synced`,
      "claude.ai": "remove it from my claude.ai account's skills",
      "built-in": "bundled with Cursor; it can't be removed",
    };
    return {
      name: m.name,
      description: m.description,
      source: m.movable ? `my global skills (${m.kind === "skills.sh" ? "skills.sh package" : "global folder"})` : `vendor: ${m.kind} (${m.origin})`,
      installedHow: how[m.kind] ?? m.origin,
      path: m.path,
      links: m.links,
      loadedBy: `${m.harnesses.map(harnessName).join(", ") || "none of my agents"} — in every repo`,
      vendor: m.movable ? null : (vendor[m.kind] ?? "managed by its vendor"),
      usesTotal: u.total,
      usesByProject: u.byProject,
      installedIn: projectsWith(m.name),
      otherCopies: snapshot.machine.filter((x) => x.name === m.name && x.path !== m.path).map((x) => `${x.kind} ${x.origin} (${tildify(x.path)})`),
      inYourSkills: lib ? `yes, v${lib.version}` : null,
      keptGlobal: m.movable && snapshot.keptGlobal.has(m.name),
    };
  }

  function reviewOfLibrary(l: (typeof snapshot.library)[number]): ReviewSkill {
    const u = usageFor(l.name);
    return {
      name: l.name,
      description: l.description,
      source: "Your skills (skilllib library) — loads nowhere by itself",
      installedHow: l.origin ? `imported into skilllib from ${l.origin}` : "created or imported into skilllib",
      path: librarySkillDir(l.name),
      links: [],
      loadedBy: l.projects.length ? `projects that added it: ${l.projects.map((p) => basename(p)).join(", ")}` : "nowhere (no project has added it)",
      vendor: null,
      usesTotal: u.total,
      usesByProject: u.byProject,
      installedIn: l.projects.map((p) => basename(p)),
      otherCopies: snapshot.machine.filter((x) => x.name === l.name && !x.broken).map((x) => `global ${x.kind} (${tildify(x.path)})`),
      inYourSkills: `yes, v${l.version}`,
    };
  }

  /** Builds the prompt, copies it, and reports where it went. */
  function copyReviewPrompt(skills: ReviewSkill[], scope: string) {
    if (skills.length === 0) return say("Nothing to review", false);
    const prompt = buildReviewPrompt(skills, {
      scope,
      usageDays: USAGE_DAYS,
      harnesses: snapshot.harnesses.map(harnessName),
      projects: snapshot.projects.map((p) => ({ name: basename(p), path: p })),
    });
    const r = copyText(prompt);
    say(
      r.copied
        ? `Copied a review prompt for ${plural(skills.length, "skill")} (${Math.round(prompt.length / 1000)}k chars) — paste it into Claude Code, Cursor or Codex`
        : `Couldn't reach the clipboard; the prompt is in ${tildify(r.savedTo)}`,
      r.copied,
    );
  }

  function settingsSections(): Section[] {
    const harnessItems = HARNESSES.map((h): Item => {
      const on = snapshot.harnesses.includes(h.id);
      const toggle = () =>
        act(() => {
          const next = on ? snapshot.harnesses.filter((id) => id !== h.id) : [...snapshot.harnesses, h.id];
          setHarnesses(next);
          return ok(
            `${h.name} ${on ? "off" : "on"}. New installs go to ${installDirs(next).join(" + ")}; use "Make visible" on existing skills to add links.`,
          );
        });
      return {
        key: `harness:${h.id}`,
        search: h.name,
        tags: [],
        row: {
          key: `harness:${h.id}`,
          cells: [
            { text: on ? "◉ " : "○ ", color: on ? color.green : color.faint },
            { text: `${h.icon} `, color: on ? h.color : color.faint },
            { text: h.name, grow: true, bold: on },
            { text: `reads ${h.projectDirs.map((d) => d.replace("/skills", "")).join(" ")}`, color: color.faint },
            { text: h.installed() ? "  detected" : "          ", color: color.muted },
          ],
        },
        primary: { label: on ? "turn off" : "turn on", run: toggle },
        actions: [{ label: on ? `Stop using ${h.name}` : `Use ${h.name}`, run: toggle }],
        preview: {
          title: h.name,
          meta: [`project: ${h.projectDirs.join(", ")}`, `global: ${h.globalDirs().map(tildify).join(", ")}`],
          description: `skilllib installs library skills where every harness you use can see them. With your current choice: ${installDirs(snapshot.harnesses).join(" (real copy) + ")}${installDirs(snapshot.harnesses).length > 1 ? " (link)" : ""}.`,
        },
      };
    });
    const folderItems = snapshot.roots.map((root): Item => {
      const remove = () =>
        confirm(`Stop scanning ${tildify(root)}? Projects already found stay listed until you hide them.`, () => {
          removeRoot(root);
          return ok(`${tildify(root)} removed from your project folders`);
        });
      return {
        key: `root:${root}`,
        search: root,
        tags: [],
        row: { key: `root:${root}`, cells: [{ text: "▸ ", color: color.accent }, { text: tildify(root), grow: true }] },
        primary: { label: "remove folder", run: remove },
        actions: [
          { label: "Rescan now", run: () => rescan(() => say("Rescanned your project folders")) },
          { label: "Remove this folder", run: remove },
        ],
        preview: { title: tildify(root), meta: ["scanned for git repos every time skilllib opens"] },
      };
    });
    const addFolder: Item = {
      key: "__add-folder",
      search: "add folder",
      tags: [],
      row: { key: "__add-folder", cells: [{ text: "+ ", color: color.accent }, { text: "Add a folder…", grow: true, color: color.accent }] },
      primary: { label: "add", run: () => promptAddFolder() },
      actions: [{ label: "Add a folder", run: () => promptAddFolder() }],
      preview: { title: "Add a folder", meta: ["skilllib scans it for git repos now and every time it opens"] },
    };
    const rescanItem: Item = {
      key: "__rescan",
      search: "rescan",
      tags: [],
      row: { key: "__rescan", cells: [{ text: "⟳ ", color: color.accent }, { text: scanning ? "Scanning…" : "Rescan now", grow: true, color: color.accent }] },
      primary: { label: "rescan", run: () => rescan(() => say("Rescanned your project folders")) },
      actions: [{ label: "Rescan now", run: () => rescan(() => say("Rescanned your project folders")) }],
      preview: { title: "Rescan", meta: [`${plural(snapshot.projects.length, "project")} found`] },
    };
    return [
      { title: "Harnesses you use · space toggles", items: harnessItems },
      { title: "Project folders", items: [...folderItems, addFolder, rescanItem] },
    ];
  }

  function healthSections(): Section[] {
    return [
      {
        title: "Issues",
        items: snapshot.issues.map((issue): Item => {
          const fix = issue.fix;
          const run = fix ? () => confirm(`${fix.label}?`, () => ok(fix.run())) : undefined;
          return {
            key: issue.id,
            search: issue.title,
            tags: [],
            row: {
              key: issue.id,
              cells: [
                { text: issue.severity === "problem" ? "● " : "◆ ", color: issue.severity === "problem" ? color.red : color.yellow },
                { text: issue.title, grow: true },
                { text: run ? "  space: fix" : "", color: color.accent },
              ],
            },
            primary: run ? { label: "fix", run } : undefined,
            actions: run && fix ? [{ label: fix.label, run }] : [],
            preview: {
              title: issue.title,
              meta: [issue.severity, fix ? `fix: ${fix.label.toLowerCase()}` : "no automatic fix"],
              description: issue.detail,
            },
          };
        }),
      },
      {
        title: "Moved out · restorable",
        items: snapshot.backups.map((b): Item => {
          const restore = () =>
            act(() => {
              const r = restoreBackup(b);
              return r.ok ? ok(`${b.name} restored to ${tildify(r.to)}`) : warn(`Can't restore ${b.name}: ${r.reason}`);
            });
          return {
            key: b.path,
            search: b.name,
            tags: [],
            row: {
              key: b.path,
              cells: [
                { text: b.name, grow: true },
                { text: b.kind === "trash" ? " deleted from library" : " unloaded from global", color: color.muted },
                { text: `   ${b.movedAt}`, color: color.faint },
              ],
            },
            primary: { label: "restore", run: restore },
            actions: [{ label: "Restore", run: restore }],
            preview: {
              title: b.name,
              dir: b.path,
              meta: [b.kind === "trash" ? "deleted from the library" : "removed from ~/.claude/skills", `moved ${b.movedAt}`],
            },
          };
        }),
      },
    ];
  }

  const projectTabs = place.kind === "project" ? projectSections(place.root) : null;
  const sections: Section[] =
    projectTabs
      ? projectTabs[projectTab]
      : place.kind === "library"
        ? librarySections()
        : place.kind === "global"
          ? globalSections()
          : place.kind === "health"
            ? healthSections()
            : place.kind === "help"
              ? []
              : settingsSections();

  const filtered = sections;
  // While searching, rank matches across sections (prefix, then substring, then fuzzy) in one list.
  const visibleSections: Section[] = search.right
    ? [
        {
          title: "",
          items: filtered
            .flatMap((s) => s.items)
            .map((i, order) => ({ i, order, score: matchScore(i.search.split(" ")[0] ?? i.search, search.right) ?? matchScore(i.search, search.right) }))
            .filter((x) => x.score !== null)
            .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.order - b.order)
            .map((x) => x.i),
        },
      ].filter((s) => s.items.length > 0)
    : filtered
        .map((sec) =>
          groupSection(sec, expanded, toggleGroup, (names) => {
            if (!usage) return "…";
            const n = names.reduce((sum, name) => sum + (usesOf(name, projectTabs ? pKey.slice("project:".length) : undefined) ?? 0), 0);
            return n ? String(n) : "–";
          }),
        )
        .filter((s) => s.items.length > 0);
  const rightItems = visibleSections.flatMap((s) => s.items);
  const rightRows: Row[] = visibleSections.flatMap((s) => [
    ...(s.title ? [{ key: `h:${s.title}`, header: true, cells: [{ text: s.title }] } as Row] : []),
    ...s.items.map((i) => i.row),
  ]);
  const rightSelKey = `right:${pKey}${projectTabs ? `:${projectTab}` : ""}`;
  const rightKey = rightItems.some((i) => i.key === selected[rightSelKey]) ? selected[rightSelKey]! : (rightItems[0]?.key ?? "");
  const current = rightItems.find((i) => i.key === rightKey);

  // ─── Actions on places ────────────────────────────

  function promptAddFolder() {
    setOverlay({
      type: "prompt",
      label: "Folder that contains your projects",
      value: "~/Projects",
      onSubmit: (value) => {
        const root = addRoot(value);
        rescan(() => say(`Added ${tildify(root)}. It's rescanned every time skilllib opens.`));
      },
    });
  }

  function promptNewSkill() {
    setOverlay({
      type: "prompt",
      label: "New skill name (lowercase-with-dashes)",
      value: "",
      onSubmit: (value) => {
        const r = createSkill(value.trim(), "");
        if (!r.ok) return say(`Can't create ${value}: ${r.reason}`, false);
        setSelected((s) => ({ ...s, "right:library": value.trim() }));
        reload();
        void edit(join(r.dir, "SKILL.md"));
      },
    });
  }

  function enterPlace() {
    if (place.kind === "help") return setOverlay({ type: "help", topic: 1, scroll: 0 });
    setSelected((s) => ({ ...s, left: leftKey }));
    setFocus("right");
  }

  function openMenu(item: Item) {
    if (item.actions.length === 0) return say("Nothing to do here", false);
    setOverlay({ type: "menu", title: item.preview?.title ?? item.key, index: 0, build: () => item.actions });
  }

  // ─── Keys ─────────────────────────────────────────

  function move(delta: number, absolute?: "start" | "end") {
    const keys = focus === "left" ? leftVisible.map((e) => e.key) : rightItems.map((i) => i.key);
    const currentKey = focus === "left" ? leftKey : rightKey;
    const i = keys.indexOf(currentKey);
    const next = absolute === "start" ? 0 : absolute === "end" ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, i + delta));
    const nextKey = keys[next] ?? "";
    if (focus === "left") {
      setSelected((s) => ({ ...s, left: nextKey }));
      setSearch((s) => ({ ...s, right: "" }));
    } else {
      setSelected((s) => ({ ...s, [rightSelKey]: nextKey }));
    }
  }

  useInput((input: string, key: Key) => {
    if (wizard) return wizardInput.current?.(input, key);
    if (key.ctrl && input === "c") return exit();

    if (setup?.step === "harnesses") {
      if (key.upArrow) return setSetup({ ...setup, index: Math.max(0, setup.index - 1) });
      if (key.downArrow) return setSetup({ ...setup, index: Math.min(HARNESSES.length - 1, setup.index + 1) });
      if (input === " ") {
        const id = HARNESSES[setup.index]!.id;
        const selected = setup.selected.includes(id) ? setup.selected.filter((x) => x !== id) : [...setup.selected, id];
        return setSetup({ ...setup, selected });
      }
      if (key.return || key.escape) {
        setHarnesses(setup.selected);
        if (snapshot.roots.length === 0) return setSetup({ ...setup, step: "folder" });
        setSetup(null);
        reload();
        return say(`Using ${setup.selected.map(harnessName).join(", ") || "no harnesses"}. Change it anytime in Settings.`);
      }
      return;
    }
    if (setup?.step === "folder") {
      if (key.escape) {
        setSetup(null);
        return reload();
      }
      if (key.return) {
        const root = addRoot(setup.value);
        setSetup(null);
        return rescan(() => say(`Found your projects in ${tildify(root)}. Type a name to find one, enter to open it.`));
      }
      if (key.backspace || key.delete) return setSetup({ ...setup, value: setup.value.slice(0, -1) });
      if (key.ctrl && input === "u") return setSetup({ ...setup, value: "" });
      if (input && !key.ctrl && !key.meta) return setSetup({ ...setup, value: setup.value + input });
      return;
    }

    if (overlay?.type === "confirm") {
      if (input === "y" || key.return) {
        const run = overlay.onYes;
        setOverlay(null);
        act(run);
      } else if (input === "n" || key.escape) {
        setOverlay(null);
        say("Cancelled", false);
      }
      return;
    }
    if (overlay?.type === "prompt") {
      if (key.escape) {
        setOverlay(null);
      } else if (key.return) {
        const { value, onSubmit } = overlay;
        setOverlay(null);
        onSubmit(value);
      } else if (key.backspace || key.delete) setOverlay({ ...overlay, value: overlay.value.slice(0, -1) });
      else if (key.ctrl && input === "u") setOverlay({ ...overlay, value: "" });
      else if (input && !key.ctrl && !key.meta && !key.tab) setOverlay({ ...overlay, value: overlay.value + input });
      return;
    }
    if (overlay?.type === "menu") {
      const options = overlay.build();
      if (key.escape || key.leftArrow) return setOverlay(null);
      if (key.upArrow) return setOverlay({ ...overlay, index: Math.max(0, overlay.index - 1) });
      if (key.downArrow) return setOverlay({ ...overlay, index: Math.min(options.length - 1, overlay.index + 1) });
      if (key.return || input === " ") {
        const option = options[overlay.index];
        if (!option) return setOverlay(null);
        if (!option.keepOpen) setOverlay(null);
        option.run();
      }
      return;
    }
    if (overlay?.type === "help") {
      const last = HELP_TOPICS.length - 1;
      if (key.upArrow) return setOverlay({ ...overlay, topic: Math.max(0, overlay.topic - 1), scroll: 0 });
      if (key.downArrow || key.tab) return setOverlay({ ...overlay, topic: Math.min(last, overlay.topic + 1), scroll: 0 });
      if (key.pageDown || input === " ") return setOverlay({ ...overlay, scroll: overlay.scroll + 5 });
      if (key.pageUp) return setOverlay({ ...overlay, scroll: Math.max(0, overlay.scroll - 5) });
      if (key.escape || input === "?" || input === "q" || key.return) return setOverlay(null);
      return;
    }

    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (key.pageUp) return move(-(termRows - 14));
    if (key.pageDown) return move(termRows - 14);
    if (key.home) return move(0, "start");
    if (key.end) return move(0, "end");
    if (key.ctrl && input === "r") {
      reload();
      return say("Reloaded");
    }

    const pane = focus;
    if (key.escape) {
      setToast(null);
      if (search[pane]) return setSearch((s) => ({ ...s, [pane]: "" }));
      if (pane === "right") return setFocus("left");
      return say("Press ctrl+c to quit", false);
    }
    if (key.backspace || key.delete) return setSearch((s) => ({ ...s, [pane]: s[pane].slice(0, -1) }));
    if (key.tab) {
      if (pane === "left") return enterPlace();
      if (!projectTabs) return;
      const i = PROJECT_TABS.findIndex((t) => t.id === projectTab);
      return setProjectTab(PROJECT_TABS[(i + (key.shift ? PROJECT_TABS.length - 1 : 1)) % PROJECT_TABS.length]!.id);
    }
    // Arrows open and close groups; ← on anything else goes back to the left pane.
    const onGroup = pane === "right" && current?.key.startsWith("grp:");
    if (key.rightArrow) {
      if (pane === "left") return enterPlace();
      if (onGroup && !expanded.has(current!.key)) toggleGroup(current!.key);
      return;
    }
    if (key.leftArrow) {
      if (onGroup && expanded.has(current!.key)) return toggleGroup(current!.key);
      return setFocus("left");
    }

    if (key.return) {
      setToast(null);
      if (pane === "left") return enterPlace();
      if (current) setSelected((s) => ({ ...s, [rightSelKey]: current.key }));
      if (current) openMenu(current);
      return;
    }
    if (input === " ") {
      setToast(null);
      if (pane === "left") return enterPlace();
      // Keep the cursor on this skill even if the action moves it to another section.
      if (current) setSelected((s) => ({ ...s, [rightSelKey]: current.key }));
      if (current?.primary) current.primary.run();
      else if (current) openMenu(current);
      return;
    }
    if (input === "?" && !search[pane]) return setOverlay({ type: "help", topic: 0, scroll: 0 });

    // Anything else printable searches the pane you're in.
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= "!") {
      setToast(null);
      setSearch((s) => (pane === "left" ? { left: s.left + input, right: "" } : { ...s, right: s.right + input }));
    }
  });

  // ─── Layout ───────────────────────────────────────

  const previewHeight = termRows >= 30 ? 9 : termRows >= 22 ? 7 : 0;
  const bodyHeight = Math.max(6, termRows - 4 - previewHeight);
  const leftWidth = Math.max(28, Math.min(40, Math.floor(columns * 0.3)));
  const rightWidth = columns - leftWidth;

  const placeTitle =
    place.kind === "project"
      ? basename(place.root)
      : place.kind === "library"
        ? "Your skills · not loaded until you add them to a repo"
        : place.kind === "global"
          ? "Global · loaded in every project"
          : place.kind === "health"
            ? "Health"
            : place.kind === "help"
              ? "Help"
              : "Settings";
  const leftIndex = leftRows.findIndex((r) => r.key === leftKey);
  const rightIndex = rightRows.findIndex((r) => r.key === rightKey);

  const leftPreview: PreviewSpec = (() => {
    if (place.kind === "project") {
      const rows = snapshot.rows.get(place.root) ?? [];
      const installed = rows.filter((r) => r.installed);
      return {
        title: basename(place.root),
        meta: [
          tildify(place.root),
          `${plural(installed.length, "skill")} installed`,
          `+ ${plural(snapshot.machine.filter((m) => !m.broken).length, "global skill")}`,
        ],
        description: installed.length
          ? installed.map((r) => `${stateBadge(r.state).icon} ${r.name}`).join("   ")
          : "No skills yet. Press enter, then space on a library skill to add it.",
      };
    }
    const about: Record<string, [string, string]> = {
      library: [
        "Library",
        "Your shelf of skills. Nothing here loads anywhere until you add it to a project. Every change becomes a new version projects can update to.",
      ],
      global: [
        "Global",
        "Skills your harnesses load in EVERY project (~/.claude/skills, ~/.agents/skills, plugins…). Move yours into the library and add them only where needed.",
      ],
      help: ["Help", "Where skills come from, and how Claude Code, Cursor, Codex and Zed find and use them. Press enter (or ? anywhere)."],
      health: ["Health", "Broken links, skills loaded twice, out-of-date projects, repo-only skills — and everything skilllib moved out, ready to restore."],
      settings: ["Settings", `Harnesses: ${snapshot.harnesses.map(harnessName).join(", ") || "none"} · Folders: ${snapshot.roots.map(tildify).join(", ") || "none yet"}`],
    };
    const [title, description] = about[place.kind] ?? ["", ""];
    return { title, meta: [], description };
  })();
  const preview = focus === "right" && current ? current.preview : leftPreview;

  const hints: Hint[] =
    focus === "left"
      ? [
          ["type", "search"],
          ["↑↓", "move"],
          ["enter", "open"],
          ["ctrl+c", "quit"],
        ]
      : [
          ["type", "search"],
          ...(current?.primary ? [["space", current.primary.label] as Hint] : []),
          ["enter", "actions"],
          ...(projectTabs ? [["tab", "next list"] as Hint] : []),
          ["esc", "back"],
        ];

  // ─── Render ───────────────────────────────────────

  const header = (
    <Box height={1} width={columns}>
      <Text color={color.accent} bold>
        {" ◆ skilllib "}
      </Text>
      <Text color={color.faint}>{"  "}</Text>
      <Text color={color.muted}>{place.kind === "project" ? "Projects › " : ""}</Text>
      <Text color={color.text} bold>
        {placeTitle}
      </Text>
      <Box flexGrow={1} />
      <Text color={color.faint}>{scanning ? "scanning…  " : usage ? "" : "reading usage…  "}</Text>
      {columns >= 110 ? <HarnessLegend ids={enabledIds} /> : null}
      {problems > 0 ? <Text color={color.red}>{`● ${plural(problems, "problem")} `}</Text> : <Text color={color.green}>{"✓ healthy "}</Text>}
    </Box>
  );

  const renderPreview = () => {
    if (previewHeight === 0) return null;
    if (overlay?.type === "menu") {
      const options = overlay.build();
      const lines = previewHeight - 2;
      const offset = Math.max(0, Math.min(overlay.index - Math.floor(lines / 2), options.length - lines));
      return (
        <Panel title={overlay.title} hint="↑↓ · enter · esc" focused width={columns} height={previewHeight}>
          {options.slice(offset, offset + lines).map((o, i) => {
            const active = offset + i === overlay.index;
            return (
              <Box key={o.label + i} height={1}>
                <Text backgroundColor={active ? color.selection : undefined} color={active ? color.accent : color.faint}>
                  {active ? "▌ " : "  "}
                </Text>
                <Text backgroundColor={active ? color.selection : undefined} color={active ? color.text : color.muted} bold={active}>
                  {o.label}
                </Text>
                {o.hint ? <Text color={color.faint}>{`   ${o.hint}`}</Text> : null}
              </Box>
            );
          })}
        </Panel>
      );
    }
    const inner = columns - 6;
    const lines = previewHeight - 3;
    if (!preview) {
      return (
        <Panel title="Details" focused={false} width={columns} height={previewHeight}>
          <Text color={color.faint}>Nothing selected</Text>
        </Panel>
      );
    }
    const info = preview.dir ? readPreview(preview.dir) : null;
    const description = preview.description ?? info?.description ?? "";
    const room = lines + (preview.meta.length ? 0 : 1);
    const descLines = description ? wrap(description, inner, Math.min(2, room)) : [];
    const bodyLines = (info?.body ?? []).filter((l) => !l.startsWith("# ")).slice(0, Math.max(0, room - descLines.length));
    return (
      <Panel title={preview.title} hint={info ? plural(info.files, "file") : undefined} focused={false} width={columns} height={previewHeight}>
        {preview.meta.length > 0 ? (
          <Text color={color.muted} wrap="truncate-end">
            {preview.meta.join("  ·  ")}
          </Text>
        ) : null}
        {descLines.map((l, i) => (
          <Text key={`d${i}`} color={color.text} wrap="truncate-end">
            {l}
          </Text>
        ))}
        {bodyLines.map((l, i) => (
          <Text key={`b${i}`} color={color.faint} wrap="truncate-end">
            {l}
          </Text>
        ))}
      </Panel>
    );
  };

  const statusLine = (() => {
    if (overlay?.type === "confirm") {
      return (
        <Text wrap="truncate-end">
          <Text color={color.yellow} bold>
            {"? "}
          </Text>
          <Text color={color.text}>{overlay.message}</Text>
          <Text color={color.muted}>{"   y / n"}</Text>
        </Text>
      );
    }
    if (overlay?.type === "prompt") {
      return (
        <Text wrap="truncate-end">
          <Text color={color.accent} bold>
            {"› "}
          </Text>
          <Text color={color.muted}>{`${overlay.label}: `}</Text>
          <Text color={color.text}>{overlay.value}</Text>
          <Text color={color.accent}>{"█"}</Text>
          <Text color={color.faint}>{"   enter ok · esc cancel"}</Text>
        </Text>
      );
    }
    if (toast) {
      return (
        <Text wrap="truncate-end" color={toast.ok ? color.green : color.yellow}>
          {`${toast.ok ? "✓" : "!"} ${toast.text}`}
        </Text>
      );
    }
    return <Text> </Text>;
  })();

  if (wizard) {
    const yours = snapshot.machine.filter((m) => m.movable && !m.broken);
    return (
      <Box flexDirection="column" width={columns} height={termRows}>
        {header}
        <CleanupWizard
          skills={yours}
          kept={snapshot.keptGlobal}
          projects={snapshot.projects}
          usesIn={(skill, project) => (usage ? (usage.byProject.get(project)?.get(skill) ?? 0) : null)}
          usesTotal={(skill) => (usage ? (usage.total.get(skill) ?? 0) : null)}
          onReviewPrompt={(skills) => {
            const prompt = buildReviewPrompt(skills.map(reviewOfGlobal), {
              scope: "These are my global skills; I'm deciding which to move into specific projects, keep global, or delete.",
              usageDays: USAGE_DAYS,
              harnesses: snapshot.harnesses.map(harnessName),
              projects: snapshot.projects.map((p) => ({ name: basename(p), path: p })),
            });
            const r = copyText(prompt);
            return r.copied
              ? `Copied a review prompt for ${plural(skills.length, "skill")} — paste it into your agent, then set each skill here`
              : `Saved the prompt to ${tildify(r.savedTo)} (clipboard unavailable)`;
          }}
          usageDays={USAGE_DAYS}
          installedIn={(skill) => snapshot.library.find((l) => l.name === skill)?.projects ?? []}
          initialSkill={wizard.initialSkill}
          inputRef={wizardInput}
          width={columns}
          height={termRows - 2}
          onCancel={() => {
            setWizard(null);
            say("Cleanup cancelled — nothing changed", false);
          }}
          onDone={(r) => {
            setWizard(null);
            reload();
            setToast({
              ok: r.problems.length === 0,
              text: [
                r.unloaded || r.installs ? `${plural(r.unloaded, "skill")} moved into projects (${plural(r.installs, "install")})` : "",
                r.deleted ? `${r.deleted} deleted` : "",
                r.kept ? `${plural(r.kept, "skill")} kept global on purpose` : "",
                r.problems.length ? `${r.problems.length} left global: ${r.problems[0]}` : "",
              ]
                .filter(Boolean)
                .join(" · "),
            });
          }}
        />
      </Box>
    );
  }

  if (setup) {
    const box = Math.min(84, columns - 4);
    return (
      <Box flexDirection="column" width={columns} height={termRows} alignItems="center" justifyContent="center">
        <Box flexDirection="column" borderStyle="round" borderColor={color.accent} paddingX={3} paddingY={1} width={box}>
          <Text color={color.accent} bold>
            ◆ Welcome to skilllib
          </Text>
          <Text> </Text>
          <Text color={color.text}>Manage agent skills like dependencies: one versioned library, and each project picks what it needs.</Text>
          <Text> </Text>
          {setup.step === "harnesses" ? (
            <>
              <Text color={color.text} bold>
                1 · Which coding agents do you use?
              </Text>
              <Text color={color.faint}>skilllib installs skills where each of them looks.</Text>
              <Text> </Text>
              {HARNESSES.map((h, i) => {
                const on = setup.selected.includes(h.id);
                const active = i === setup.index;
                return (
                  <Box key={h.id} height={1}>
                    <Text color={active ? color.accent : color.faint}>{active ? "▌ " : "  "}</Text>
                    <Text color={on ? color.green : color.faint}>{on ? "◉ " : "○ "}</Text>
                    <Text color={h.color}>{`${h.icon} `}</Text>
                    <Text color={active ? color.text : color.muted} bold={active}>
                      {h.name.padEnd(13)}
                    </Text>
                    <Text color={color.faint} wrap="truncate-end">
                      {`${h.installed() ? "detected · " : ""}reads ${h.projectDirs.map((d) => d.replace("/skills", "")).join(" ")}`}
                    </Text>
                  </Box>
                );
              })}
              <Text> </Text>
              <Text color={color.faint}>↑↓ move · space toggle · enter continue</Text>
            </>
          ) : (
            <>
              <Text color={color.text} bold>
                2 · Where do your projects live?
              </Text>
              <Text color={color.faint}>skilllib finds every git repo inside and rescans it each time it opens.</Text>
              <Box borderStyle="round" borderColor={color.accentDim} paddingX={1}>
                <Text color={color.text}>{setup.value}</Text>
                <Text color={color.accent}>█</Text>
              </Box>
              <Text color={color.faint}>enter to scan · esc to skip · change both later in Settings</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  if (overlay?.type === "help") {
    const topicWidth = 30;
    const contentWidth = columns - topicWidth - 4;
    const topic = HELP_TOPICS[overlay.topic]!;
    // Wrap every block into display lines, then scroll.
    const lines: { text: string; kind: "heading" | "body" | "gap" }[] = [];
    for (const block of topic.blocks) {
      if (lines.length) lines.push({ text: "", kind: "gap" });
      if (block.heading) lines.push({ text: block.heading, kind: "heading" });
      for (const line of block.lines) {
        for (const w of wrapAligned(line, contentWidth - 2)) lines.push({ text: w, kind: "body" });
      }
    }
    const room = termRows - 5;
    const scroll = Math.min(overlay.scroll, Math.max(0, lines.length - room));
    const topicRows: Row[] = HELP_TOPICS.map((t) => {
      const h = HARNESSES.find((x) => x.id === t.id);
      return {
        key: t.id,
        cells: [
          { text: `${t.icon ?? "·"} `, color: h?.color ?? color.accent },
          { text: t.title, grow: true, bold: true },
        ],
      };
    });
    return (
      <Box flexDirection="column" width={columns} height={termRows}>
        {header}
        <Box height={termRows - 2}>
          <ListPanel title="Help" focused width={topicWidth} height={termRows - 2} rows={topicRows} selected={overlay.topic} empty="" />
          <Panel
            title={topic.title}
            hint={lines.length > room ? `${scroll + 1}–${Math.min(lines.length, scroll + room)} of ${lines.length} · pgdn` : undefined}
            focused={false}
            width={columns - topicWidth}
            height={termRows - 2}
          >
            {lines.slice(scroll, scroll + room).map((l, i) =>
              l.kind === "heading" ? (
                <Text key={i} color={color.accent} bold wrap="truncate-end">
                  {l.text}
                </Text>
              ) : (
                <Text key={i} color={l.kind === "gap" ? undefined : color.text} wrap="truncate-end">
                  {l.text || " "}
                </Text>
              ),
            )}
          </Panel>
        </Box>
        <Box height={1} paddingX={1}>
          <KeyBar
            hints={[
              ["↑↓", "topic"],
              ["pgdn", "scroll"],
              ["esc", "close"],
            ]}
            width={columns - 2}
          />
        </Box>
      </Box>
    );
  }

  // Project tabs: counts, what each list means, and search hits in the other tabs.
  const TAB_ABOUT: Record<ProjectTab, string> = {
    usable: "Everything agents see in this repo, grouped by where it comes from. ⚠ global ones load in every repo.",
    add: "Your skills that this repo doesn't have yet. Space adds one.",
  };
  const tabCount = (tab: ProjectTab) =>
    (projectTabs?.[tab] ?? []).flatMap((sec) => sec.items).filter((i) => !i.key.startsWith("__")).length;
  const tabMatches = (tab: ProjectTab) =>
    (projectTabs?.[tab] ?? []).flatMap((sec) => sec.items).filter((i) => !i.key.startsWith("__") && matchScore(i.search.split(" ")[0] ?? "", search.right) !== null).length;
  const elsewhere =
    projectTabs && search.right
      ? PROJECT_TABS.filter((t) => t.id !== projectTab && tabMatches(t.id) > 0)
          .map((t) => `${tabMatches(t.id)} in ${t.label} (tab)`)
          .join(", ")
      : "";
  const tabBar = projectTabs ? (
    <Box flexDirection="column" height={3}>
      <Box height={1}>
        {PROJECT_TABS.map((t) => {
          const active = t.id === projectTab;
          const count = search.right ? tabMatches(t.id) : tabCount(t.id);
          return (
            <Box key={t.id} marginRight={1}>
              <Text backgroundColor={active ? color.accent : undefined} color={active ? "#0B1020" : color.muted} bold={active}>
                {` ${t.label} ${count} `}
              </Text>
            </Box>
          );
        })}
        <Box flexGrow={1} />
        <Text color={color.faint}>{focus === "right" ? "tab ⇥ next list" : ""}</Text>
      </Box>
      <Text color={color.muted} wrap="truncate-end">
        {TAB_ABOUT[projectTab]}
      </Text>
      <Text color={color.faint} wrap="truncate-end">
        {search.right && elsewhere ? `also matching: ${elsewhere}` : " "}
      </Text>
    </Box>
  ) : null;

  const paneHint = (pane: "left" | "right") =>
    search[pane] ? `⌕ ${search[pane]}` : "";

  return (
    <Box flexDirection="column" width={columns} height={termRows}>
      {header}
      <Box height={bodyHeight}>
        <ListPanel
          title="Places"
          focused={focus === "left"}
          width={leftWidth}
          height={bodyHeight}
          rows={leftRows}
          selected={Math.max(0, leftIndex)}
          filter={paneHint("left")}
          empty={`Nothing matches "${search.left}"`}
        />
        <ListPanel
          title={placeTitle}
          header={tabBar}
          headerHeight={tabBar ? 3 : 0}
          focused={focus === "right"}
          width={rightWidth}
          height={bodyHeight}
          rows={rightRows}
          selected={Math.max(0, rightIndex)}
          filter={paneHint("right")}
          empty={
            search.right
              ? `Nothing matches "${search.right}" here.${elsewhere ? ` ${elsewhere}` : ""}`
              : place.kind === "project"
                ? projectTab === "usable"
                  ? "No skills here yet. Press tab to add some from Your skills."
                  : snapshot.library.length
                    ? "Every one of your skills is already in this repo."
                    : "You have no saved skills yet. Copy one from a project (space on it) or clean up your globals."
                : place.kind === "health"
                  ? "✓ Everything looks good."
                  : place.kind === "help"
                    ? "Press enter to open help."
                    : "Nothing here yet."
          }
        />
      </Box>
      {renderPreview()}
      <Box height={1} paddingX={1}>
        {statusLine}
      </Box>
      <Box height={1} paddingX={1}>
        <KeyBar hints={[...hints, ["?", "help"]]} width={columns - 2} />
      </Box>
    </Box>
  );
}
