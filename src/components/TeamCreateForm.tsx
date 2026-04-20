"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import createTeamServerAction from "@/actions/teams/createTeam";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

export default function TeamCreateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const result = await createTeamServerAction({
      name: String(formData.get("name") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
    });

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? null);
      setFieldErrors(result.error.fieldErrors);
      setSaving(false);
      return;
    }

    setSaving(false);
    router.push(`/dashboard/teams/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Display name</span>
          <input
            name="displayName"
            required
            maxLength={100}
            placeholder="My Team"
            className="rounded-md border px-3 py-2 text-sm"
          />
          {fieldErrors.displayName && (
            <span className="text-xs text-red-600">{fieldErrors.displayName[0]}</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Slug</span>
          <input
            name="name"
            required
            minLength={3}
            maxLength={32}
            placeholder="my-team"
            className="rounded-md border px-3 py-2 text-sm"
          />
          {fieldErrors.name && <span className="text-xs text-red-600">{fieldErrors.name[0]}</span>}
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create team"}
        </button>
      </div>
    </form>
  );
}
