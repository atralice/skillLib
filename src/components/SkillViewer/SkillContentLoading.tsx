export default function SkillContentLoading() {
  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 space-y-2">
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    </>
  );
}
