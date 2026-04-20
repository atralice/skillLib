"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import grantSkillAccessServerAction from "@/actions/skillGrants/grantSkillAccess";
import revokeSkillAccessServerAction from "@/actions/skillGrants/revokeSkillAccess";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

type GrantInfo = {
  id: string;
  user: { username: string | null; firstName: string; lastName: string } | null;
  team: { name: string; displayName: string } | null;
};

type TeamOption = { id: string; displayName: string; name: string };

type Props = {
  skillId: string;
  visibility: string;
  grants: GrantInfo[];
  ownedTeams: TeamOption[];
};

export default function SkillAccess({ skillId, visibility, grants, ownedTeams }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"user" | "team">("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const payload =
      mode === "user"
        ? { skillId, username: String(formData.get("username") ?? "") }
        : { skillId, teamId: String(formData.get("teamId") ?? "") };

    const result = await grantSkillAccessServerAction(payload);

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? null);
      setFieldErrors(result.error.fieldErrors);
      setSaving(false);
      return;
    }

    setSaving(false);
    e.currentTarget.reset();
    router.refresh();
  }

  async function handleRevoke(grantId: string) {
    await revokeSkillAccessServerAction({ grantId });
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Access</h2>
      <p className="mt-2 text-sm text-gray-500">
        {visibility === "public"
          ? "This skill is public — everyone can see it. Grants still work for convenience."
          : "Only the owner, the assigned team, and grantees below can see this skill."}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("user")}
          className={`rounded-md border px-3 py-1 text-sm ${
            mode === "user"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 text-gray-700"
          }`}
        >
          Grant to user
        </button>
        <button
          type="button"
          onClick={() => setMode("team")}
          className={`rounded-md border px-3 py-1 text-sm ${
            mode === "team"
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 text-gray-700"
          }`}
        >
          Grant to team
        </button>
      </div>

      <form onSubmit={handleAdd} className="mt-3 flex items-end gap-3" key={mode}>
        {mode === "user" ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Username</span>
            <input
              name="username"
              required
              placeholder="their-username"
              className="rounded-md border px-3 py-2 text-sm"
            />
            {fieldErrors.username && (
              <span className="text-xs text-red-600">{fieldErrors.username[0]}</span>
            )}
          </label>
        ) : (
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Team</span>
            <select
              name="teamId"
              required
              defaultValue=""
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Pick a team…
              </option>
              {ownedTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName} ({t.name})
                </option>
              ))}
            </select>
            {fieldErrors.teamId && (
              <span className="text-xs text-red-600">{fieldErrors.teamId[0]}</span>
            )}
          </label>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Granting..." : "Grant"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4">
        {grants.length === 0 ? (
          <p className="text-sm text-gray-400">No grants yet.</p>
        ) : (
          <ul className="divide-y">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  {g.user && (
                    <>
                      <span className="font-medium">
                        {g.user.firstName} {g.user.lastName}
                      </span>
                      {g.user.username && (
                        <span className="ml-2 text-xs text-gray-400">@{g.user.username}</span>
                      )}
                    </>
                  )}
                  {g.team && (
                    <>
                      <span className="font-medium">{g.team.displayName}</span>
                      <span className="ml-2 text-xs text-gray-400">team</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    void handleRevoke(g.id);
                  }}
                  className="text-red-600 hover:underline"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
