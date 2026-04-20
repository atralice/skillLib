"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import updateUsernameServerAction from "@/actions/profile/updateUsername";
import { isServerActionError } from "@/lib/serverActions/isServerActionError";

export default function UsernameForm({ currentUsername }: { currentUsername: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(currentUsername === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username");
    if (typeof username !== "string") {
      setSaving(false);
      return;
    }

    const result = await updateUsernameServerAction({ username });

    if (isServerActionError(result)) {
      setError(
        result.error.fieldErrors.username?.[0] ??
          result.error.formErrors[0] ??
          "Failed to update username",
      );
      setSaving(false);
      return;
    }

    setSuccess(true);
    setEditing(false);
    setSaving(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <p>{currentUsername ?? "Not set"}</p>
        <button
          onClick={() => {
            setEditing(true);
            setSuccess(false);
          }}
          className="text-xs text-blue-600 hover:underline"
        >
          {currentUsername ? "Change" : "Set username"}
        </button>
        {success && <span className="text-xs text-green-700">Saved</span>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          name="username"
          defaultValue={currentUsername ?? ""}
          required
          minLength={3}
          maxLength={32}
          placeholder="your-username"
          className="rounded-md border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {currentUsername && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="text-xs text-gray-500 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-gray-400">
        Lowercase letters, numbers, and dashes. 3–32 characters.
      </p>
    </form>
  );
}
