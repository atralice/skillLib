import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">npm for LLM skills</h1>
      <p className="mt-4 max-w-lg text-lg text-gray-600">
        Publish, install, and sync your Claude Code skills across machines. Share with teammates.
        Version everything.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/signup"
          className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Get started
        </Link>
        <Link
          href="/skills"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Browse skills
        </Link>
      </div>
      <div className="mt-16 w-full max-w-2xl rounded-lg border bg-gray-900 p-6 text-left font-mono text-sm text-green-400">
        <p className="text-gray-500"># Install a skill</p>
        <p>$ skilllib install @alice/react-patterns</p>
        <p className="mt-3 text-gray-500"># Publish your own</p>
        <p>$ skilllib publish</p>
        <p className="mt-3 text-gray-500"># Sync across machines</p>
        <p>$ skilllib update</p>
      </div>
    </div>
  );
}
