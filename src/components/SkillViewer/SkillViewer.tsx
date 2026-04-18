import SkillHeader from "./SkillHeader";
import SkillVersionSelector from "./SkillVersionSelector";
import SkillFrontmatter from "./SkillFrontmatter";
import SkillFileViewer from "./SkillFileViewer";
import type { SkillFrontmatter as Frontmatter } from "@/lib/skills/parseSkillMd";

type VersionInfo = {
  id: string;
  version: string;
  status: string;
  publishedAt: Date | null;
};

type FileEntry = {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  downloadUrl: string;
  content: string | null;
  truncated: boolean;
};

type Props = {
  skill: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    visibility: string;
    ownerUsername: string | null;
    installCount: number;
  };
  versions: VersionInfo[];
  selectedVersion: string;
  skillMd: { frontmatter: Frontmatter; body: string } | null;
  files: FileEntry[];
};

export default function SkillViewer({ skill, versions, selectedVersion, skillMd, files }: Props) {
  return (
    <div className="space-y-6">
      <SkillHeader
        displayName={skill.displayName}
        ownerUsername={skill.ownerUsername}
        name={skill.name}
        description={skill.description}
        visibility={skill.visibility}
        installCount={skill.installCount}
      />
      <SkillVersionSelector
        skillId={skill.id}
        versions={versions}
        selectedVersion={selectedVersion}
      />
      <SkillFrontmatter frontmatter={skillMd?.frontmatter ?? null} body={skillMd?.body ?? null} />
      <SkillFileViewer files={files} />
    </div>
  );
}
