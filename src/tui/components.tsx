import React from "react";
import { Box, Text } from "ink";
import { color } from "./theme.js";

export type Cell = { text: string; color?: string; grow?: boolean; width?: number; bold?: boolean; dim?: boolean };
/** A list row. `header` rows are section titles: shown, never selected. */
export type Row = { key: string; cells: Cell[]; header?: boolean };

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text.padEnd(width);
}

/** A rounded panel with a title on its top border. */
export function Panel({
  title,
  hint,
  focused,
  width,
  height,
  children,
}: {
  title: string;
  hint?: string;
  focused: boolean;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const border = focused ? color.accent : color.accentDim;
  const label = ` ${title} `;
  const extra = hint ? ` ${hint} ` : "";
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor={border} paddingX={1}>
      <Box position="absolute" marginTop={-1} marginLeft={1}>
        <Text color={focused ? color.accent : color.muted} bold>
          {fit(label, Math.max(0, width - 6 - extra.length)).trimEnd() + " "}
        </Text>
        {extra ? <Text color={color.faint}>{extra}</Text> : null}
      </Box>
      {children}
    </Box>
  );
}

/** Scrolling list inside a panel. One cell per row may `grow` to take the remaining width. */
export function ListPanel({
  title,
  focused,
  width,
  height,
  rows,
  selected,
  empty,
  filter,
  header,
  headerHeight = 0,
}: {
  title: string;
  focused: boolean;
  width: number;
  height: number;
  rows: Row[];
  selected: number;
  empty: React.ReactNode;
  filter?: string;
  /** Fixed content above the rows (e.g. tabs), `headerHeight` lines tall. */
  header?: React.ReactNode;
  headerHeight?: number;
}) {
  const visible = Math.max(1, height - 2 - headerHeight);
  const offset = Math.min(Math.max(0, selected - Math.floor(visible / 2)), Math.max(0, rows.length - visible));
  const shown = rows.slice(offset, offset + visible);
  const inner = width - 4;
  const hint = [filter ?? "", rows.length > visible ? `${selected + 1}/${rows.length}` : ""].filter(Boolean).join("  ");

  return (
    <Panel title={title} hint={hint} focused={focused} width={width} height={height}>
      {header}
      {rows.length === 0 ? (
        <Box paddingTop={1} paddingX={1}>
          {typeof empty === "string" ? <Text color={color.muted}>{empty}</Text> : empty}
        </Box>
      ) : (
        shown.map((row, i) => {
          if (row.header) {
            const label = row.cells.map((c) => c.text).join("");
            return (
              <Box key={row.key} height={1}>
                <Text color={color.accent} bold>
                  {"  " + label + " "}
                </Text>
                <Text color={color.accentDim}>{"─".repeat(Math.max(0, inner - label.length - 3))}</Text>
              </Box>
            );
          }
          const active = offset + i === selected;
          const fixed = row.cells.filter((c) => !c.grow).reduce((n, c) => n + (c.width ?? c.text.length), 0);
          const growWidth = Math.max(3, inner - 2 - fixed);
          const bg = active ? (focused ? color.selection : undefined) : undefined;
          return (
            <Box key={row.key} height={1}>
              <Text backgroundColor={bg} color={active && focused ? color.accent : color.faint}>
                {active ? "▌ " : "  "}
              </Text>
              {row.cells.map((c, j) => (
                <Text
                  key={j}
                  backgroundColor={bg}
                  color={c.color ?? (active && focused ? color.text : undefined)}
                  bold={c.bold || (active && focused && c.grow)}
                  dimColor={c.dim}
                  wrap="truncate-end"
                >
                  {fit(c.text, c.grow ? growWidth : (c.width ?? c.text.length))}
                </Text>
              ))}
            </Box>
          );
        })
      )}
    </Panel>
  );
}

export type Hint = [key: string, label: string];

/** Bottom bar: key caps with labels. */
export function KeyBar({ hints, width }: { hints: Hint[]; width: number }) {
  let used = 0;
  const fitting = hints.filter(([k, l]) => {
    used += k.length + l.length + 4;
    return used < width;
  });
  return (
    <Box height={1} width={width}>
      {fitting.map(([k, l]) => (
        <Box key={k + l} marginRight={2}>
          <Text backgroundColor={color.accentDim} color={color.text}>{` ${k} `}</Text>
          <Text color={color.muted}>{` ${l}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** Wraps text to a width, returning at most `max` lines. */
export function wrap(text: string, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    } else line = (line + " " + word).trim();
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && words.join(" ").length > lines.join(" ").length) {
    lines[max - 1] = fit(lines[max - 1]!, width - 1).trimEnd() + "…";
  }
  return lines;
}
