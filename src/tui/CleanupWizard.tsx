import { basename } from "node:path";
import { useState } from "react";
import { Box, Text, type Key } from "ink";
import { setKeepGlobal } from "../config.js";
import { addSkill, deleteGlobal, importSkill, unloadGlobal } from "../library.js";
import type { SourcedSkill } from "../sources.js";
import { KeyBar, ListPanel, Panel, wrap, type Hint, type Row } from "./components.js";
import { color } from "./theme.js";

/** The app forwards key presses here while the wizard is open (one input handler avoids split escape sequences). */
export type KeyHandler = (input: string, key: Key) => void;

export type CleanupResult = { unloaded: number; installs: number; deleted: number; kept: number; problems: string[] };

/** What happens to each global skill: move it into projects, leave it global, or delete it. */
type Mode = "move" | "keep" | "delete";
const NEXT_MODE: Record<Mode, Mode> = { move: "keep", keep: "delete", delete: "move" };

type Step = "choose" | "review";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Moves your global skills into the projects that need them:
 * 1. choose skills (left) and, for each, the projects that keep it (right)
 * 2. review, then apply: copy into Your skills, install into the ticked
 *    projects, and stop loading it globally (the original goes to backup).
 * Skills you choose to keep global are remembered and hidden next time (k shows them).
 */
