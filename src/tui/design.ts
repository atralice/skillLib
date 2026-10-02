/**
 * Renders the screens docs/DESIGN.md shows, from sample data, so the design doc can't drift
 * from the app: `pnpm design`. Each screen is written twice to docs/design/: an .svg for
 * people and a .txt for agents (the same characters, without color).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Screen = { name: string; steps: string[]; size?: string };

/** Keys as snapshot.tsx takes them. From the start, the Places pane is focused on the repo you're in (web-app). */
export const SCREENS: Screen[] = [
  { name: "start", steps: [] },
  { name: "repo", steps: ["enter"] },
  { name: "repo-details", steps: ["enter", "right", "down"] },
  { name: "repo-filtered", steps: ["enter", "r e"] },
  { name: "repo-issues-tab", steps: ["enter", "tab"] },
  { name: "add-skill", steps: ["enter", "up", "up", "up", "enter", "s q"] },
  { name: "confirm", steps: ["enter", "space", "enter"] },
  { name: "fix-all", steps: ["enter", "up", "up", "enter"] },
  { name: "repo-menu", steps: ["enter", "up", "enter"] },
  { name: "global", steps: ["up", "up", "up", "enter"] },
  { name: "global-group-open", steps: ["up", "up", "up", "enter", "right"] },
  { name: "global-plugin", steps: ["up", "up", "up", "enter", "down down down down down"] },
  { name: "repo-picker", steps: ["up", "up", "up", "enter", "right", "right", "enter"] },
  { name: "your-skills", steps: ["up", "up", "up", "up", "enter"] },
  { name: "plugins", steps: ["up", "up", "enter"] },
  { name: "plugin-details", steps: ["up", "up", "enter", "down", "right"] },
  { name: "health", steps: ["up", "enter"] },
  { name: "settings", steps: [Array(16).fill("down").join(" "), "enter"] },
  { name: "help", steps: ["?"] },
  { name: "narrow", steps: [], size: "78x24" },
  { name: "narrow-details", steps: ["enter"], size: "78x24" },
];

const SIZE = "118x30";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "docs", "design");

/** Colors and layout of the SVG: a terminal window, one monospace cell per character. */
const CW = 8.43, LH = 19, X0 = 18, Y0 = 54, FG = "#d7dae0", FAINT = "#5a6275";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A frame of 24-bit ANSI text as an SVG terminal window. */
export function ansiToSvg(frame: string, title = "skilllib"): string {
  const lines = frame.replace(/\n+$/, "").split("\n");
  const cols = Math.max(...lines.map((l) => [...strip(l)].length));
  const W = Math.round(X0 * 2 + cols * CW), H = Math.round(Y0 + lines.length * LH + 12);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="14">`,
    `<rect width="${W}" height="${H}" rx="10" fill="#1b1a2e"/>`,
    `<circle cx="20" cy="20" r="6" fill="#ff5f57"/><circle cx="40" cy="20" r="6" fill="#febc2e"/><circle cx="60" cy="20" r="6" fill="#28c840"/>`,
    `<text x="${W / 2}" y="24" fill="#8a93a6" font-size="12" text-anchor="middle">${esc(title)}</text>`,
  ];
  lines.forEach((line, row) => {
    let fg: string | null = null, bg: string | null = null, bold = false, dim = false, col = 0;
    const y = Y0 + row * LH;
    for (const token of line.split(/(\x1b\[[0-9;]*m)/)) {
      const sgr = /^\x1b\[([0-9;]*)m$/.exec(token);
      if (sgr) {
        const p = sgr[1]!.split(";").filter(Boolean).map(Number);
        if (!p.length) p.push(0);
        for (let i = 0; i < p.length; i++) {
          const c = p[i]!;
          if (c === 0) (fg = bg = null), (bold = dim = false);
          else if (c === 1) bold = true;
          else if (c === 2) dim = true;
          else if (c === 22) bold = dim = false;
          else if (c === 39) fg = null;
          else if (c === 49) bg = null;
          else if ((c === 38 || c === 48) && p[i + 1] === 2) {
            const hex = "#" + p.slice(i + 2, i + 5).map((v) => v.toString(16).padStart(2, "0")).join("");
            if (c === 38) fg = hex;
            else bg = hex;
            i += 4;
          }
        }
        continue;
      }
      if (!token) continue;
      const len = [...token].length;
      const x = (X0 + col * CW).toFixed(1), w = (len * CW).toFixed(1);
      if (bg) svg.push(`<rect x="${x}" y="${(y - 14).toFixed(1)}" width="${w}" height="${LH}" fill="${bg}"/>`);
      if (token.trim()) {
        const fill = dim && !fg ? FAINT : (fg ?? FG);
        svg.push(`<text x="${x}" y="${y.toFixed(1)}" fill="${fill}"${bold ? ' font-weight="bold"' : ""} xml:space="preserve" textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(token)}</text>`);
      }
      col += len;
    }
  });
  return svg.concat("</svg>").join("\n") + "\n";
}

/** Runs the app headless (snapshot.tsx) and returns the last screen, in color. */
function capture(s: Screen): string {
  const tsx = join(root, "node_modules", ".bin", "tsx");
  const printed = execFileSync(tsx, [join(root, "src", "tui", "snapshot.tsx")], {
    env: { ...process.env, SIZE: s.size ?? SIZE, STEPS: JSON.stringify([...s.steps, "#shot"]), RAW: "1", FORCE_COLOR: "3" },
    encoding: "utf-8",
    timeout: 60_000,
  });
  return printed.split("===== shot =====\n")[1] ?? "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(out, { recursive: true });
  for (const s of SCREENS) {
    const frame = capture(s);
    writeFileSync(join(out, `${s.name}.svg`), ansiToSvg(frame));
    writeFileSync(join(out, `${s.name}.txt`), strip(frame).replace(/[ \t]+$/gm, "").replace(/\n+$/, "") + "\n");
    console.log(`docs/design/${s.name}  (${s.steps.join(" · ") || "start"})`);
  }
}
