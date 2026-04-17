import { Fragment } from "react";
import type { SkillFrontmatter as Frontmatter } from "@/lib/skills/parseSkillMd";

type Props = {
  frontmatter: Frontmatter | null;
  body: string | null;
};

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

export default function SkillFrontmatter({ frontmatter, body }: Props) {
  if (!frontmatter) {
    return (
      <div className="rounded-lg border bg-white p-6">
        <p className="text-sm text-gray-400">This version has no SKILL.md file.</p>
      </div>
    );
  }

  const { name: rawName, description: rawDescription, ...rest } = frontmatter;
  const name = typeof rawName === "string" ? rawName : null;
  const description = typeof rawDescription === "string" ? rawDescription : null;
  const extraEntries = Object.entries(rest);

  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">SKILL.md</h2>
      <div className="mt-3 space-y-3">
        {name && (
          <div>
            <p className="text-xs text-gray-400">name</p>
            <p className="font-mono text-sm">{name}</p>
          </div>
        )}
        {description && (
          <div>
            <p className="text-xs text-gray-400">description</p>
            <p className="text-sm text-gray-700">{description}</p>
          </div>
        )}
        {extraEntries.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Additional frontmatter
            </p>
            <dl className="mt-2 grid grid-cols-[minmax(0,160px)_1fr] gap-x-4 gap-y-2 text-sm">
              {extraEntries.map(([key, value]) => (
                <Fragment key={key}>
                  <dt className="truncate font-mono text-gray-500">{key}</dt>
                  <dd className="break-words text-gray-700">
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {stringifyValue(value)}
                    </pre>
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>
      {body && body.trim().length > 0 && (
        <details className="mt-4 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900">
            SKILL.md body
          </summary>
          <pre className="mt-3 max-h-[600px] overflow-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-800">
            {body}
          </pre>
        </details>
      )}
    </div>
  );
}
