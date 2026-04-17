import { parse as parseYaml } from "yaml";

export type SkillFrontmatter = Record<string, unknown>;

function isRecord(value: unknown): value is SkillFrontmatter {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseSkillMd(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const [, frontmatterYaml = "", body = ""] = match;
  const parsed: unknown = parseYaml(frontmatterYaml);
  const frontmatter: SkillFrontmatter = isRecord(parsed) ? parsed : {};
  return { frontmatter, body };
}
