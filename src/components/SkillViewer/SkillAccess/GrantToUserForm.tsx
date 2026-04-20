"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import grantSkillAccessServerAction from "@/actions/skillGrants/grantSkillAccess";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

export default function GrantToUserForm({ skillId }: { skillId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const result = await grantSkillAccessServerAction({
      skillId,
      username: String(formData.get("username") ?? ""),
    });

    if (isServerActionError(result)) {
      setError(result.error.formErrors[0] ?? null);
      setFieldError(result.error.fieldErrors.username?.[0] ?? null);
      setSaving(false);
      return;
    }

    setSaving(false);
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex items-end gap-3">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-medium">Username</span>
        <input
          name="username"
          required
          placeholder="their-username"
          className="rounded-md border px-3 py-2 text-sm"
        />
        {fieldError && <span className="text-xs text-red-600">{fieldError}</span>}
      </label>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {saving ? "Granting..." : "Grant"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