export function CleanupWizard({
  skills,
  kept,
  projects,
  usesIn,
  usesTotal,
  onReviewPrompt,
  usageDays,
  installedIn,
  initialSkill,
  width,
  height,
  onDone,
  onCancel,
  inputRef,
}: {
  skills: SourcedSkill[];
  /** Names you already keep global on purpose; hidden unless you press k. */
  kept: Set<string>;
  projects: string[];
  /** Claude Code uses of a skill in a project (null while loading). */
  usesIn: (skill: string, project: string) => number | null;
  /** Claude Code uses of a skill anywhere, over the usage window (null while loading). */
  usesTotal: (skill: string) => number | null;
  /** Copies a review prompt for these skills; returns a status message. */
  onReviewPrompt: (skills: SourcedSkill[]) => string;
  usageDays: number;
  /** Projects that already have the skill installed. */
  installedIn: (skill: string) => string[];
  initialSkill?: string;
  width: number;
  height: number;
  onDone: (result: CleanupResult) => void;
  onCancel: () => void;
  inputRef: { current: KeyHandler | null };
}) {
  const [step, setStep] = useState<Step>("choose");
  const [focus, setFocus] = useState<"skills" | "projects">("skills");
  const [modes, setModes] = useState<Map<string, Mode>>(
    () => new Map(skills.map((s) => [s.path, s.name === initialSkill || (!initialSkill && !kept.has(s.name)) ? "move" : "keep"])),
  );
  const modeOf = (s: SourcedSkill): Mode => modes.get(s.path) ?? "keep";
  // Only a keep you chose is remembered, not the default for skills you didn't look at.
  const [touched, setTouched] = useState<Set<string>>(() => new Set(initialSkill ? [] : skills.map((s) => s.path)));
  const setMode = (s: SourcedSkill, mode: Mode) => {
    setModes((prev) => new Map(prev).set(s.path, mode));
    setTouched((prev) => new Set(prev).add(s.path));
  };
  const [showKept, setShowKept] = useState(false);
  const shown = (on: boolean) => skills.filter((s) => on || !kept.has(s.name) || s.name === initialSkill);
  const list = shown(showKept);
  const hiddenKept = skills.length - shown(false).length;
  const [skillIndex, setSkillIndex] = useState(() => Math.max(0, list.findIndex((s) => s.name === initialSkill)));
  const [projectIndex, setProjectIndex] = useState(0);
  const [status, setStatus] = useState("");
  // Pre-tick projects that already have the skill or where agents used it.
  const [targets, setTargets] = useState<Map<string, Set<string>>>(
    () =>
      new Map(
        skills.map((s) => [s.path, new Set(projects.filter((p) => installedIn(s.name).includes(p) || (usesIn(s.name, p) ?? 0) > 0))]),
      ),
  );

  const skill = list[skillIndex];
  const chosen = skills.filter((s) => modeOf(s) === "move");
  const toDelete = skills.filter((s) => modeOf(s) === "delete");
  const toKeep = skills.filter((s) => modeOf(s) === "keep" && touched.has(s.path) && !kept.has(s.name));
  const totalInstalls = chosen.reduce((n, s) => n + (targets.get(s.path)?.size ?? 0), 0);
  const orphans = chosen.filter((s) => (targets.get(s.path)?.size ?? 0) === 0);

  const toggleTarget = (s: SourcedSkill, project: string) =>
    setTargets((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(s.path));
      if (set.has(project)) set.delete(project);
      else set.add(project);
      next.set(s.path, set);
      return next;
    });

  const apply = () => {
    const problems: string[] = [];
    let installs = 0;
    let unloaded = 0;
    let deleted = 0;
    for (const s of toDelete) {
      const r = deleteGlobal(s.path, s.links);
      if (r.ok) deleted++;
      else problems.push(`${s.name}: ${r.reason}`);
    }
    for (const s of chosen) {
      importSkill(s.path);
      let failed = false;
      for (const project of targets.get(s.path) ?? []) {
        const change = addSkill(project, s.name);
        if (change.action === "skipped") {
          problems.push(`${s.name} in ${basename(project)}: ${change.reason}`);
          failed = true;
        } else installs++;
      }
      // Keep it global if a project couldn't get its copy, so nothing loses the skill.
      if (failed) continue;
      const r = unloadGlobal(s.path, s.links);
      if (r.ok) unloaded++;
      else problems.push(`${s.name}: ${r.reason}`);
    }
    setKeepGlobal(toKeep.map((s) => s.name), true);
    // Moving or deleting a skill you kept global is a new decision; forget the old one.
    setKeepGlobal([...chosen, ...toDelete].map((s) => s.name).filter((n) => kept.has(n)), false);
    onDone({ unloaded, installs, deleted, kept: toKeep.length, problems });
  };

  inputRef.current = (input: string, key: Key) => {
    if (key.ctrl && input === "c") return onCancel();
    if (step === "review") {
      if (key.return) return apply();
      if (key.escape || key.leftArrow) return setStep("choose");
      return;
    }
    if (key.escape) return onCancel();
    if (input === "p") return setStatus(onReviewPrompt(list));
    if (input === "k" && hiddenKept) {
      const next = shown(!showKept);
      setShowKept(!showKept);
      return setSkillIndex(Math.max(0, next.findIndex((s) => s.path === skill?.path)));
    }
    if (key.return) return chosen.length || toDelete.length || toKeep.length ? setStep("review") : undefined;
    if (key.tab || key.rightArrow || key.leftArrow) {
      return setFocus(key.leftArrow ? "skills" : key.rightArrow ? "projects" : focus === "skills" ? "projects" : "skills");
    }
    if (focus === "skills") {
      if (key.upArrow) return setSkillIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) return setSkillIndex((i) => Math.min(list.length - 1, i + 1));
      if (input === " " && skill) return setMode(skill, NEXT_MODE[modeOf(skill)]);
      if (input === "d" && skill) return setMode(skill, modeOf(skill) === "delete" ? "keep" : "delete");
    } else {
      if (key.upArrow) return setProjectIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) return setProjectIndex((i) => Math.min(projects.length - 1, i + 1));
      if (input === " " && skill && projects[projectIndex]) {
        if (modeOf(skill) !== "move") setMode(skill, "move");
        return toggleTarget(skill, projects[projectIndex]!);
      }
    }
  };

  const bodyHeight = height - 5;

  if (step === "review") {
    const lines = chosen.map((s) => {
      const where = [...(targets.get(s.path) ?? [])].map((p) => basename(p));
      return { s, where };
    });
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1} paddingX={1}>
          <Text color={color.accent} bold>
            Clean up global skills
          </Text>
          <Text color={color.muted}>{"  ·  2 of 2 · review"}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={color.accent} paddingX={2} paddingY={1} height={bodyHeight + 2}>
          <Text color={color.text}>
            {[
              chosen.length ? `${plural(chosen.length, "skill")} ${chosen.length === 1 ? "moves" : "move"} into your projects (${plural(totalInstalls, "install")})` : "",
              toDelete.length ? `${plural(toDelete.length, "skill")} ${toDelete.length === 1 ? "is" : "are"} deleted` : "",
              toKeep.length ? `${plural(toKeep.length, "skill")} ${toKeep.length === 1 ? "stays" : "stay"} global on purpose` : "",
            ]
              .filter(Boolean)
              .join(" · ") + "."}
          </Text>
          <Text color={color.faint}>Moved skills are copied into Your skills first. Every original goes to a backup you can restore from Health.</Text>
          <Text> </Text>
          {lines.slice(0, Math.max(1, bodyHeight - 7)).map(({ s, where }) => (
            <Text key={s.path} wrap="truncate-end">
              <Text color={color.text}>{s.name.padEnd(32)}</Text>
              <Text color={color.faint}>{`${(usesTotal(s.name) ?? 0) ? `${usesTotal(s.name)} uses` : "unused"}`.padEnd(10)}</Text>
              <Text color={where.length ? color.green : color.yellow}>{where.length ? `→ ${where.join(", ")}` : "→ only in Your skills (no project)"}</Text>
            </Text>
          ))}
          {lines.length > bodyHeight - 7 ? <Text color={color.faint}>{`… and ${lines.length - (bodyHeight - 7)} more`}</Text> : null}
          {toDelete.length ? (
            <Text color={color.red} wrap="truncate-end">{`✕ delete (not kept in Your skills): ${toDelete.map((s) => s.name).join(", ")}`}</Text>
          ) : null}
          {toKeep.length ? (
            <Text color={color.muted} wrap="truncate-end">{`✓ keep global, and skip next cleanup: ${toKeep.map((s) => s.name).join(", ")}`}</Text>
          ) : null}
          <Box flexGrow={1} />
          {orphans.length ? (
            <Text color={color.yellow}>{`${plural(orphans.length, "skill")} won't be in any project — add them later from "Add skills".`}</Text>
          ) : null}
        </Box>
        <Box height={1} paddingX={1}>
          <KeyBar
            width={width - 2}
            hints={[
              ["enter", "apply"],
              ["esc", "back"],
            ]}
          />
        </Box>
      </Box>
    );
  }

  const leftWidth = Math.max(40, Math.floor(width * 0.55));
  const detailHeight = height >= 26 ? 7 : height >= 20 ? 5 : 0;
  const listHeight = bodyHeight - detailHeight;
  const usesText = (n: number | null) => (n === null ? "…" : n === 0 ? "unused" : `${n} use${n === 1 ? "" : "s"}`);
  const skillRows: Row[] = list.map((s) => {
    const mode = modeOf(s);
    const n = targets.get(s.path)?.size ?? 0;
    return {
      key: s.path,
      cells: [
        { text: mode === "move" ? "◉ " : mode === "delete" ? "✕ " : "○ ", color: mode === "move" ? color.accent : mode === "delete" ? color.red : color.faint },
        { text: s.name, grow: true, color: mode === "keep" ? color.muted : mode === "delete" ? color.red : undefined },
        { text: usesText(usesTotal(s.name)).padStart(9), width: 9, color: usesTotal(s.name) ? color.text : color.faint },
        {
          text: mode === "keep" ? (kept.has(s.name) ? "  ✓ kept global" : "  keep global") : mode === "delete" ? "  delete" : n ? `  → ${plural(n, "project")}` : "  → no project",
          width: 15,
          color: mode === "keep" ? color.faint : mode === "delete" ? color.red : n ? color.green : color.yellow,
        },
      ],
    };
  });
  const projectRows: Row[] = skill
    ? projects.map((p) => {
        const on = targets.get(skill.path)?.has(p) ?? false;
        const uses = usesIn(skill.name, p);
        return {
          key: p,
          cells: [
            { text: on ? "◉ " : "○ ", color: on ? color.green : color.faint },
            { text: basename(p), grow: true, color: on ? undefined : color.muted },
            { text: uses ? `${uses} use${uses === 1 ? "" : "s"}` : "", color: color.muted },
          ],
        };
      })
    : [];

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Text color={color.accent} bold>
          Clean up global skills
        </Text>
        <Text color={color.muted}>{"  ·  1 of 2 · choose where each skill should live"}</Text>
      </Box>
      <Box height={2} paddingX={1} flexDirection="column">
        <Text color={color.text} wrap="truncate-end">
          These load in every repo, so every agent reads them all the time. Pick the projects that should keep each one.
        </Text>
        <Text color={color.faint} wrap="truncate-end">
          {status ? `✓ ${status}` : "◉ move into the ticked projects · ○ keep global (remembered) · ✕ delete. Pre-ticked: projects that have it or used it. p: ask an agent."}
        </Text>
      </Box>
      <Box height={listHeight}>
        <ListPanel
          title={`Global skills · ${chosen.length} move · ${toDelete.length} delete${hiddenKept && !showKept ? ` · ${hiddenKept} kept hidden` : ""} · uses ${usageDays}d`}
          focused={focus === "skills"}
          width={leftWidth}
          height={listHeight}
          rows={skillRows}
          selected={skillIndex}
          empty={hiddenKept ? `All reviewed: you keep ${plural(hiddenKept, "skill")} global on purpose. k shows them.` : "None of your skills load globally. 🎉"}
        />
        <ListPanel
          title={skill ? `Keep ${skill.name} in…` : "Projects"}
          focused={focus === "projects"}
          width={width - leftWidth}
          height={listHeight}
          rows={projectRows}
          selected={projectIndex}
          empty="No projects yet. Add a folder in Settings."
        />
      </Box>
      {detailHeight && skill ? (
        <Panel title={skill.name} focused={false} width={width} height={detailHeight}>
          <Text color={color.muted} wrap="truncate-end">
            {(() => {
              const total = usesTotal(skill.name);
              const where = projects
                .map((p) => ({ p, n: usesIn(skill.name, p) ?? 0 }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n)
                .map((x) => `${basename(x.p)} ${x.n}`);
              const usage =
                total === null
                  ? "reading usage…"
                  : total === 0
                    ? `not used by Claude Code in the last ${usageDays} days`
                    : `used ${total} time${total === 1 ? "" : "s"} in ${usageDays} days${where.length ? ` — ${where.join(", ")}` : " (outside your projects)"}`;
              return `${usage}  ·  ${skill.origin}`;
            })()}
          </Text>
          {wrap(skill.description || "(no description)", width - 6, detailHeight - 3).map((l, i) => (
            <Text key={i} color={color.text} wrap="truncate-end">
              {l}
            </Text>
          ))}
        </Panel>
      ) : null}
      <Box height={1} paddingX={1}>
        <KeyBar
          width={width - 2}
          hints={[
            ["space", focus === "skills" ? "move / keep / delete" : "tick project"],
            ...(focus === "skills" ? ([["d", "delete"]] as Hint[]) : []),
            ["tab", "switch side"],
            ...(hiddenKept ? ([["k", showKept ? "hide kept" : `show kept (${hiddenKept})`]] as Hint[]) : []),
            ["enter", `review (${plural(totalInstalls, "install")})`],
            ["p", "ask an agent"],
            ["esc", "cancel"],
          ]}
        />
      </Box>
    </Box>
  );
}
