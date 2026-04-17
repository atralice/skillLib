import Link from "next/link";

type VersionInfo = {
  id: string;
  version: string;
  status: string;
  publishedAt: Date | null;
};

type Props = {
  skillName: string;
  versions: VersionInfo[];
  selectedVersion: string;
};

export default function SkillVersionSelector({ skillName, versions, selectedVersion }: Props) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-500">Versions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {versions.map((v) => {
          const isSelected = v.version === selectedVersion;
          return (
            <Link
              key={v.id}
              href={`/dashboard/skills/${encodeURIComponent(skillName)}?version=${encodeURIComponent(v.version)}`}
              className={`rounded-md border px-3 py-1 text-sm ${
                isSelected
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-700 hover:border-gray-400"
              }`}
            >
              <span className="font-mono">v{v.version}</span>
              <span className={`ml-2 text-xs ${isSelected ? "text-gray-300" : "text-gray-400"}`}>
                {v.status}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
