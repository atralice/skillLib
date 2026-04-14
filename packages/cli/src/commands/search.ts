import { getList } from "../lib/client.js";
import { info, error, table } from "../lib/output.js";

type SkillItem = {
  name: string;
  displayName: string;
  description: string;
  owner: { username: string };
  _count: { installations: number };
};

export async function search(args: string[]) {
  const query = args.join(" ");
  if (!query) {
    error("Usage: skilllib search <query>");
    process.exit(1);
  }

  const { data: skills, meta } = await getList<SkillItem>(
    `/skills?q=${encodeURIComponent(query)}`,
  );

  if (skills.length === 0) {
    info("No skills found");
    return;
  }

  table(
    skills.map((s) => ({
      Skill: `@${s.owner.username}/${s.name}`,
      Description: s.description.slice(0, 60) || s.displayName,
      Installs: String(s._count.installations),
    })),
  );

  if (meta.total > skills.length) {
    info(`\nShowing ${skills.length} of ${meta.total} results`);
  }
}
