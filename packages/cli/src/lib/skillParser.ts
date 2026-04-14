import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

type SkillFrontmatter = {
  name?: string;
  description?: string;
  [key: string]: unknown;
};

type SkillFile = {
  path: string;
  content: string;
};

export function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const frontmatter = parseYaml(match[1]!) as SkillFrontmatter;
  return { frontmatter, body: match[2]! };
}

export function collectSkillFiles(dir: string): SkillFile[] {
  const files: SkillFile[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        const relPath = relative(dir, fullPath);
        files.push({
          path: relPath,
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }

  walk(dir);
  return files;
}
