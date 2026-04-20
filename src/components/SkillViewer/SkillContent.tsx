import { getBlobContent, getPresignedDownloadUrl } from "@/lib/blob";
import { parseSkillMd } from "@/lib/skills/parseSkillMd";
import isTextContentType from "@/lib/skills/isTextContentType";
import SkillFrontmatter from "./SkillFrontmatter";
import SkillFileViewer from "./SkillFileViewer";

const MAX_INLINE_BYTES = 256 * 1024;

type VersionFile = {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
};

export default async function SkillContent({
  versionFiles,
}: {
  versionFiles: VersionFile[];
}) {
  const fileEntries = await Promise.all(
    versionFiles.map(async (f) => {
      const downloadUrl = await getPresignedDownloadUrl(
        f.sha256,
        f.path.split("/").pop() ?? f.path,
        f.contentType,
      );
      let content: string | null = null;
      let truncated = false;
      if (isTextContentType(f.contentType)) {
        const buf = await getBlobContent(f.sha256);
        if (buf.byteLength > MAX_INLINE_BYTES) {
          content = buf.subarray(0, MAX_INLINE_BYTES).toString("utf8");
          truncated = true;
        } else {
          content = buf.toString("utf8");
        }
      }
      return {
        path: f.path,
        sha256: f.sha256,
        size: f.size,
        contentType: f.contentType,
        downloadUrl,
        content,
        truncated,
      };
    }),
  );

  fileEntries.sort((a, b) => {
    if (a.path === "SKILL.md") return -1;
    if (b.path === "SKILL.md") return 1;
    return a.path.localeCompare(b.path);
  });

  const skillMdEntry = fileEntries.find(
    (f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"),
  );
  const skillMd =
    skillMdEntry && skillMdEntry.content
      ? parseSkillMd(skillMdEntry.content)
      : null;

  return (
    <>
      <SkillFrontmatter
        frontmatter={skillMd?.frontmatter ?? null}
        body={skillMd?.body ?? null}
      />
      <SkillFileViewer files={fileEntries} />
    </>
  );
}
