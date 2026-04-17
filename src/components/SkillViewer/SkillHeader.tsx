type Props = {
  displayName: string;
  ownerUsername: string | null;
  name: string;
  description: string;
  visibility: string;
  installCount: number;
};

export default function SkillHeader({
  displayName,
  ownerUsername,
  name,
  description,
  visibility,
  installCount,
}: Props) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="mt-1 text-sm text-gray-500">
            <span className="text-gray-400">@{ownerUsername ?? "anonymous"}/</span>
            {name}
          </p>
          {description && <p className="mt-3 text-sm text-gray-700">{description}</p>}
        </div>
        <div className="text-right text-xs text-gray-400">
          <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">{visibility}</span>
          <p className="mt-2">{installCount} installs</p>
        </div>
      </div>
    </div>
  );
}
