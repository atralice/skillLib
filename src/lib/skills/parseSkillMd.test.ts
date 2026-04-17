import { describe, expect, test } from "bun:test";
import { parseSkillMd } from "./parseSkillMd";

describe("parseSkillMd", () => {
  test("extracts frontmatter and body", () => {
    const content = `---
name: my-skill
description: A great skill
---
# Heading

Some body text.
`;
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("A great skill");
    expect(body).toContain("# Heading");
    expect(body).toContain("Some body text.");
  });

  test("returns empty frontmatter when missing", () => {
    const content = "# Just a heading\n\nNo frontmatter here.";
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  test("preserves arbitrary yaml fields", () => {
    const content = `---
name: my-skill
description: A skill
trigger: "on-pull-request"
allowed-tools:
  - bash
  - grep
---
body
`;
    const { frontmatter } = parseSkillMd(content);
    expect(frontmatter["trigger"]).toBe("on-pull-request");
    expect(frontmatter["allowed-tools"]).toEqual(["bash", "grep"]);
  });

  test("handles empty body", () => {
    const content = `---
name: x
---
`;
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter.name).toBe("x");
    expect(body).toBe("");
  });
});
