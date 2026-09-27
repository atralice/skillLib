import type { ProjectRow } from "./state.js";
import type { SourceKind } from "../sources.js";

export const color = {
  accent: "#8B9DFF",
  accentDim: "#4B5578",
  text: "#E5E7EB",
  muted: "#8A93A6",
  faint: "#5A6275",
  green: "#6BCB77",
  yellow: "#F2C94C",
  red: "#EF6B6B",
  magenta: "#C792EA",
  blue: "#5EB8F7",
  selection: "#2A3350",
};

export type Badge = { icon: string; label: string; color: string };

export function stateBadge(state: ProjectRow["state"]): Badge {
  switch (state) {
    case "ok":
      return { icon: "●", label: "in sync", color: color.green };
    case "update available":
      return { icon: "↑", label: "update", color: color.yellow };
    case "edited locally":
      return { icon: "✎", label: "edited", color: color.magenta };
    case "edited locally, update available":
      return { icon: "✎", label: "edited + update", color: color.magenta };
    case "folder missing":
      return { icon: "✗", label: "missing", color: color.red };
    case "not in library":
      return { icon: "✗", label: "not in library", color: color.red };
    case "untracked copy of library skill":
      return { icon: "○", label: "untracked", color: color.blue };
    case "untracked, differs from library":
      return { icon: "≠", label: "differs", color: color.yellow };
    case "local only":
      return { icon: "○", label: "only here", color: color.faint };
    case "repo skill":
      return { icon: "○", label: "only here", color: color.faint };
    case "repo skill, in library":
      return { icon: "✓", label: "in your skills too", color: color.green };
    case "repo skill, differs from library":
      return { icon: "≠", label: "differs from yours", color: color.yellow };
    case "available":
      return { icon: " ", label: "", color: color.faint };
  }
}

export const kindColor: Record<SourceKind, string> = {
  global: color.yellow,
  "skills.sh": color.magenta,
  "claude.ai": color.blue,
  plugin: color.accent,
  "built-in": color.muted,
};
